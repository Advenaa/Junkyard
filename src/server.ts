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
  const app = Fastify({ logger: false });

  // --- Plugins ---
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { max: 50, timeWindow: '1 second' });

  // --- OAuth routes (with stricter rate limit for brute-force protection) ---
  await app.register(
    async (scope) => {
      await scope.register(rateLimit, { max: 5, timeWindow: '1 minute' });
      registerOAuthRoutes(scope, pool, log, config, authPreHandler);
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
  });

  // --- Health ---
  app.get('/api/v1/health', async (_request, reply) => {
    const { checks, healthy } = await healthMonitor.getStatus();
    reply.code(healthy ? 200 : 503);
    return { status: healthy ? 'ok' : 'degraded', checks };
  });

  // --- Skeleton routes ---
  app.get('/api/v1/reports', { preHandler: [authPreHandler] }, async () => {
    return { todo: true };
  });

  app.get('/api/v1/reports/:id', { preHandler: [authPreHandler] }, async () => {
    return { todo: true };
  });

  app.get('/api/v1/sources', { preHandler: [authPreHandler] }, async () => {
    return { todo: true };
  });

  app.post('/api/v1/sources', { preHandler: [authPreHandler] }, async () => {
    return { todo: true };
  });

  app.get('/api/v1/config', { preHandler: [authPreHandler] }, async () => {
    return { todo: true };
  });

  app.patch('/api/v1/config', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    return { todo: true };
  });

  app.get('/api/v1/search', { preHandler: [authPreHandler] }, async () => {
    return { todo: true };
  });

  app.get('/api/v1/feed/:sourceId', { preHandler: [authPreHandler] }, async () => {
    return { todo: true };
  });

  app.post('/api/v1/chat', {
    preHandler: [authPreHandler],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!chatHandler) {
      return reply.code(501).send({ error: 'Chat not available' });
    }
    const { query, conversationId } = request.body as { query: string; conversationId?: string };
    if (!query || typeof query !== 'string') {
      return reply.code(400).send({ error: 'query is required' });
    }
    const userId = request.user!.discordId;
    const result = await chatHandler.handle(query, conversationId ?? userId, userId);
    return result;
  });

  app.get('/api/v1/users', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    return { todo: true };
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
