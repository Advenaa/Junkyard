import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import type { Pool } from './db/connection.js';
import type { Logger } from './logger.js';
import type { HealthMonitor } from './health.js';
import { registerOAuthRoutes } from './auth/discord-oauth.js';
import { requireAuth, requireAdmin } from './auth/middleware.js';
import { createSessionManager } from './auth/sessions.js';
import {
  getSources,
  insertSource,
  getAppConfig,
  setAppConfig,
  type ReportRow,
  type SummaryRow,
  type SourceRow,
  type ItemRow,
} from './db/queries.js';
import { validateUrl } from './url-validator.js';

interface UserRow {
  discord_id: string;
  username: string;
  avatar: string | null;
  role: string;
  created_at: number;
  last_login_at: number | null;
}

interface ChatHandler {
  handle(query: string, conversationId: string, userId: string): Promise<{ response: string; toolsUsed: string[] }>;
}

export async function createServer(
  config: Config,
  pool: Pool,
  log: Logger,
  healthMonitor: HealthMonitor,
  chatHandler?: ChatHandler,
): Promise<FastifyInstance> {
  const sessionManager = createSessionManager(pool, log);
  const authPreHandler = requireAuth(pool, config, sessionManager);
  const app = Fastify({ logger: false, trustProxy: config.publicUrl ? 1 : false });

  // --- Plugins ---
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { max: 50, timeWindow: '1 second' });

  // --- OAuth routes (with stricter rate limit for brute-force protection) ---
  await app.register(
    async (scope) => {
      await scope.register(rateLimit, { max: 5, timeWindow: '1 minute' });
      registerOAuthRoutes(scope, pool, log, config, authPreHandler, sessionManager);
    },
    { prefix: '' },
  );

  // --- Security headers ---
  app.addHook('onSend', async (_request, reply) => {
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cdn.discordapp.com",
    );
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  });

  // --- Health ---
  app.get('/api/v1/health', async (_request, reply) => {
    try {
      const { checks, healthy } = await healthMonitor.getStatus();
      reply.code(healthy ? 200 : 503);
      return { status: healthy ? 'ok' : 'degraded', checks };
    } catch (err) {
      log.error({ err }, 'Health check failed');
      reply.code(503);
      return { status: 'error', checks: {} };
    }
  });

  // --- Reports ---
  app.get('/api/v1/reports', { preHandler: [authPreHandler] }, async (request) => {
    const { limit: rawLimit, offset: rawOffset } = request.query as { limit?: string; offset?: string };
    const limit = Math.min(Math.max(parseInt(rawLimit ?? '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(rawOffset ?? '0', 10) || 0, 0);
    const { rows: reports } = await pool.query<ReportRow>(
      `SELECT * FROM reports ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const { rows: countRows } = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM reports`);
    return { reports, total: parseInt(countRows[0].count, 10) };
  });

  app.get('/api/v1/reports/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await pool.query<ReportRow>(
      `SELECT * FROM reports WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Report not found' });
    }
    return rows[0];
  });

  // --- Sources ---
  app.get('/api/v1/sources', { preHandler: [authPreHandler] }, async () => {
    const sources = await getSources(pool);
    return { sources };
  });

  app.post('/api/v1/sources', { preHandler: [authPreHandler] }, async (request, reply) => {
    const { source, sourceId, label } = request.body as { source?: string; sourceId?: string; label?: string };
    if (!source || !sourceId) {
      return reply.code(400).send({ error: 'source and sourceId are required' });
    }
    try {
      await insertSource(pool, source, sourceId, label ?? null, 1.0, Math.floor(Date.now() / 1000));
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        return reply.code(409).send({ error: 'Source already exists' });
      }
      throw err;
    }
    const { rows } = await pool.query<SourceRow>(
      `SELECT * FROM sources WHERE source = $1 AND source_id = $2`,
      [source, sourceId],
    );
    reply.code(201);
    return rows[0];
  });

  // --- Config ---
  app.get('/api/v1/config', { preHandler: [authPreHandler] }, async () => {
    const [digestTime, timezone, webhookUrl] = await Promise.all([
      getAppConfig(pool, 'digest_time'),
      getAppConfig(pool, 'timezone'),
      getAppConfig(pool, 'webhook_url'),
    ]);
    return { digest_time: digestTime, timezone, webhook_url: webhookUrl };
  });

  app.patch('/api/v1/config', { preHandler: [authPreHandler, requireAdmin] }, async (request, reply) => {
    const body = request.body as Record<string, string>;
    const allowedKeys = ['digest_time', 'timezone', 'webhook_url'];

    // Validate webhook_url if provided (SSRF protection — D-010)
    if ('webhook_url' in body && body['webhook_url']) {
      const validation = await validateUrl(body['webhook_url']);
      if (!validation.valid) {
        return reply.code(400).send({ error: `Invalid webhook URL: ${validation.reason}` });
      }
    }

    const updates: Array<Promise<void>> = [];
    for (const key of allowedKeys) {
      if (key in body) {
        updates.push(setAppConfig(pool, key, body[key]));
      }
    }
    await Promise.all(updates);
    const [digestTime, timezone, webhookUrl] = await Promise.all([
      getAppConfig(pool, 'digest_time'),
      getAppConfig(pool, 'timezone'),
      getAppConfig(pool, 'webhook_url'),
    ]);
    return { digest_time: digestTime, timezone, webhook_url: webhookUrl };
  });

  // --- Search ---
  app.get('/api/v1/search', { preHandler: [authPreHandler] }, async (request, reply) => {
    const { q, limit: rawLimit } = request.query as { q?: string; limit?: string };
    if (!q) {
      return reply.code(400).send({ error: 'q query parameter is required' });
    }
    const limit = Math.min(Math.max(parseInt(rawLimit ?? '20', 10) || 20, 1), 100);
    const { rows: results } = await pool.query<SummaryRow>(
      `SELECT * FROM summaries WHERE body ILIKE $1 ORDER BY created_at DESC LIMIT $2`,
      [`%${q}%`, limit],
    );
    return { results };
  });

  // --- Raw feed ---
  app.get('/api/v1/feed/:sourceId', { preHandler: [authPreHandler] }, async (request) => {
    const { sourceId } = request.params as { sourceId: string };
    const { limit: rawLimit } = request.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(rawLimit ?? '50', 10) || 50, 1), 200);
    const { rows: items } = await pool.query<ItemRow>(
      `SELECT * FROM items WHERE source_id = $1 ORDER BY timestamp DESC LIMIT $2`,
      [sourceId, limit],
    );
    return { items };
  });

  app.post('/api/v1/chat', {
    preHandler: [authPreHandler],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!chatHandler) {
      return reply.code(501).send({ error: 'Chat not available' });
    }
    const body = request.body;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'Invalid request body' });
    }
    const { query, conversationId } = body as { query: string; conversationId?: string };
    if (!query || typeof query !== 'string') {
      return reply.code(400).send({ error: 'query is required' });
    }
    const userId = request.user!.discordId;
    const result = await chatHandler.handle(query, conversationId ?? userId, userId);
    return result;
  });

  app.get('/api/v1/users', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const { rows: users } = await pool.query<UserRow>(
      `SELECT * FROM users ORDER BY created_at DESC`,
    );
    return { users };
  });

  // --- Static files (dashboard SPA) ---
  const dashboardRoot = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'dashboard',
    'dist',
  );
  await app.register(fastifyStatic, {
    root: dashboardRoot,
    prefix: '/',
  });

  // --- Global error handler ---
  app.setErrorHandler(async (error, request, reply) => {
    log.error({ err: error, url: request.url, method: request.method }, 'Unhandled route error');
    reply.code(500).send({ error: 'Internal server error' });
  });

  // SPA catch-all for client-side routing
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404);
      return { error: 'Not found' };
    }
    return reply.sendFile('index.html');
  });

  return app;
}

export async function startServer(
  app: FastifyInstance,
  port: number,
  log: Logger,
): Promise<void> {
  await app.listen({ port, host: '0.0.0.0' });
  log.info(`Server listening on port ${port}`);
}
