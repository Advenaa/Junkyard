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

export function registerOAuthRoutes(
  app: FastifyInstance,
  pool: Pool,
  log: Logger,
  config: Config,
): void {
  const sessionManager = createSessionManager(pool, log);

  // --- GET /api/v1/auth/discord ---
  app.get('/api/v1/auth/discord', async (request, reply) => {
    if (!config.discordClientId || !config.publicUrl) {
      return reply
        .status(503)
        .send({ error: 'Discord OAuth is not configured' });
    }

    const state = crypto.randomBytes(32).toString('hex');

    reply.setCookie('oauth_state', state, {
      httpOnly: true,
      signed: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60, // 10 minutes
    });

    const redirectUri = encodeURIComponent(
      config.publicUrl + '/api/v1/auth/discord/callback',
    );

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
    Querystring: { code?: string; state?: string };
  }>('/api/v1/auth/discord/callback', async (request, reply) => {
    const { code, state } = request.query;

    if (!config.discordClientId || !config.discordClientSecret || !config.publicUrl) {
      return reply
        .status(503)
        .send({ error: 'Discord OAuth is not configured' });
    }

    // 1. Validate CSRF state
    const stateCookie = request.unsignCookie(
      (request.cookies?.['oauth_state'] as string) ?? '',
    );

    reply.clearCookie('oauth_state', { path: '/' });

    if (
      !stateCookie.valid ||
      !stateCookie.value ||
      !state ||
      stateCookie.value !== state
    ) {
      log.warn('OAuth state mismatch — possible CSRF');
      return reply.status(403).send({ error: 'Invalid OAuth state' });
    }

    if (!code) {
      return reply.status(400).send({ error: 'Missing authorization code' });
    }

    // 2. Exchange code for token
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.publicUrl + '/api/v1/auth/discord/callback',
      client_id: config.discordClientId,
      client_secret: config.discordClientSecret,
    });

    const tokenResponse = await fetch(
      'https://discord.com/api/oauth2/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      log.error(
        { status: tokenResponse.status, body: errText },
        'Discord token exchange failed',
      );
      return reply.status(502).send({ error: 'Discord token exchange failed' });
    }

    const tokenData = (await tokenResponse.json()) as DiscordTokenResponse;

    // 3. Fetch user profile
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!userResponse.ok) {
      log.error(
        { status: userResponse.status },
        'Discord user fetch failed',
      );
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
      log.warn(
        { discordId: discordUser.id, username: discordUser.username },
        'Unknown user attempted login — invite-only',
      );
      return reply.status(403).send({
        error: 'Access denied. This instance is invite-only.',
      });
    }

    // 6. Role resolution
    let role: string;
    if (isAdmin) {
      role = 'admin';
    } else {
      role = existingUser.rows[0]?.role ?? 'viewer';
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
      [
        discordUser.id,
        discordUser.username,
        discordUser.avatar,
        role,
        now,
      ],
    );

    // 8. Create session
    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      request.ip;
    const userAgent =
      (request.headers['user-agent'] as string) ?? 'unknown';

    const sessionId = await sessionManager.create(
      discordUser.id,
      ip,
      userAgent,
    );

    // 9. Set session cookie
    reply.setCookie('podders_session', sessionId, {
      httpOnly: true,
      signed: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    log.info(
      { discordId: discordUser.id, username: discordUser.username, role },
      'User logged in',
    );

    // 10. Redirect to dashboard
    return reply.redirect('/');
  });

  // --- GET /api/v1/auth/me ---
  app.get('/api/v1/auth/me', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    return {
      discordId: request.user.discordId,
      username: request.user.username,
      role: request.user.role,
    };
  });

  // --- POST /api/v1/auth/logout ---
  app.post('/api/v1/auth/logout', async (request, reply) => {
    const sessionCookie = request.unsignCookie(
      (request.cookies?.['podders_session'] as string) ?? '',
    );

    if (sessionCookie.valid && sessionCookie.value) {
      await sessionManager.delete(sessionCookie.value);
    }

    reply.clearCookie('podders_session', { path: '/' });

    return { ok: true };
  });
}
