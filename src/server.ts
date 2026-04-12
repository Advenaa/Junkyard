import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import type { Pool } from './db/connection.js';
import type { HealthMonitor } from './health.js';
import type { Logger } from './logger.js';
import { registerOAuthRoutes } from './auth/discord-oauth.js';
import { requireAdmin, requireAuth } from './auth/middleware.js';
import { createSessionManager } from './auth/sessions.js';
import { createDiscordRest } from './ingest/discord-rest.js';
import { createEnvDiscordTokens, type DiscordRuntimeToken } from './discord-tokens.js';
import { registerAdminRoutes } from './server-admin-routes.js';
import { registerBookmarkRoutes } from './server-bookmark-routes.js';
import { registerCalendarRoutes } from './server-calendar-routes.js';
import { registerEntityRoutes } from './server-entity-routes.js';
import { registerFeedbackRoutes } from './server-feedback-routes.js';
import { registerInsightRoutes } from './server-insight-routes.js';
import { registerOnboardingRoutes } from './server-onboarding-routes.js';
import { registerReportRoutes } from './server-report-routes.js';
import {
  getNarrativeSummaryPreview,
  type ChatHandler,
  type DiscordTokenHealthState,
  toCamelCase,
} from './server-route-helpers.js';
import { registerSearchRoutes } from './server-search-routes.js';
import { registerSourceRoutes } from './server-source-routes.js';
import type { SchedulerDiagnostics } from './scheduler.js';

export async function createServer(
  config: Config,
  pool: Pool,
  log: Logger,
  healthMonitor: HealthMonitor,
  chatHandler?: ChatHandler,
  onConfigChange?: () => Promise<void>,
  onTokensChanged?: () => Promise<DiscordRuntimeToken[]>,
  getTokenHealth?: () => Promise<DiscordTokenHealthState[]>,
  initialDiscordTokens: DiscordRuntimeToken[] = createEnvDiscordTokens(config.discordTokens),
  getSchedulerDiagnostics?: () => SchedulerDiagnostics,
): Promise<FastifyInstance> {
  // Warn if Discord OAuth is configured without PUBLIC_URL (DB-008)
  if (config.discordClientId && config.discordClientSecret && !config.publicUrl) {
    log.warn('Discord OAuth is configured but PUBLIC_URL is not set — OAuth redirects will fail');
  }

  const sessionManager = createSessionManager(pool, log);
  const authPreHandler = requireAuth(pool, config, sessionManager);
  const discordRest = createDiscordRest(initialDiscordTokens, log);
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

  registerReportRoutes({ app, authPreHandler, pool });
  registerBookmarkRoutes({ app, authPreHandler, pool });
  registerFeedbackRoutes({ app, authPreHandler, requireAdmin, pool });
  registerOnboardingRoutes({ app, authPreHandler, pool });
  registerSourceRoutes({ app, authPreHandler, requireAdmin, pool });
  registerSearchRoutes({ app, authPreHandler, chatHandler, config, pool });

  registerAdminRoutes({
    app,
    authPreHandler,
    config,
    discordRest,
    getTokenHealth,
    healthMonitor,
    log,
    onConfigChange,
    onTokensChanged,
    pool,
    requireAdmin,
    sessionManager,
    getSchedulerDiagnostics,
  });

  registerInsightRoutes({
    app,
    authPreHandler,
    config,
    pool,
    getNarrativeSummaryPreview,
  });

  registerCalendarRoutes({
    app,
    authPreHandler,
    requireAdmin,
    pool,
    toCamelCase,
  });

  registerEntityRoutes({ app, authPreHandler, config, pool, requireAdmin });

  // --- Static files (dashboard SPA) ---
  const dashboardRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'dist');
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

export async function startServer(app: FastifyInstance, port: number, log: Logger): Promise<void> {
  try {
    await app.listen({ port, host: '0.0.0.0' });
    log.info(`Server listening on port ${port}`);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      log.fatal({ port }, `Port ${port} is already in use — is another instance running?`);
      process.exit(1);
    }
    throw err;
  }
}
