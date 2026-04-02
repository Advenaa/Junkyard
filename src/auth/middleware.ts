import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '../db/connection.js';
import type { Config } from '../config.js';
import type { SessionManager } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { discordId: string; username: string; role: string };
  }
}

type PreHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

export function requireAuth(
  pool: Pool,
  config: Config,
  sessionManager: SessionManager,
): PreHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // 1. Check session cookie
    const sessionId = request.unsignCookie(
      (request.cookies?.['podders_session'] as string) ?? '',
    );

    if (sessionId.valid && sessionId.value) {
      const requestIp = request.ip ?? '';
      const requestUA =
        (request.headers['user-agent'] as string | undefined) ?? '';
      const session = await sessionManager.validate(
        sessionId.value,
        requestIp,
        requestUA,
      );
      if (session) {
        // Look up username from DB
        const userResult = await pool.query<{ username: string }>(
          `SELECT username FROM users WHERE discord_id = $1`,
          [session.discordId],
        );

        const username = userResult.rows[0]?.username ?? 'unknown';

        // Admin override from config
        const role = config.adminUserIds.includes(session.discordId)
          ? 'admin'
          : session.role === 'admin'
            ? 'viewer'  // Revoke admin if not in ADMIN_USER_IDS
            : session.role;

        request.user = {
          discordId: session.discordId,
          username,
          role,
        };
        return;
      }
    }

    // 2. Check API key via Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const providedKey = authHeader.slice(7);

      if (providedKey.length > 0 && config.apiKey.length > 0) {
        const providedBuf = Buffer.from(providedKey, 'utf8');
        const expectedBuf = Buffer.from(config.apiKey, 'utf8');

        if (
          providedBuf.length === expectedBuf.length &&
          crypto.timingSafeEqual(providedBuf, expectedBuf)
        ) {
          request.user = {
            discordId: 'api-key',
            username: 'api',
            role: 'admin',
          };
          return;
        }
      }
    }

    // 3. Neither valid
    reply.status(401).send({ error: 'Unauthorized' });
  };
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user || request.user.role !== 'admin') {
    reply.status(403).send({ error: 'Forbidden: admin access required' });
    return;
  }
}
