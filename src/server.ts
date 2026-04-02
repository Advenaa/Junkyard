import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import type { Pool } from './db/connection.js';
import type { Logger } from './logger.js';

export async function createServer(
  config: Config,
  pool: Pool,
  log: Logger,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // --- Plugins ---
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { max: 100, timeWindow: '1 second' });

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
  app.get('/api/v1/health', async () => {
    return { status: 'ok' };
  });

  // --- Skeleton routes ---
  app.get('/api/v1/reports', async () => {
    return { todo: true };
  });

  app.get('/api/v1/reports/:id', async () => {
    return { todo: true };
  });

  app.get('/api/v1/sources', async () => {
    return { todo: true };
  });

  app.post('/api/v1/sources', async () => {
    return { todo: true };
  });

  app.get('/api/v1/config', async () => {
    return { todo: true };
  });

  app.patch('/api/v1/config', async () => {
    return { todo: true };
  });

  app.get('/api/v1/search', async () => {
    return { todo: true };
  });

  app.get('/api/v1/feed/:sourceId', async () => {
    return { todo: true };
  });

  app.post('/api/v1/chat', async () => {
    return { todo: true };
  });

  app.get('/api/v1/users', async () => {
    return { todo: true };
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
