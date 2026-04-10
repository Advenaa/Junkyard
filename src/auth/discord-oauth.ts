import crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';
import { createSessionManager } from './sessions.js';

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
  discriminator: string;
}

interface OAuthStateEntry {
  ip: string;
  expiresAt: number;
  consumed: boolean;
}

type PreHandler = (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;

export function registerOAuthRoutes(
  app: FastifyInstance,
  pool: Pool,
  log: Logger,
  config: Config,
  authPreHandler: PreHandler | undefined,
  sessionManager: ReturnType<typeof createSessionManager>,
): void {
  // Track pending + consumed OAuth states to prevent replay (AU-007) while
  // keeping initiation limits scoped to the caller IP rather than one global bucket.
  // NOTE: In-memory set is safe for single-process deployment (pm2/systemd, NOT cluster mode).
  // If deploying multi-process, move state tracking to Postgres.
  const oauthStates = new Map<string, OAuthStateEntry>();
  const OAUTH_PENDING_STATES_MAX = 10_000;
  const OAUTH_PENDING_STATES_PER_IP_MAX = 5;
  const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
  const OAUTH_REJECTION_MIN_DELAY_MS = 100;
  const OAUTH_PADDING_DISCORD_ID = '000000000000000000';
  const pendingStateCountsByIp = new Map<string, number>();

  function incrementPendingStateCount(ip: string): void {
    pendingStateCountsByIp.set(ip, (pendingStateCountsByIp.get(ip) ?? 0) + 1);
  }

  function decrementPendingStateCount(ip: string): void {
    const current = pendingStateCountsByIp.get(ip) ?? 0;
    if (current <= 1) {
      pendingStateCountsByIp.delete(ip);
      return;
    }
    pendingStateCountsByIp.set(ip, current - 1);
  }

  function getPendingStateCount(ip: string): number {
    return pendingStateCountsByIp.get(ip) ?? 0;
  }

  function getTotalPendingStateCount(): number {
    let total = 0;
    for (const count of pendingStateCountsByIp.values()) {
      total += count;
    }
    return total;
  }

  function cleanupExpiredOAuthStates(now = Date.now()): void {
    for (const [state, entry] of oauthStates.entries()) {
      if (entry.expiresAt > now) {
        continue;
      }

      oauthStates.delete(state);
      if (!entry.consumed) {
        decrementPendingStateCount(entry.ip);
      }
    }
  }

  function registerPendingOAuthState(
    ip: string,
    now = Date.now(),
  ): { ok: true; state: string } | { ok: false; reason: 'per_ip_limit' | 'global_capacity' } {
    cleanupExpiredOAuthStates(now);

    if (getPendingStateCount(ip) >= OAUTH_PENDING_STATES_PER_IP_MAX) {
      return { ok: false, reason: 'per_ip_limit' };
    }

    if (getTotalPendingStateCount() >= OAUTH_PENDING_STATES_MAX) {
      return { ok: false, reason: 'global_capacity' };
    }

    const state = crypto.randomBytes(32).toString('hex');
    oauthStates.set(state, {
      ip,
      expiresAt: now + OAUTH_STATE_TTL_MS,
      consumed: false,
    });
    incrementPendingStateCount(ip);
    return { ok: true, state };
  }

  function consumeOAuthState(state: string, now = Date.now()): 'consumed' | 'missing' | 'already_consumed' {
    cleanupExpiredOAuthStates(now);

    const entry = oauthStates.get(state);
    if (!entry) {
      return 'missing';
    }

    if (entry.consumed) {
      return 'already_consumed';
    }

    entry.consumed = true;
    decrementPendingStateCount(entry.ip);
    return 'consumed';
  }

  async function padOAuthRejection(startedAt: number, discordId: string | null = null): Promise<void> {
    try {
      // Keep rejected OAuth callbacks in the same rough latency bucket so invite-only
      // access decisions do not leak through obvious fast-vs-slow timing differences.
      await pool.query('SELECT discord_id FROM users WHERE discord_id = $1 LIMIT 1', [
        discordId ?? OAUTH_PADDING_DISCORD_ID,
      ]);
    } catch (err: unknown) {
      log.warn({ err }, 'OAuth rejection padding query failed');
    }

    const elapsed = Date.now() - startedAt;
    const remainingDelay = OAUTH_REJECTION_MIN_DELAY_MS - elapsed;
    if (remainingDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingDelay));
    }
  }

  // --- GET /api/v1/auth/discord ---
  app.get('/api/v1/auth/discord', async (request, reply) => {
    if (!config.discordClientId || !config.publicUrl) {
      return reply.status(503).send({ error: 'Discord OAuth is not configured' });
    }

    const requestIp = request.ip || 'unknown';
    const stateRegistration = registerPendingOAuthState(requestIp);
    if (!stateRegistration.ok && stateRegistration.reason === 'per_ip_limit') {
      log.warn({ ip: requestIp, count: getPendingStateCount(requestIp) }, 'OAuth pending-state per-IP limit reached');
      return reply.status(429).send({ error: 'Too many pending OAuth sessions from this IP. Please try again later.' });
    }

    if (!stateRegistration.ok) {
      log.warn({ size: getTotalPendingStateCount() }, 'OAuth pending states at capacity — rejecting new initiation');
      return reply.status(503).send({ error: 'Too many pending OAuth sessions. Please try again later.' });
    }

    const state = stateRegistration.state;

    reply.setCookie('oauth_state', state, {
      httpOnly: true,
      signed: true,
      secure: config.publicUrl?.startsWith('https') ?? false,
      sameSite: 'lax',
      path: '/',
      maxAge: OAUTH_STATE_TTL_MS / 1000,
    });

    const redirectUri = encodeURIComponent(config.publicUrl + '/api/v1/auth/discord/callback');

    const url =
      `https://discord.com/api/oauth2/authorize` +
      `?client_id=${config.discordClientId}` +
      `&redirect_uri=${redirectUri}` +
      `&response_type=code` +
      `&scope=identify` +
      `&state=${state}`;

    return reply.redirect(url);
  });

  // --- GET /api/v1/auth/discord/callback ---
  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>('/api/v1/auth/discord/callback', async (request, reply) => {
    const callbackStartedAt = Date.now();
    const { code, state, error } = request.query;

    if (!config.discordClientId || !config.discordClientSecret || !config.publicUrl) {
      return reply.status(503).send({ error: 'Discord OAuth is not configured' });
    }

    // 1. Validate CSRF state
    const stateCookie = request.unsignCookie((request.cookies?.['oauth_state'] as string) ?? '');

    reply.clearCookie('oauth_state', { path: '/' });

    if (!stateCookie.valid || !stateCookie.value || !state || stateCookie.value !== state) {
      await padOAuthRejection(callbackStartedAt);
      log.warn('OAuth state mismatch — possible CSRF');
      return reply.status(403).send({ error: 'Invalid OAuth state' });
    }

    const stateStatus = consumeOAuthState(state);
    if (stateStatus === 'missing') {
      await padOAuthRejection(callbackStartedAt);
      log.warn({ state: state.slice(0, 8) }, 'OAuth state missing or expired');
      return reply.status(403).send({ error: 'Invalid OAuth state' });
    }

    if (stateStatus === 'already_consumed') {
      await padOAuthRejection(callbackStartedAt);
      log.warn({ state: state.slice(0, 8) }, 'OAuth state already consumed (replay attempt)');
      return reply.status(403).send({ error: 'OAuth state already used' });
    }

    if (error) {
      await padOAuthRejection(callbackStartedAt);
      log.warn({ error }, 'Discord OAuth denied by user');
      return reply.redirect(`/login?error=${error === 'access_denied' ? 'denied' : 'oauth_error'}`);
    }

    if (!code) {
      await padOAuthRejection(callbackStartedAt);
      return reply.redirect('/login?error=missing_code');
    }

    // 2. Exchange code for token
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.publicUrl + '/api/v1/auth/discord/callback',
      client_id: config.discordClientId,
      client_secret: config.discordClientSecret,
    });

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenResponse.ok) {
      await padOAuthRejection(callbackStartedAt);
      const errText = await tokenResponse.text();
      log.error({ status: tokenResponse.status, body: errText }, 'Discord token exchange failed');
      return reply.status(502).send({ error: 'Discord token exchange failed' });
    }

    const tokenData = (await tokenResponse.json()) as DiscordTokenResponse;

    // 3. Fetch user profile
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!userResponse.ok) {
      await padOAuthRejection(callbackStartedAt);
      log.error({ status: userResponse.status }, 'Discord user fetch failed');
      return reply.status(502).send({ error: 'Failed to fetch Discord user' });
    }

    const discordUser = (await userResponse.json()) as DiscordUser;

    // 4. Discord token is discarded — never stored

    // 5. Check if user exists or is allowed (invite-only)
    const existingUser = await pool.query<{ discord_id: string; role: string }>(
      `SELECT discord_id, role FROM users WHERE discord_id = $1`,
      [discordUser.id],
    );

    const isAdmin = config.adminUserIds.includes(discordUser.id);

    if (existingUser.rows.length === 0 && !isAdmin) {
      await padOAuthRejection(callbackStartedAt, discordUser.id);
      log.warn(
        { discordId: discordUser.id, username: discordUser.username },
        'Unknown user attempted login — invite-only',
      );
      return reply.redirect('/login?error=unauthorized');
    }

    // 6. Role resolution
    let role: string;
    if (isAdmin) {
      role = 'admin';
    } else {
      role = existingUser.rows[0]?.role ?? 'viewer';
    }

    // 6b. Block check — reject before creating session (PD-041)
    if (role === 'blocked') {
      await padOAuthRejection(callbackStartedAt, discordUser.id);
      log.warn({ discordId: discordUser.id }, 'Blocked user attempted login');
      return reply.redirect('/login?error=blocked');
    }

    // 7. Upsert user
    const now = Date.now();
    await pool.query(
      `INSERT INTO users (discord_id, username, avatar, role, last_login_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (discord_id) DO UPDATE SET
         username = EXCLUDED.username,
         avatar = EXCLUDED.avatar,
         last_login_at = EXCLUDED.last_login_at`,
      [discordUser.id, discordUser.username, discordUser.avatar, role, now],
    );

    // 8. Create session
    const ip = request.ip;
    const userAgent = (request.headers['user-agent'] as string) ?? 'unknown';

    const sessionId = await sessionManager.create(discordUser.id, ip, userAgent);

    // 9. Set session cookie
    reply.setCookie('podders_session', sessionId, {
      httpOnly: true,
      signed: true,
      secure: config.publicUrl?.startsWith('https') ?? false,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    log.info({ discordId: discordUser.id, username: discordUser.username, role }, 'User logged in');

    // 10. Redirect to dashboard
    return reply.redirect('/');
  });

  // --- GET /api/v1/auth/me ---
  app.get('/api/v1/auth/me', { preHandler: authPreHandler ? [authPreHandler] : [] }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    let avatar: string | null = null;
    if (request.user.discordId !== 'api-key') {
      const result = await pool.query<{ avatar: string | null }>('SELECT avatar FROM users WHERE discord_id = $1', [
        request.user.discordId,
      ]);
      avatar = result.rows[0]?.avatar ?? null;
    }

    return {
      discordId: request.user.discordId,
      username: request.user.username,
      avatar,
      role: request.user.role,
    };
  });

  // --- POST /api/v1/auth/logout ---
  app.post(
    '/api/v1/auth/logout',
    {
      ...(authPreHandler ? { preHandler: [authPreHandler] } : {}),
    },
    async (request, reply) => {
      const sessionCookie = request.unsignCookie((request.cookies?.['podders_session'] as string) ?? '');

      if (sessionCookie.valid && sessionCookie.value) {
        await sessionManager.delete(sessionCookie.value);
      }

      reply.clearCookie('podders_session', { path: '/' });

      return { ok: true };
    },
  );
}
