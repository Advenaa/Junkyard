import { ulid } from 'ulid';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';

export interface SessionManager {
  create(discordId: string, ip: string, userAgent: string): Promise<string>;
  validate(
    sessionId: string,
    ip: string,
    userAgent: string,
  ): Promise<{ discordId: string; role: string } | null>;
  delete(sessionId: string): Promise<void>;
  cleanupExpired(): Promise<number>;
}

export const MAX_SESSIONS_PER_USER = 5;
export const SESSION_LIFETIME_DAYS = 30;
export const SLIDING_REFRESH_HOURS = 24;

/** Extract a stable browser fingerprint from User-Agent, ignoring version numbers.
 *  e.g. "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/124.0" → "mac/chrome"
 */
function normalizeUA(ua: string): string {
  const lower = ua.toLowerCase();

  // Detect OS
  let os = 'unknown';
  if (lower.includes('windows')) os = 'win';
  else if (lower.includes('macintosh') || lower.includes('mac os')) os = 'mac';
  else if (lower.includes('linux')) os = 'linux';
  else if (lower.includes('android')) os = 'android';
  else if (lower.includes('iphone') || lower.includes('ipad')) os = 'ios';

  // Detect browser (order matters — check specific before generic)
  let browser = 'unknown';
  if (lower.includes('firefox')) browser = 'firefox';
  else if (lower.includes('edg/') || lower.includes('edge')) browser = 'edge';
  else if (lower.includes('opr/') || lower.includes('opera')) browser = 'opera';
  else if (lower.includes('chrome') && !lower.includes('edg')) browser = 'chrome';
  else if (lower.includes('safari') && !lower.includes('chrome')) browser = 'safari';

  return `${os}/${browser}`;
}

export function createSessionManager(pool: Pool, log: Logger): SessionManager {
  return {
    async create(
      discordId: string,
      ip: string,
      userAgent: string,
    ): Promise<string> {
      const sessionId = ulid();
      const now = Date.now();
      const expiresAt =
        now + SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

      // Enforce max sessions per user — delete oldest if exceeded
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM sessions
         WHERE discord_id = $1
         ORDER BY created_at DESC
         OFFSET $2`,
        [discordId, MAX_SESSIONS_PER_USER - 1],
      );

      if (existing.rows.length > 0) {
        const idsToDelete = existing.rows.map((r) => r.id);
        await pool.query(`DELETE FROM sessions WHERE id = ANY($1)`, [
          idsToDelete,
        ]);
        log.info(
          { discordId, count: idsToDelete.length },
          'Evicted oldest sessions to enforce limit',
        );
      }

      await pool.query(
        `INSERT INTO sessions (id, discord_id, ip_address, user_agent, expires_at, last_refreshed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [sessionId, discordId, ip, userAgent, expiresAt, now],
      );

      log.info({ discordId, sessionId }, 'Session created');
      return sessionId;
    },

    async validate(
      sessionId: string,
      ip: string,
      userAgent: string,
    ): Promise<{ discordId: string; role: string } | null> {
      const result = await pool.query<{
        discord_id: string;
        role: string;
        expires_at: number;
        last_refreshed_at: number;
        ip_address: string;
        user_agent: string;
      }>(
        `SELECT s.discord_id, u.role, s.expires_at, s.last_refreshed_at,
                s.ip_address, s.user_agent
         FROM sessions s
         JOIN users u ON u.discord_id = s.discord_id
         WHERE s.id = $1`,
        [sessionId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0]!;
      const now = Date.now();

      if (row.expires_at < now) {
        // Session expired — clean it up
        await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
        return null;
      }

      // User-Agent mismatch — likely session hijacking, invalidate immediately
      if (row.user_agent && userAgent && normalizeUA(row.user_agent) !== normalizeUA(userAgent)) {
        log.warn(
          {
            sessionId,
            discordId: row.discord_id,
            storedUA: row.user_agent,
            requestUA: userAgent,
          },
          'Session invalidated: User-Agent mismatch (possible session hijacking)',
        );
        await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
        return null;
      }

      // IP mismatch — log warning but allow (mobile networks, VPNs)
      if (row.ip_address && ip && row.ip_address !== ip) {
        log.warn(
          {
            sessionId,
            discordId: row.discord_id,
            storedIP: row.ip_address,
            requestIP: ip,
          },
          'Session IP mismatch detected (not invalidated)',
        );
      }

      // Sliding refresh: update last_refreshed_at if stale
      const hoursSinceRefresh =
        (now - row.last_refreshed_at) / (1000 * 60 * 60);

      if (hoursSinceRefresh > SLIDING_REFRESH_HOURS) {
        await pool.query(
          `UPDATE sessions SET last_refreshed_at = $1 WHERE id = $2`,
          [now, sessionId],
        );
      }

      return { discordId: row.discord_id, role: row.role };
    },

    async delete(sessionId: string): Promise<void> {
      await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
      log.info({ sessionId }, 'Session deleted');
    },

    async cleanupExpired(): Promise<number> {
      const result = await pool.query(
        `DELETE FROM sessions WHERE expires_at < $1`,
        [Date.now()],
      );
      const count = result.rowCount ?? 0;
      if (count > 0) {
        log.info({ count }, 'Cleaned up expired sessions');
      }
      return count;
    },
  };
}
