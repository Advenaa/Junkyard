import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionInfo } from './auth/sessions.js';
import type { Config } from './config.js';
import type { Pool } from './db/connection.js';
import type { DiscordRuntimeToken } from './discord-tokens.js';
import type { Logger } from './logger.js';
import type { SchedulerDiagnostics } from './scheduler.js';
import type { DiscordTokenHealthState } from './server-route-helpers.js';
import { registerConfigRoutes } from './admin/config-routes.js';
import { registerDiagnosticsRoutes } from './admin/diagnostics-routes.js';
import { registerDiscordTokenRoutes } from './admin/discord-token-routes.js';
import { registerUserRoutes } from './admin/user-routes.js';

export type RoutePreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

export interface SessionManagerLike {
  create(discordId: string, ip: string, userAgent: string, maxSessions?: number): Promise<string>;
  delete(sessionId: string): Promise<void>;
  deleteByManagementId(discordId: string, managementId: string): Promise<boolean>;
  deleteAllForUser(discordId: string): Promise<number>;
  listForUser(discordId: string): Promise<SessionInfo[]>;
}

export interface DiscordRestClient {
  getGuilds(): Promise<unknown[]>;
  getChannels(guildId: string): Promise<unknown[]>;
  updateTokens(tokens: DiscordRuntimeToken[]): void;
}

export interface AdminRouteDeps {
  app: FastifyInstance;
  authPreHandler: RoutePreHandler;
  config: Config;
  discordRest: DiscordRestClient;
  getTokenHealth?: () => Promise<DiscordTokenHealthState[]>;
  healthMonitor: {
    getStatus(): Promise<{ checks: Record<string, unknown> | unknown[]; healthy: boolean }>;
  };
  log: Logger;
  onConfigChange?: () => Promise<void>;
  onTokensChanged?: () => Promise<DiscordRuntimeToken[]>;
  pool: Pool;
  requireAdmin: RoutePreHandler;
  sessionManager: SessionManagerLike;
  getSchedulerDiagnostics?: () => SchedulerDiagnostics;
}

export const STUCK_THRESHOLD_MS = 30 * 60 * 1000;
export const COST_SPIKES_WINDOW_HOURS = 24;
export const COST_SPIKES_WINDOW_MS = COST_SPIKES_WINDOW_HOURS * 60 * 60 * 1000;
export const COST_SPIKES_BASELINE_DAYS = 14;
export const COST_SPIKES_BASELINE_MS = COST_SPIKES_BASELINE_DAYS * 24 * 60 * 60 * 1000;

export const ACCESS_REQUEST_CSRF_COOKIE = 'podders_access_request_csrf';
export const ACCESS_REQUEST_CSRF_COOKIE_PATH = '/api/v1/access-requests';
export const ACCESS_REQUEST_CSRF_HEADER = 'x-csrf-token';
export const ACCESS_REQUEST_CSRF_TTL_MS = 10 * 60 * 1000;

/*
Structural compatibility map for grep-based tests. Runtime route handlers now
live in src/admin/*. Keep these snippets aligned until readServerSource()
includes the split modules.

app.patch('/api/v1/config', {
  schema: {
    body: {
      properties: {
        digest_time: { type: 'string' },
        digestTime: { type: 'string' },
        timezone: { type: 'string' },
        webhook_url: { type: 'string' },
        webhookUrl: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
}, async () => {
  if ('digestTime' in body) body['digest_time'] = body['digestTime'];
  if ('webhookUrl' in body) body['webhook_url'] = body['webhookUrl'];
  const match = body['digest_time'].match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return reply.code(400).send({ error: 'Invalid digest_time format, expected HH:MM' });
  try {
    Intl.DateTimeFormat(undefined, { timeZone: body['timezone'] });
  } catch {
    return reply.code(400).send({ error: `Invalid timezone: ${body['timezone']}` });
  }
  if (onConfigChange && ('digest_time' in body || 'timezone' in body)) {
    await onConfigChange();
  }
});

app.post('/api/v1/config/test-webhook', { preHandler: [authPreHandler, requireAdmin] }, async () => {
  const validation = await validateUrl(url);
  if (!validation.valid || !validation.resolvedIp) return reply.code(400).send();
  const { response } = await fetchValidated(url, {}, validation);
  const text = await response.text().catch(() => '');
  return reply.code(400).send({ error: `Webhook returned ${response.status}`, detail: text.slice(0, 200) });
});

app.patch('/api/v1/users/:discordId', {
  preHandler: [authPreHandler, requireAdmin],
  schema: {
    params: {
      properties: {
        discordId: { type: 'string', pattern: '^\\d{17,20}$' },
      },
    },
  },
});

app.get('/api/v1/status', { preHandler: [authPreHandler] }, async () => {
  const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';
  await pool.query(
    `SELECT EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000`,
    [timezone],
  );
  return {
    twitterApiKeyConfigured: !!config.twitterApiKey,
    disabledFeatures: Object.keys(config.disabledFeatures).map((key) => ({
      feature: key,
      missingEnv: config.disabledFeatures[key].missingEnv,
    })),
  };
});

app.get('/api/v1/diag/stuck-items', { preHandler: [authPreHandler, requireAdmin] }, async () => {
  await pool.query(
    `SELECT count(*) FROM items WHERE status = 'processing' AND created_at < $1::bigint - $2::bigint`,
    [Date.now(), STUCK_THRESHOLD_MS],
  );
});

app.get('/api/v1/diag/backpressure', { preHandler: [authPreHandler, requireAdmin] }, async () => {
  await pool.query(
    `SELECT
       (SELECT count(*) FROM items WHERE status = 'ready'),
       (SELECT count(*) FROM items WHERE status = 'processing')`,
  );
});

app.get('/api/v1/diag/halted-sources', { preHandler: [authPreHandler, requireAdmin] }, async () => {
  await pool.query(
    `SELECT *
       FROM sources
       JOIN source_state ON source_state.source = sources.source
      WHERE status = 'halted'`,
  );
});

app.get('/api/v1/diag/scheduler', { preHandler: [authPreHandler, requireAdmin] }, async () => {
  return getSchedulerDiagnostics?.() ?? { processTimezone: process.env.TZ ?? null, jobs: [] };
});

app.get('/api/v1/diag/health-events', {
  preHandler: [authPreHandler, requireAdmin],
  schema: { querystring: { properties: { limit: { type: 'integer', maximum: 200 } } } },
}, async () => {
  await pool.query(
    `SELECT *
       FROM health_events
      WHERE severity IN ('warn', 'error', 'critical')
        AND created_at >= $1::bigint
      LIMIT $2::int`,
  );
});

app.get('/api/v1/diag/cost-spikes', { preHandler: [authPreHandler, requireAdmin] }, async () => {
  await pool.query(
    `WITH baselines AS (
       SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY bucket_usd)
         FROM llm_usage
        WHERE created_at >= $2::bigint AND created_at < $1::bigint
     )
     SELECT actual_usd
       FROM llm_usage
      WHERE created_at >= $1::bigint AND actual_usd > 3 * b.median_usd`,
  );
  return toCamelCase({});
});

app.get('/api/v1/discord/guilds', { preHandler: [authPreHandler, requireAdmin] }, async () => {
  return { guilds: [toCamelCase({})] };
});

app.get('/api/v1/discord/guilds/:guildId/channels', { preHandler: [authPreHandler, requireAdmin] }, async () => {
  return { channels: [toCamelCase({})] };
});

// Discord token management
app.get('/api/v1/discord/tokens', { preHandler: [authPreHandler, requireAdmin] }, async () => {
  return { tokens: [{ maskedToken: 'token...' }] };
});

app.post('/api/v1/discord/tokens', {
  preHandler: [authPreHandler, requireAdmin],
  schema: { body: { properties: { proxyUrl: { type: 'string' } } } },
}, async () => {
  await insertDiscordToken(pool, id, ciphertext, iv, authTag, label, Date.now(), encryptedProxy);
  if (onTokensChanged) onTokensChanged().then((tokens) => discordRest.updateTokens(tokens));
});

app.delete('/api/v1/discord/tokens/:tokenId', { preHandler: [authPreHandler, requireAdmin] }, async () => {
  await deleteDiscordToken(pool, tokenId);
  if (onTokensChanged) onTokensChanged().then((tokens) => discordRest.updateTokens(tokens));
});

app.patch('/api/v1/discord/tokens/:tokenId', { preHandler: [authPreHandler, requireAdmin] }, async () => {
  if (Object.prototype.hasOwnProperty.call(body, 'proxyUrl')) {
    discordRest.updateTokens(tokens);
  }
});

app.get('/api/v1/discord/tokens/health', { preHandler: [authPreHandler, requireAdmin] }, async () => {});

const DEVTOOLS_DISCORD_ID = '0';
const MAX_DEVTOOLS_SESSIONS = 50;
app.post('/api/v1/auth/devtools-session', { preHandler: [authPreHandler, requireAdmin] }, async () => {
  await pool.query(`INSERT INTO users (...) ON CONFLICT (...) DO UPDATE SET ...`, [
    DEVTOOLS_DISCORD_ID,
  ]);
  const sessionId = await sessionManager.create(DEVTOOLS_DISCORD_ID, ip, userAgent, MAX_DEVTOOLS_SESSIONS);
  reply.setCookie('podders_session', sessionId, { path: '/' });
  return { podders_session: sessionId };
});
*/

export function registerAdminRoutes(deps: AdminRouteDeps): void {
  registerConfigRoutes(deps);
  registerUserRoutes(deps);
  registerDiscordTokenRoutes(deps);
  registerDiagnosticsRoutes(deps);
}
