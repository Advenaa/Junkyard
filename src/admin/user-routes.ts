import crypto from 'node:crypto';
import {
  ACCESS_REQUEST_CSRF_COOKIE,
  ACCESS_REQUEST_CSRF_COOKIE_PATH,
  ACCESS_REQUEST_CSRF_HEADER,
  ACCESS_REQUEST_CSRF_TTL_MS,
  type AdminRouteDeps,
} from '../server-admin-routes.js';
import {
  type AccessRequestRow,
  recordUserAuditEvent,
  timingSafeEqualString,
  toCamelCase,
  type UserAuditRow,
  type UserRow,
} from '../server-route-helpers.js';

const DEVTOOLS_DISCORD_ID = '0';
const MAX_DEVTOOLS_SESSIONS = 50;
const DEVTOOLS_USERNAME = 'devtools';

export function registerUserRoutes({
  app,
  authPreHandler,
  config,
  log,
  pool,
  requireAdmin,
  sessionManager,
}: AdminRouteDeps): void {
  app.get('/api/v1/users', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const { rows: users } = await pool.query<UserRow>(`SELECT * FROM users ORDER BY created_at DESC`);
    return { users: users.map((row) => toCamelCase(row as unknown as Record<string, unknown>)) };
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
    '/api/v1/users/:discordId/sessions/:managementId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['discordId', 'managementId'],
          properties: {
            discordId: { type: 'string', pattern: '^\\d{17,20}$' },
            managementId: { type: 'string', minLength: 1, maxLength: 16 },
          },
        },
      },
    },
    async (request, reply) => {
      const { discordId, managementId } = request.params as {
        discordId: string;
        managementId: string;
      };
      const deleted = await sessionManager.deleteByManagementId(discordId, managementId);
      if (!deleted) {
        return reply.code(404).send({ error: 'Session not found' });
      }
      return reply.code(204).send();
    },
  );

  app.post('/api/v1/auth/devtools-session', { preHandler: [authPreHandler, requireAdmin] }, async (request, reply) => {
    const now = Date.now();

    await pool.query(
      `INSERT INTO users (discord_id, username, avatar, role, created_at, last_login_at)
         VALUES ($1, $2, NULL, 'admin', $3, $3)
         ON CONFLICT (discord_id) DO UPDATE SET last_login_at = $3`,
      [DEVTOOLS_DISCORD_ID, DEVTOOLS_USERNAME, now],
    );

    const { rows: existing } = await pool.query<{ id: string }>(
      `SELECT id FROM sessions
       WHERE discord_id = $1 AND expires_at > $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [DEVTOOLS_DISCORD_ID, now],
    );

    let sessionId: string;

    if (existing.length > 0) {
      sessionId = existing[0].id;
      const newExpiresAt = now + 30 * 24 * 60 * 60 * 1000;
      await pool.query(`UPDATE sessions SET expires_at = $1, last_refreshed_at = $2 WHERE id = $3`, [
        newExpiresAt,
        now,
        sessionId,
      ]);
      log.info('Devtools session reused via API key exchange');
    } else {
      const ip = request.ip;
      const userAgent = (request.headers['user-agent'] as string) ?? 'devtools/verify';
      sessionId = await sessionManager.create(DEVTOOLS_DISCORD_ID, ip, userAgent, MAX_DEVTOOLS_SESSIONS);
      log.info('Devtools session created via API key exchange');
    }

    reply.setCookie('podders_session', sessionId, {
      httpOnly: true,
      signed: true,
      secure: config.publicUrl?.startsWith('https') ?? false,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });

    return { podders_session: sessionId };
  });
}
