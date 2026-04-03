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
  getAllSourcesWithState,
  insertSource,
  getAppConfig,
  setAppConfig,
  type ReportRow,
  type SummaryRow,
  type SourceRow,
  type ItemRow,
} from './db/queries.js';
import net from 'node:net';
import { validateUrl } from './url-validator.js';

/** Convert object keys from snake_case to camelCase. Shallow — does not recurse into nested objects. */
function toCamelCase<T>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

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
  // Warn if Discord OAuth is configured without PUBLIC_URL (DB-008)
  if (config.discordClientId && config.discordClientSecret && !config.publicUrl) {
    log.warn('Discord OAuth is configured but PUBLIC_URL is not set — OAuth redirects will fail');
  }

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
  app.addHook('onSend', async (request, reply) => {
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cdn.discordapp.com",
    );
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

    // Cache-Control for dashboard assets (DB-005)
    if (request.url.startsWith('/assets/')) {
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (request.url === '/' || request.url.endsWith('.html')) {
      reply.header('Cache-Control', 'no-cache');
    }
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
    const { limit: rawLimit, offset: rawOffset, type } = request.query as { limit?: string; offset?: string; type?: string };
    const limit = Math.min(Math.max(parseInt(rawLimit ?? '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(rawOffset ?? '0', 10) || 0, 0);
    const params: unknown[] = [limit, offset];
    let whereClause = '';
    if (type) {
      params.push(type);
      whereClause = `WHERE type = $${params.length}`;
    }
    const { rows: reports } = await pool.query<ReportRow>(
      `SELECT * FROM reports ${whereClause} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    const countParams: unknown[] = [];
    let countWhere = '';
    if (type) {
      countParams.push(type);
      countWhere = `WHERE type = $1`;
    }
    const { rows: countRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM reports ${countWhere}`,
      countParams,
    );
    return { reports: reports.map(r => toCamelCase(r as unknown as Record<string, unknown>)), total: parseInt(countRows[0].count, 10) };
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
    const report = toCamelCase<Record<string, unknown>>(rows[0] as unknown as Record<string, unknown>);
    // Parse body JSON to extract nested fields for the frontend
    if (typeof report.body === 'string') {
      try {
        const parsed = JSON.parse(report.body) as Record<string, unknown>;
        report.keyEvents = (parsed.keyEvents ?? parsed.key_events ?? []) as unknown[];
        report.entitySentiment = (parsed.entitySentiment ?? parsed.entity_sentiment ?? []) as unknown[];
        report.sections = (parsed.sections ?? []) as unknown[];
      } catch {
        // body is not valid JSON — leave it as-is
      }
    }
    return reply.send({ report });
  });

  // --- Sources ---
  app.get('/api/v1/sources', { preHandler: [authPreHandler] }, async () => {
    const sources = await getAllSourcesWithState(pool);
    return { sources: sources.map(r => toCamelCase(r as unknown as Record<string, unknown>)) };
  });

  app.post('/api/v1/sources', {
    preHandler: [authPreHandler, requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['source', 'sourceId'],
        properties: {
          source: { type: 'string', enum: ['discord', 'twitter', 'rss', 'news'] },
          sourceId: { type: 'string', minLength: 1, maxLength: 255 },
          label: { type: 'string', maxLength: 255 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { source, sourceId, label } = request.body as { source?: string; sourceId?: string; label?: string };
    if (!source || !sourceId) {
      return reply.code(400).send({ error: 'source and sourceId are required' });
    }
    if (source === 'rss') {
      const validation = await validateUrl(sourceId);
      if (!validation.valid) {
        return reply.code(400).send({ error: `Invalid RSS feed URL: ${validation.reason}` });
      }
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
    return toCamelCase(rows[0] as unknown as Record<string, unknown>);
  });

  // --- Config ---
  app.get('/api/v1/config', { preHandler: [authPreHandler] }, async () => {
    const [digestTime, timezone, webhookUrl] = await Promise.all([
      getAppConfig(pool, 'digest_time'),
      getAppConfig(pool, 'timezone'),
      getAppConfig(pool, 'webhook_url'),
    ]);
    return { digestTime, timezone, webhookUrl };
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
    return { digestTime, timezone, webhookUrl };
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
    return { results: results.map(r => toCamelCase(r as unknown as Record<string, unknown>)) };
  });

  // --- Raw feed ---
  app.get('/api/v1/feed/:sourceId', {
    preHandler: [authPreHandler],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          offset: { type: 'integer', minimum: 0 },
          after: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const { sourceId } = request.params as { sourceId: string };
    const { limit: rawLimit, offset, after } = request.query as {
      limit?: number;
      offset?: number;
      after?: number;
    };
    const limit = Math.min(Math.max(rawLimit ?? 50, 1), 200);

    let sql = `SELECT * FROM items WHERE source_id = $1`;
    const params: (string | number)[] = [sourceId];

    if (after != null) {
      params.push(after);
      sql += ` AND timestamp > $${params.length}`;
    }

    sql += ` ORDER BY timestamp DESC`;

    params.push(limit);
    sql += ` LIMIT $${params.length}`;

    if (offset != null) {
      params.push(offset);
      sql += ` OFFSET $${params.length}`;
    }

    const { rows: items } = await pool.query<ItemRow>(sql, params);
    const parsed = items.map(r => {
      const camelRow = toCamelCase<Record<string, unknown>>(r as unknown as Record<string, unknown>);
      // Parse attachments JSON string to array
      if (typeof camelRow.attachments === 'string') {
        try {
          camelRow.attachments = JSON.parse(camelRow.attachments);
        } catch {
          camelRow.attachments = [];
        }
      } else if (camelRow.attachments === null || camelRow.attachments === undefined) {
        camelRow.attachments = [];
      }
      return camelRow;
    });
    return { items: parsed };
  });

  app.post('/api/v1/chat', {
    preHandler: [authPreHandler],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 4000 },
          conversationId: { type: 'string', maxLength: 100 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!chatHandler) {
      return reply.code(501).send({ error: 'Chat not available' });
    }
    const { query, conversationId } = request.body as { query: string; conversationId?: string };
    const userId = request.user!.discordId;
    const result = await chatHandler.handle(query, conversationId ?? userId, userId);
    return result;
  });

  app.get('/api/v1/users', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const { rows: users } = await pool.query<UserRow>(
      `SELECT * FROM users ORDER BY created_at DESC`,
    );
    return { users: users.map(r => toCamelCase(r as unknown as Record<string, unknown>)) };
  });

  // --- PATCH /sources/:source/:sourceId (CD-002) ---
  app.patch('/api/v1/sources/:source/:sourceId', {
    preHandler: [authPreHandler, requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      params: {
        type: 'object',
        required: ['source', 'sourceId'],
        properties: {
          source: { type: 'string' },
          sourceId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { source, sourceId } = request.params as { source: string; sourceId: string };
    const { enabled } = request.body as { enabled: boolean };

    // Check current status — block re-enabling halted sources (CR-001)
    const { rows: stateRows } = await pool.query<{ status: string; last_error: string | null }>(
      `SELECT status, last_error FROM source_state WHERE source = $1 AND source_id = $2`,
      [source, sourceId],
    );
    if (stateRows.length === 0) {
      return reply.code(404).send({ error: 'Source not found' });
    }
    const currentStatus = stateRows[0].status;
    if (currentStatus === 'halted' && enabled) {
      return reply.code(409).send({
        error: 'Source is halted — fix the underlying issue before re-enabling',
        lastError: stateRows[0].last_error,
      });
    }

    const newStatus = enabled ? 'active' : 'disabled';
    await pool.query(
      `UPDATE source_state SET status = $1 WHERE source = $2 AND source_id = $3`,
      [newStatus, source, sourceId],
    );
    return { source, sourceId, status: newStatus };
  });

  // --- PATCH /users/:discordId (CD-003) ---
  app.patch('/api/v1/users/:discordId', {
    preHandler: [authPreHandler, requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', enum: ['admin', 'viewer', 'blocked'] },
        },
        additionalProperties: false,
      },
      params: {
        type: 'object',
        required: ['discordId'],
        properties: {
          discordId: { type: 'string', pattern: '^\\d{17,20}$' },
        },
      },
    },
  }, async (request) => {
    const { discordId } = request.params as { discordId: string };
    const { role } = request.body as { role: string };
    await pool.query(
      `INSERT INTO users (discord_id, role) VALUES ($1, $2) ON CONFLICT (discord_id) DO UPDATE SET role = $2`,
      [discordId, role],
    );
    return { discordId, role };
  });

  // --- GET /api/v1/status (CD-004) ---
  app.get('/api/v1/status', { preHandler: [authPreHandler] }, async () => {
    const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';
    const { rows } = await pool.query<{
      items_ready: string;
      items_processing: string;
      summaries_today: string;
      cost_today: string;
    }>(
      `SELECT
        (SELECT count(*) FROM items WHERE status = 'ready') AS items_ready,
        (SELECT count(*) FROM items WHERE status = 'processing') AS items_processing,
        (SELECT count(*) FROM summaries WHERE created_at > EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000) AS summaries_today,
        (SELECT COALESCE(SUM(cost_usd), 0) FROM llm_usage WHERE created_at > EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000) AS cost_today`,
      [timezone],
    );
    const row = rows[0];
    return {
      itemsReady: parseInt(row.items_ready, 10),
      itemsProcessing: parseInt(row.items_processing, 10),
      summariesToday: parseInt(row.summaries_today, 10),
      costToday: parseFloat(row.cost_today),
    };
  });

  // --- POST /api/v1/config/test-webhook (CD-005) ---
  app.post('/api/v1/config/test-webhook', {
    preHandler: [authPreHandler, requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', minLength: 1, maxLength: 2048 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { url } = request.body as { url: string };
    const validation = await validateUrl(url);
    if (!validation.valid || !validation.resolvedIp) {
      return reply.code(400).send({ error: `Invalid webhook URL: ${validation.reason ?? 'DNS resolution failed'}` });
    }
    try {
      const payload = JSON.stringify({
        embeds: [{
          title: 'Podders Test Webhook',
          description: 'If you can see this, your webhook is configured correctly.',
          color: 0x5B8DEF,
          timestamp: new Date().toISOString(),
          footer: { text: 'podders — test delivery' },
        }],
        allowed_mentions: { parse: [] },
      });
      // Pin to resolved IP to prevent DNS rebinding (TOCTOU) between validateUrl and fetch
      const parsed = new URL(url);
      const pinnedUrl = new URL(url);
      pinnedUrl.hostname = net.isIPv6(validation.resolvedIp) ? `[${validation.resolvedIp}]` : validation.resolvedIp;
      const response = await fetch(pinnedUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Host: parsed.host },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return reply.code(400).send({ error: `Webhook returned ${response.status}`, detail: text });
      }
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(400).send({ error: `Webhook delivery failed: ${message}` });
    }
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
    // Return 404 for missing static assets instead of index.html (DB-003)
    if (/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf|eot|map|json)$/i.test(request.url)) {
      return reply.code(404).send({ error: 'Not found' });
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
