import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionInfo } from './auth/sessions.js';
import type { Config } from './config.js';
import type { Pool } from './db/connection.js';
import type { Logger } from './logger.js';
import {
  deleteDiscordToken,
  getAppConfig,
  getLlmCostByModel,
  insertDiscordToken,
  setAppConfig,
  updateDiscordTokenLabel,
  updateDiscordTokenProxy,
  updateDiscordTokenStatus,
} from './db/queries.js';
import { encryptSecret, getEncryptionKey } from './crypto/token-encrypt.js';
import { type DiscordRuntimeToken, maskProxyUrl, normalizeProxyUrl } from './discord-tokens.js';
import { fetchValidated, validateUrl } from './url-validator.js';
import {
  type AccessRequestRow,
  type DiscordTokenHealthState,
  getManagedDiscordTokenViews,
  recordUserAuditEvent,
  timingSafeEqualString,
  toCamelCase,
  type UserAuditRow,
  type UserRow,
} from './server-route-helpers.js';
import type { SchedulerDiagnostics } from './scheduler.js';

type RoutePreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

interface SessionManagerLike {
  create(discordId: string, ip: string, userAgent: string): Promise<string>;
  delete(sessionId: string): Promise<void>;
  deleteAllForUser(discordId: string): Promise<number>;
  listForUser(discordId: string): Promise<SessionInfo[]>;
}

interface DiscordRestClient {
  getGuilds(): Promise<unknown[]>;
  getChannels(guildId: string): Promise<unknown[]>;
  updateTokens(tokens: DiscordRuntimeToken[]): void;
}

interface AdminRouteDeps {
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

const STUCK_THRESHOLD_MS = 30 * 60 * 1000;
const COST_SPIKES_WINDOW_HOURS = 24;
const COST_SPIKES_WINDOW_MS = COST_SPIKES_WINDOW_HOURS * 60 * 60 * 1000;
const COST_SPIKES_BASELINE_DAYS = 14;
const COST_SPIKES_BASELINE_MS = COST_SPIKES_BASELINE_DAYS * 24 * 60 * 60 * 1000;

export const ACCESS_REQUEST_CSRF_COOKIE = 'podders_access_request_csrf';
export const ACCESS_REQUEST_CSRF_COOKIE_PATH = '/api/v1/access-requests';
export const ACCESS_REQUEST_CSRF_HEADER = 'x-csrf-token';
export const ACCESS_REQUEST_CSRF_TTL_MS = 10 * 60 * 1000;

export function registerAdminRoutes({
  app,
  authPreHandler,
  config,
  discordRest,
  getTokenHealth,
  healthMonitor: _healthMonitor,
  log,
  onConfigChange,
  onTokensChanged,
  pool,
  requireAdmin,
  sessionManager,
  getSchedulerDiagnostics,
}: AdminRouteDeps): void {
  app.get('/api/v1/config', { preHandler: [authPreHandler] }, async (request) => {
    const [digestTime, timezone, webhookUrl] = await Promise.all([
      getAppConfig(pool, 'digest_time'),
      getAppConfig(pool, 'timezone'),
      getAppConfig(pool, 'webhook_url'),
    ]);
    const apiKey = request.user?.role === 'admin' ? config.apiKey : undefined;
    return { digestTime, timezone, webhookUrl, apiKey };
  });

  app.patch(
    '/api/v1/config',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
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
    },
    async (request, reply) => {
      const body = request.body as Record<string, string>;
      if ('digestTime' in body) {
        body['digest_time'] = body['digestTime'];
        delete body['digestTime'];
      }
      if ('webhookUrl' in body) {
        body['webhook_url'] = body['webhookUrl'];
        delete body['webhookUrl'];
      }
      const allowedKeys = ['digest_time', 'timezone', 'webhook_url'];

      if ('digest_time' in body && body['digest_time']) {
        const match = body['digest_time'].match(/^(\d{1,2}):(\d{2})$/);
        if (!match) {
          return reply.code(400).send({ error: 'Invalid digest_time format, expected HH:MM' });
        }
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
          return reply.code(400).send({ error: 'digest_time out of range (hour 0-23, minute 0-59)' });
        }
      }

      if ('timezone' in body && body['timezone']) {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: body['timezone'] });
        } catch {
          return reply.code(400).send({ error: `Invalid timezone: ${body['timezone']}` });
        }
      }

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

      if (onConfigChange && ('digest_time' in body || 'timezone' in body)) {
        try {
          await onConfigChange();
        } catch (err) {
          log.error({ err }, 'config change callback failed');
        }
      }

      const [digestTime, timezone, webhookUrl] = await Promise.all([
        getAppConfig(pool, 'digest_time'),
        getAppConfig(pool, 'timezone'),
        getAppConfig(pool, 'webhook_url'),
      ]);
      return { digestTime, timezone, webhookUrl };
    },
  );

  app.get('/api/v1/users', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const { rows: users } = await pool.query<UserRow>(`SELECT * FROM users ORDER BY created_at DESC`);
    return { users: users.map((r) => toCamelCase(r as unknown as Record<string, unknown>)) };
  });

  app.get('/api/v1/access-requests', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const { rows } = await pool.query<AccessRequestRow>(
      `SELECT * FROM access_requests WHERE status = 'pending' ORDER BY created_at DESC LIMIT 20`,
    );
    return { requests: rows.map((row) => toCamelCase(row as unknown as Record<string, unknown>)) };
  });

  app.get(
    '/api/v1/access-requests/csrf',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (_request, reply) => {
      const csrfToken = crypto.randomBytes(32).toString('hex');
      reply.setCookie(ACCESS_REQUEST_CSRF_COOKIE, csrfToken, {
        httpOnly: true,
        signed: true,
        secure: config.publicUrl?.startsWith('https') ?? false,
        sameSite: 'strict',
        path: ACCESS_REQUEST_CSRF_COOKIE_PATH,
        maxAge: ACCESS_REQUEST_CSRF_TTL_MS / 1000,
      });
      reply.header('Cache-Control', 'no-store');
      return { csrfToken };
    },
  );

  app.get('/api/v1/users/audit', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const { rows } = await pool.query<UserAuditRow>(`SELECT * FROM user_audit_log ORDER BY created_at DESC LIMIT 20`);
    return { events: rows.map((row) => toCamelCase(row as unknown as Record<string, unknown>)) };
  });

  app.post(
    '/api/v1/access-requests',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['discordId', 'requestedRole'],
          properties: {
            discordId: { type: 'string', pattern: '^\\d{17,20}$' },
            requestedRole: { type: 'string', enum: ['viewer', 'admin'] },
            note: { type: 'string', maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const csrfHeader = request.headers[ACCESS_REQUEST_CSRF_HEADER];
      const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      const csrfCookie = request.unsignCookie((request.cookies?.[ACCESS_REQUEST_CSRF_COOKIE] as string) ?? '');
      if (!csrfToken || !csrfCookie.valid || !csrfCookie.value || !timingSafeEqualString(csrfToken, csrfCookie.value)) {
        reply.clearCookie(ACCESS_REQUEST_CSRF_COOKIE, { path: ACCESS_REQUEST_CSRF_COOKIE_PATH });
        return reply.code(403).send({ error: 'Invalid CSRF token' });
      }
      reply.clearCookie(ACCESS_REQUEST_CSRF_COOKIE, { path: ACCESS_REQUEST_CSRF_COOKIE_PATH });

      const { discordId, requestedRole, note } = request.body as {
        discordId: string;
        requestedRole: 'viewer' | 'admin';
        note?: string;
      };
      const trimmedNote = note?.trim() ? note.trim() : null;
      const now = Date.now();
      const existing = await pool.query<AccessRequestRow>(
        `SELECT * FROM access_requests WHERE discord_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
        [discordId],
      );
      if (existing.rows.length > 0) {
        const { rows } = await pool.query<AccessRequestRow>(
          `UPDATE access_requests
             SET requested_role = $2, note = $3, created_at = $4
           WHERE id = $1
           RETURNING *`,
          [existing.rows[0].id, requestedRole, trimmedNote, now],
        );
        return toCamelCase<AccessRequestRow>(rows[0] as unknown as Record<string, unknown>);
      }

      const { ulid } = await import('ulid');
      const id = ulid();
      const { rows } = await pool.query<AccessRequestRow>(
        `INSERT INTO access_requests (
          id, discord_id, requested_role, note, status, resolved_role, decided_at, decided_by_discord_id, created_at
        ) VALUES ($1, $2, $3, $4, 'pending', NULL, NULL, NULL, $5)
        RETURNING *`,
        [id, discordId, requestedRole, trimmedNote, now],
      );
      reply.code(201);
      return toCamelCase<AccessRequestRow>(rows[0] as unknown as Record<string, unknown>);
    },
  );

  app.post(
    '/api/v1/users/invite',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['discordId', 'role'],
          properties: {
            discordId: { type: 'string', pattern: '^\\d{17,20}$' },
            role: { type: 'string', enum: ['admin', 'viewer', 'blocked'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { discordId, role } = request.body as { discordId: string; role: string };
      const now = Date.now();
      const existing = await pool.query<Pick<UserRow, 'role' | 'username'>>(
        `SELECT role, username FROM users WHERE discord_id = $1`,
        [discordId],
      );
      if (existing.rows.length > 0) {
        return reply.code(409).send({ error: 'User already exists' });
      }
      const { rows } = await pool.query<UserRow>(
        `INSERT INTO users (discord_id, username, avatar, role, created_at, last_login_at)
         VALUES ($1, $2, NULL, $3, $4, NULL)
         RETURNING *`,
        [discordId, 'Pending invite', role, now],
      );
      await recordUserAuditEvent(pool, {
        actorDiscordId: request.user!.discordId,
        actorUsername: request.user!.username,
        targetDiscordId: discordId,
        targetUsername: rows[0]?.username ?? null,
        action: 'invite',
        previousRole: null,
        newRole: role,
      });
      return toCamelCase<UserRow>(rows[0] as unknown as Record<string, unknown>);
    },
  );

  app.patch(
    '/api/v1/access-requests/:requestId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['requestId'],
          properties: {
            requestId: { type: 'string', minLength: 1 },
          },
        },
        body: {
          type: 'object',
          required: ['decision'],
          properties: {
            decision: { type: 'string', enum: ['approved', 'rejected'] },
            role: { type: 'string', enum: ['viewer', 'admin'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { requestId } = request.params as { requestId: string };
      const { decision, role } = request.body as { decision: 'approved' | 'rejected'; role?: 'viewer' | 'admin' };
      const existingRequest = await pool.query<AccessRequestRow>(`SELECT * FROM access_requests WHERE id = $1`, [
        requestId,
      ]);
      if (existingRequest.rows.length === 0) {
        return reply.code(404).send({ error: 'Access request not found' });
      }
      const accessRequest = existingRequest.rows[0];
      if (accessRequest.status !== 'pending') {
        return reply.code(409).send({ error: 'Access request already decided' });
      }

      const existingUser = await pool.query<Pick<UserRow, 'role' | 'username'>>(
        `SELECT role, username FROM users WHERE discord_id = $1`,
        [accessRequest.discord_id],
      );
      const previousRole = existingUser.rows[0]?.role ?? null;
      const now = Date.now();

      if (decision === 'approved') {
        const resolvedRole = role ?? accessRequest.requested_role;
        const { rows: userRows } = await pool.query<UserRow>(
          `INSERT INTO users (discord_id, username, avatar, role, created_at, last_login_at)
           VALUES ($1, $2, NULL, $3, $4, NULL)
           ON CONFLICT (discord_id) DO UPDATE SET role = EXCLUDED.role
           RETURNING *`,
          [accessRequest.discord_id, existingUser.rows[0]?.username ?? 'Pending invite', resolvedRole, now],
        );
        const { rows } = await pool.query<AccessRequestRow>(
          `UPDATE access_requests
             SET status = 'approved', resolved_role = $2, decided_at = $3, decided_by_discord_id = $4
           WHERE id = $1
           RETURNING *`,
          [requestId, resolvedRole, now, request.user!.discordId],
        );
        await recordUserAuditEvent(pool, {
          actorDiscordId: request.user!.discordId,
          actorUsername: request.user!.username,
          targetDiscordId: accessRequest.discord_id,
          targetUsername: userRows[0]?.username ?? existingUser.rows[0]?.username ?? null,
          action: 'request_approved',
          previousRole,
          newRole: resolvedRole,
        });
        return {
          request: toCamelCase<AccessRequestRow>(rows[0] as unknown as Record<string, unknown>),
          user: toCamelCase<UserRow>(userRows[0] as unknown as Record<string, unknown>),
        };
      }

      const { rows } = await pool.query<AccessRequestRow>(
        `UPDATE access_requests
           SET status = 'rejected', resolved_role = NULL, decided_at = $2, decided_by_discord_id = $3
         WHERE id = $1
         RETURNING *`,
        [requestId, now, request.user!.discordId],
      );
      await recordUserAuditEvent(pool, {
        actorDiscordId: request.user!.discordId,
        actorUsername: request.user!.username,
        targetDiscordId: accessRequest.discord_id,
        targetUsername: existingUser.rows[0]?.username ?? null,
        action: 'request_rejected',
        previousRole,
        newRole: null,
      });
      return { request: toCamelCase<AccessRequestRow>(rows[0] as unknown as Record<string, unknown>) };
    },
  );

  app.get('/api/v1/discord/guilds', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const guilds = await discordRest.getGuilds();
    return { guilds: guilds.map((g) => toCamelCase(g as unknown as Record<string, unknown>)) };
  });

  app.get<{ Params: { guildId: string } }>(
    '/api/v1/discord/guilds/:guildId/channels',
    { preHandler: [authPreHandler, requireAdmin] },
    async (request) => {
      const { guildId } = request.params;
      const channels = await discordRest.getChannels(guildId);
      return { channels: channels.map((c) => toCamelCase(c as unknown as Record<string, unknown>)) };
    },
  );

  // --- Discord token management ---
  app.get('/api/v1/discord/tokens', { preHandler: [authPreHandler, requireAdmin] }, async (_request, reply) => {
    const encKey = getEncryptionKey();
    if (!encKey) {
      return reply
        .code(503)
        .send({ error: 'Token encryption not configured — set TOKEN_ENCRYPTION_KEY or SESSION_SECRET' });
    }
    const tokens = (await getManagedDiscordTokenViews(pool, encKey)).map((token) => ({
      id: token.id,
      maskedToken: token.maskedToken,
      label: token.label,
      status: token.status,
      addedAt: token.addedAt,
      lastUsedAt: token.lastUsedAt,
      proxyConfigured: token.proxyConfigured,
      maskedProxy: token.maskedProxy,
    }));
    return { tokens };
  });

  app.post(
    '/api/v1/discord/tokens',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string', minLength: 1, maxLength: 500 },
            label: { type: 'string', maxLength: 100 },
            proxyUrl: { type: 'string', minLength: 1, maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const encKey = getEncryptionKey();
      if (!encKey) {
        return reply
          .code(503)
          .send({ error: 'Token encryption not configured — set TOKEN_ENCRYPTION_KEY or SESSION_SECRET' });
      }
      const { token, label, proxyUrl } = request.body as { token: string; label?: string; proxyUrl?: string };
      const { ulid } = await import('ulid');
      const id = ulid();
      const encryptedToken = encryptSecret(token, encKey);

      let encryptedProxy: { ciphertext: string; iv: string; authTag: string } | null = null;
      if (proxyUrl) {
        try {
          encryptedProxy = encryptSecret(normalizeProxyUrl(proxyUrl), encKey);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Invalid proxy URL';
          return reply.code(400).send({ error: message });
        }
      }

      await insertDiscordToken(
        pool,
        id,
        encryptedToken.ciphertext,
        encryptedToken.iv,
        encryptedToken.authTag,
        label ?? null,
        Date.now(),
        encryptedProxy,
      );
      if (onTokensChanged)
        onTokensChanged()
          .then((t) => discordRest.updateTokens(t))
          .catch((err: unknown) => log.error({ err }, 'token reload failed'));
      reply.code(201);
      return {
        id,
        label: label ?? null,
        status: 'active',
        addedAt: Date.now(),
        proxyConfigured: encryptedProxy != null,
        maskedProxy: proxyUrl ? maskProxyUrl(normalizeProxyUrl(proxyUrl)) : null,
      };
    },
  );

  app.delete<{ Params: { tokenId: string } }>(
    '/api/v1/discord/tokens/:tokenId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['tokenId'],
          properties: {
            tokenId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { tokenId } = request.params;
      const deleted = await deleteDiscordToken(pool, tokenId);
      if (!deleted) {
        return reply.code(404).send({ error: 'Token not found' });
      }
      if (onTokensChanged)
        onTokensChanged()
          .then((t) => discordRest.updateTokens(t))
          .catch((err: unknown) => log.error({ err }, 'token reload failed'));
      reply.code(204).send();
    },
  );

  app.patch<{ Params: { tokenId: string } }>(
    '/api/v1/discord/tokens/:tokenId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          properties: {
            label: { type: 'string', maxLength: 100 },
            status: { type: 'string', enum: ['active', 'disabled'] },
            proxyUrl: {
              anyOf: [{ type: 'string', minLength: 1, maxLength: 500 }, { type: 'null' }],
            },
          },
          additionalProperties: false,
        },
        params: {
          type: 'object',
          required: ['tokenId'],
          properties: {
            tokenId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { tokenId } = request.params;
      const body = request.body as { label?: string; status?: string; proxyUrl?: string | null };
      if (body.label != null) {
        const updated = await updateDiscordTokenLabel(pool, tokenId, body.label);
        if (!updated) return reply.code(404).send({ error: 'Token not found' });
      }
      if (body.status != null) {
        const updated = await updateDiscordTokenStatus(pool, tokenId, body.status);
        if (!updated) return reply.code(404).send({ error: 'Token not found' });
      }
      if (Object.prototype.hasOwnProperty.call(body, 'proxyUrl')) {
        const encKey = getEncryptionKey();
        if (!encKey) {
          return reply
            .code(503)
            .send({ error: 'Token encryption not configured — set TOKEN_ENCRYPTION_KEY or SESSION_SECRET' });
        }

        let encryptedProxy: { ciphertext: string; iv: string; authTag: string } | null = null;
        if (body.proxyUrl != null) {
          try {
            encryptedProxy = encryptSecret(normalizeProxyUrl(body.proxyUrl), encKey);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Invalid proxy URL';
            return reply.code(400).send({ error: message });
          }
        }

        const updated = await updateDiscordTokenProxy(pool, tokenId, encryptedProxy);
        if (!updated) return reply.code(404).send({ error: 'Token not found' });
      }
      if ((body.status != null || Object.prototype.hasOwnProperty.call(body, 'proxyUrl')) && onTokensChanged) {
        onTokensChanged()
          .then((t) => discordRest.updateTokens(t))
          .catch((err: unknown) => log.error({ err }, 'token reload failed'));
      }
      return { ok: true };
    },
  );

  app.get('/api/v1/discord/tokens/health', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const encKey = getEncryptionKey();
    const managedTokens = encKey ? await getManagedDiscordTokenViews(pool, encKey) : [];
    const managedById = new Map(managedTokens.map((token) => [token.id, token]));
    const runtimeStates = getTokenHealth ? await getTokenHealth() : [];

    const states: DiscordTokenHealthState[] = runtimeStates.map((state) => {
      const managedMeta = state.tokenId ? managedById.get(state.tokenId) : null;
      return {
        ...state,
        lastSuccessfulPollAt: state.lastSuccessfulPollAt ?? managedMeta?.lastUsedAt ?? null,
        label: managedMeta?.label ?? state.label ?? null,
        maskedToken: managedMeta?.maskedToken ?? state.maskedToken ?? null,
        proxyConfigured: managedMeta?.proxyConfigured ?? state.proxyConfigured ?? false,
        maskedProxy: managedMeta?.maskedProxy ?? state.maskedProxy ?? null,
      };
    });

    for (const managedToken of managedTokens) {
      if (states.some((state) => state.tokenId === managedToken.id)) {
        continue;
      }

      states.push({
        index: states.length,
        status: managedToken.status === 'active' ? 'idle' : 'disabled',
        errorCount: 0,
        lastSuccessfulPollAt: managedToken.lastUsedAt,
        channelCount: 0,
        source: 'db',
        tokenId: managedToken.id,
        label: managedToken.label,
        maskedToken: managedToken.maskedToken,
        proxyConfigured: managedToken.proxyConfigured,
        maskedProxy: managedToken.maskedProxy,
      });
    }

    return { states };
  });

  app.patch(
    '/api/v1/users/:discordId',
    {
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
    },
    async (request, reply) => {
      const { discordId } = request.params as { discordId: string };
      const { role } = request.body as { role: string };
      const existing = await pool.query<Pick<UserRow, 'role' | 'username'>>(
        `SELECT role, username FROM users WHERE discord_id = $1`,
        [discordId],
      );
      if (existing.rows.length === 0) {
        return reply.code(404).send({ error: 'User not found' });
      }
      const { rows } = await pool.query<UserRow>(`UPDATE users SET role = $2 WHERE discord_id = $1 RETURNING *`, [
        discordId,
        role,
      ]);
      if (role === 'blocked') {
        await sessionManager.deleteAllForUser(discordId);
      }
      if (existing.rows[0].role !== role) {
        await recordUserAuditEvent(pool, {
          actorDiscordId: request.user!.discordId,
          actorUsername: request.user!.username,
          targetDiscordId: discordId,
          targetUsername: rows[0]?.username ?? existing.rows[0].username ?? null,
          action: 'role_change',
          previousRole: existing.rows[0].role,
          newRole: role,
        });
      }
      return toCamelCase<UserRow>(rows[0] as unknown as Record<string, unknown>);
    },
  );

  app.get(
    '/api/v1/users/:discordId/sessions',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['discordId'],
          properties: {
            discordId: { type: 'string', pattern: '^\\d{17,20}$' },
          },
        },
      },
    },
    async (request, reply) => {
      const { discordId } = request.params as { discordId: string };
      const userExists = await pool.query(`SELECT 1 FROM users WHERE discord_id = $1`, [discordId]);
      if (userExists.rows.length === 0) {
        return reply.code(404).send({ error: 'User not found' });
      }
      const sessions = await sessionManager.listForUser(discordId);
      return { sessions };
    },
  );

  app.delete(
    '/api/v1/users/:discordId/sessions/:sessionId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['discordId', 'sessionId'],
          properties: {
            discordId: { type: 'string', pattern: '^\\d{17,20}$' },
            sessionId: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) => {
      const { discordId, sessionId } = request.params as {
        discordId: string;
        sessionId: string;
      };
      const sessionCheck = await pool.query(`SELECT 1 FROM sessions WHERE id = $1 AND discord_id = $2`, [
        sessionId,
        discordId,
      ]);
      if (sessionCheck.rows.length === 0) {
        return reply.code(404).send({ error: 'Session not found' });
      }
      await sessionManager.delete(sessionId);
      return reply.code(204).send();
    },
  );

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
      twitterApiKeyConfigured: !!config.twitterApiKey,
      itemsReady: parseInt(row.items_ready, 10),
      itemsProcessing: parseInt(row.items_processing, 10),
      summariesToday: parseInt(row.summaries_today, 10),
      costToday: parseFloat(row.cost_today),
      disabledFeatures: (Object.keys(config.disabledFeatures) as Array<keyof typeof config.disabledFeatures>)
        .filter((key) => config.disabledFeatures[key].disabled)
        .map((key) => ({
          feature: key,
          missingEnv: config.disabledFeatures[key].missingEnv,
          disables: config.disabledFeatures[key].disables,
          reason: config.disabledFeatures[key].keyRejected ? 'auth_failed' : 'missing_env',
        })),
    };
  });

  app.get('/api/v1/llm/cost-by-model', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';
    const startOfDayResult = await pool.query<{ start_of_day: string }>(
      `SELECT EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000 AS start_of_day`,
      [timezone],
    );
    const startOfDayMs = parseInt(startOfDayResult.rows[0]?.start_of_day ?? '0', 10);
    const entries = await getLlmCostByModel(pool, startOfDayMs);
    return { timezone, sinceMs: startOfDayMs, entries };
  });

  app.get('/api/v1/diag/stuck-items', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const nowMs = Date.now();
    const { rows: aggRows } = await pool.query<{
      stuck_count: string;
      oldest_age_ms: string | null;
    }>(
      `SELECT
        count(*) AS stuck_count,
        ($1::bigint - MIN(created_at))::text AS oldest_age_ms
      FROM items
      WHERE status = 'processing' AND created_at < $1::bigint - $2::bigint`,
      [nowMs, STUCK_THRESHOLD_MS],
    );
    const { rows: sampleRows } = await pool.query<{
      id: string;
      source: string;
      source_id: string;
      created_at: string;
    }>(
      `SELECT id, source, source_id, created_at::text
       FROM items
       WHERE status = 'processing' AND created_at < $1::bigint - $2::bigint
       ORDER BY created_at ASC
       LIMIT 10`,
      [nowMs, STUCK_THRESHOLD_MS],
    );
    const agg = aggRows[0];
    return {
      thresholdMs: STUCK_THRESHOLD_MS,
      stuckCount: parseInt(agg.stuck_count, 10),
      oldestAgeMs: agg.oldest_age_ms === null ? 0 : parseInt(agg.oldest_age_ms, 10),
      sample: sampleRows.map((r) => toCamelCase(r as unknown as Record<string, unknown>)),
    };
  });

  app.get('/api/v1/diag/backpressure', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const nowMs = Date.now();
    const { rows } = await pool.query<{
      ready_count: string;
      processing_count: string;
      oldest_ready_age_ms: string | null;
    }>(
      `SELECT
        (SELECT count(*) FROM items WHERE status = 'ready') AS ready_count,
        (SELECT count(*) FROM items WHERE status = 'processing') AS processing_count,
        (SELECT ($1::bigint - MIN(created_at))::text FROM items WHERE status = 'ready') AS oldest_ready_age_ms`,
      [nowMs],
    );
    const row = rows[0];
    return {
      readyCount: parseInt(row.ready_count, 10),
      processingCount: parseInt(row.processing_count, 10),
      oldestReadyAgeMs: row.oldest_ready_age_ms === null ? 0 : parseInt(row.oldest_ready_age_ms, 10),
    };
  });

  app.get('/api/v1/diag/halted-sources', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const { rows } = await pool.query<{
      source: string;
      source_id: string;
      status: string;
      error_count: number | null;
      last_error: string | null;
      last_fetched_at: string | null;
    }>(
      `SELECT s.source, s.source_id, ss.status, ss.error_count, ss.last_error, ss.last_fetched_at::text
       FROM sources s
       INNER JOIN source_state ss ON ss.source = s.source AND ss.source_id = s.source_id
       WHERE ss.status = 'halted'
       ORDER BY ss.error_count DESC NULLS LAST`,
    );
    return {
      haltedSources: rows.map((r) => toCamelCase(r as unknown as Record<string, unknown>)),
    };
  });

  app.get('/api/v1/diag/scheduler', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    return (
      getSchedulerDiagnostics?.() ?? {
        processTimezone: process.env.TZ ?? null,
        jobs: [],
      }
    );
  });

  app.get<{ Querystring: { sinceMs?: number; limit?: number } }>(
    '/api/v1/diag/health-events',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            sinceMs: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? 50;
      const sinceMs = request.query.sinceMs ?? Date.now() - 24 * 60 * 60 * 1000;
      const { rows } = await pool.query<{
        id: string;
        category: string;
        severity: string;
        message: string;
        metadata: unknown;
        acknowledged: boolean;
        created_at: string;
      }>(
        `SELECT id, category, severity, message, metadata, acknowledged, created_at::text
         FROM health_events
         WHERE severity IN ('error', 'critical') AND created_at >= $1::bigint
         ORDER BY created_at DESC
         LIMIT $2::int`,
        [sinceMs, limit],
      );
      return {
        sinceMs,
        limit,
        events: rows.map((r) => toCamelCase(r as unknown as Record<string, unknown>)),
      };
    },
  );

  app.get('/api/v1/diag/cost-spikes', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const nowMs = Date.now();
    const recentSinceMs = nowMs - COST_SPIKES_WINDOW_MS;
    const historicalSinceMs = recentSinceMs - COST_SPIKES_BASELINE_MS;
    const { rows } = await pool.query<{
      model: string;
      hour_epoch_ms: string;
      actual_usd: string;
      baseline_usd: string;
      ratio: string;
    }>(
      `WITH recent AS (
         SELECT
           model,
           date_trunc('hour', timezone('UTC', to_timestamp(created_at / 1000.0))) AS hour_ts,
           SUM(cost_usd) AS actual_usd
         FROM llm_usage
         WHERE created_at >= $1::bigint
         GROUP BY model, hour_ts
       ),
       historical AS (
         SELECT
           model,
           EXTRACT(HOUR FROM timezone('UTC', to_timestamp(created_at / 1000.0))) AS hour_of_day,
           SUM(cost_usd) AS bucket_usd
         FROM llm_usage
         WHERE created_at >= $2::bigint AND created_at < $1::bigint
         GROUP BY
           model,
           date_trunc('hour', timezone('UTC', to_timestamp(created_at / 1000.0))),
           EXTRACT(HOUR FROM timezone('UTC', to_timestamp(created_at / 1000.0)))
       ),
       baselines AS (
         SELECT
           model,
           hour_of_day,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY bucket_usd) AS median_usd
         FROM historical
         GROUP BY model, hour_of_day
       )
       SELECT
         r.model,
         (EXTRACT(EPOCH FROM (r.hour_ts AT TIME ZONE 'UTC')) * 1000)::bigint AS hour_epoch_ms,
         r.actual_usd,
         b.median_usd AS baseline_usd,
         r.actual_usd / NULLIF(b.median_usd, 0) AS ratio
       FROM recent r
       INNER JOIN baselines b
         ON b.model = r.model
         AND b.hour_of_day = EXTRACT(HOUR FROM r.hour_ts)
       WHERE b.median_usd > 0
         AND r.actual_usd > 3 * b.median_usd
       ORDER BY r.actual_usd / NULLIF(b.median_usd, 0) DESC`,
      [recentSinceMs, historicalSinceMs],
    );
    return {
      windowHours: COST_SPIKES_WINDOW_HOURS,
      spikes: rows.map((row) =>
        toCamelCase<{
          model: string;
          hourEpochMs: number;
          actualUsd: number;
          baselineUsd: number;
          ratio: number;
        }>({
          model: row.model,
          hour_epoch_ms: Number(row.hour_epoch_ms),
          actual_usd: Number(row.actual_usd),
          baseline_usd: Number(row.baseline_usd),
          ratio: Number(row.ratio),
        }),
      ),
    };
  });

  app.post(
    '/api/v1/config/test-webhook',
    {
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
    },
    async (request, reply) => {
      const { url } = request.body as { url: string };
      const validation = await validateUrl(url);
      if (!validation.valid || !validation.resolvedIp) {
        return reply.code(400).send({ error: `Invalid webhook URL: ${validation.reason ?? 'DNS resolution failed'}` });
      }
      try {
        const payload = JSON.stringify({
          embeds: [
            {
              title: 'Podders Test Webhook',
              description: 'If you can see this, your webhook is configured correctly.',
              color: 0x5b8def,
              timestamp: new Date().toISOString(),
              footer: { text: 'podders — test delivery' },
            },
          ],
          allowed_mentions: { parse: [] },
        });
        const { response } = await fetchValidated(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            signal: AbortSignal.timeout(15_000),
          },
          validation,
        );
        if (!response) {
          return reply
            .code(400)
            .send({ error: `Invalid webhook URL: ${validation.reason ?? 'DNS resolution failed'}` });
        }
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return reply.code(400).send({ error: `Webhook returned ${response.status}`, detail: text.slice(0, 200) });
        }
        await response.text().catch(() => '');
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.code(400).send({ error: `Webhook delivery failed: ${message}` });
      }
    },
  );

  // --- POST /api/v1/auth/devtools-session ---
  const DEVTOOLS_DISCORD_ID = '0';
  const DEVTOOLS_USERNAME = 'devtools';

  app.post('/api/v1/auth/devtools-session', { preHandler: [authPreHandler, requireAdmin] }, async (request, reply) => {
    const now = Date.now();

    await pool.query(
      `INSERT INTO users (discord_id, username, avatar, role, created_at, last_login_at)
         VALUES ($1, $2, NULL, 'admin', $3, $3)
         ON CONFLICT (discord_id) DO UPDATE SET last_login_at = $3`,
      [DEVTOOLS_DISCORD_ID, DEVTOOLS_USERNAME, now],
    );

    const ip = request.ip;
    const userAgent = (request.headers['user-agent'] as string) ?? 'devtools/verify';
    const sessionId = await sessionManager.create(DEVTOOLS_DISCORD_ID, ip, userAgent);

    reply.setCookie('podders_session', sessionId, {
      httpOnly: true,
      signed: true,
      secure: config.publicUrl?.startsWith('https') ?? false,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });

    log.info('Devtools session created via API key exchange');

    return { podders_session: sessionId };
  });
}
