import crypto from 'node:crypto';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';

export interface SessionManager {
  create(discordId: string, ip: string, userAgent: string, maxSessions?: number): Promise<string>;
  validate(
    sessionId: string,
    ip: string,
    userAgent: string,
  ): Promise<{ discordId: string; role: string; refreshed: boolean } | null>;
  delete(sessionId: string): Promise<void>;
  deleteByManagementId(discordId: string, managementId: string): Promise<boolean>;
  deleteAllForUser(discordId: string): Promise<number>;
  listForUser(discordId: string): Promise<SessionInfo[]>;
  cleanupExpired(): Promise<number>;
}

export function sessionManagementId(rawId: string): string {
  return crypto.createHash('sha256').update(rawId).digest('hex').slice(0, 16);
}

export interface SessionInfo {
  managementId: string;
  discordId: string;
  createdAt: number;
  expiresAt: number;
  lastRefreshedAt: number;
  ipAddress: string | null;
  userAgent: string | null;
  normalizedUA: string | null;
}

export const MAX_SESSIONS_PER_USER = 5;
export const SESSION_LIFETIME_DAYS = 30;
export const SLIDING_REFRESH_HOURS = 24;

/** Extract a stable browser fingerprint from User-Agent, ignoring version numbers.
 *  e.g. "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/124.0" → "mac/chrome"
 */
export function normalizeUA(ua: string): string {
  const lower = ua.toLowerCase();

  // Detect OS (order matters — check specific before generic, e.g. android before linux)
  let os = 'unknown';
  if (lower.includes('iphone') || lower.includes('ipad')) os = 'ios';
  else if (lower.includes('android')) os = 'android';
  else if (lower.includes('windows')) os = 'win';
  else if (lower.includes('macintosh') || lower.includes('mac os')) os = 'mac';
  else if (lower.includes('linux')) os = 'linux';

  // Detect browser (order matters — check specific before generic)
  let browser = 'unknown';
  if (lower.includes('firefox')) browser = 'firefox';
  else if (lower.includes('edg/') || lower.includes('edge')) browser = 'edge';
  else if (lower.includes('opr/') || lower.includes('opera')) browser = 'opera';
  else if (lower.includes('chrome') && !lower.includes('edg')) browser = 'chrome';
  else if (lower.includes('safari') && !lower.includes('chrome')) browser = 'safari';

  return `${os}/${browser}`;
}

/** Truncate a session ID for safe logging (first 8 chars + ...) */
function logSessionId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + '...' : id;
}

export function createSessionManager(pool: Pool, log: Logger): SessionManager {
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  let lastCleanupAt = 0;

  return {
    async create(discordId: string, ip: string, userAgent: string, maxSessions?: number): Promise<string> {
      const sessionId = crypto.randomBytes(32).toString('hex');
      const now = Date.now();
      const expiresAt = now + SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
      const normalizedUA = normalizeUA(userAgent);
      const limit = maxSessions ?? MAX_SESSIONS_PER_USER;

      // Wrap eviction + insert in a transaction with FOR UPDATE lock
      // to prevent concurrent logins exceeding MAX_SESSIONS_PER_USER (AU-010)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Lock user's sessions to prevent concurrent overflow
        await client.query('SELECT id FROM sessions WHERE discord_id = $1 FOR UPDATE', [discordId]);

        // Evict oldest sessions if at limit
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM sessions WHERE discord_id = $1 ORDER BY created_at DESC OFFSET $2`,
          [discordId, limit - 1],
        );

        if (existing.rows.length > 0) {
          const idsToDelete = existing.rows.map((r) => r.id);
          await client.query('DELETE FROM sessions WHERE id = ANY($1)', [idsToDelete]);
          log.info({ discordId, count: idsToDelete.length }, 'Evicted oldest sessions to enforce limit');
        }

        // Insert new session
        await client.query(
          `INSERT INTO sessions (id, discord_id, ip_address, user_agent, expires_at, last_refreshed_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [sessionId, discordId, ip, normalizedUA, expiresAt, now],
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      log.info({ discordId, sessionId: logSessionId(sessionId) }, 'Session created');
      return sessionId;
    },

    async validate(
      sessionId: string,
      ip: string,
      userAgent: string,
    ): Promise<{ discordId: string; role: string; refreshed: boolean } | null> {
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

      // User-Agent validation — detect session hijacking
      if (row.user_agent) {
        if (!userAgent) {
          // Missing UA when one was stored — suspicious
          log.warn(
            { sessionId: logSessionId(sessionId), discordId: row.discord_id },
            'Session invalidated: no User-Agent when one was expected',
          );
          await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
          return null;
        }
        if (row.user_agent !== normalizeUA(userAgent)) {
          log.warn(
            {
              sessionId: logSessionId(sessionId),
              discordId: row.discord_id,
              storedUA: row.user_agent,
              requestUA: userAgent,
            },
            'Session invalidated: User-Agent mismatch (possible session hijacking)',
          );
          await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
          return null;
        }
      }

      // IP mismatch — log warning but allow (mobile networks, VPNs)
      if (row.ip_address && ip && row.ip_address !== ip) {
        log.warn(
          {
            sessionId: logSessionId(sessionId),
            discordId: row.discord_id,
            storedIP: row.ip_address,
            requestIP: ip,
          },
          'Session IP mismatch detected (not invalidated)',
        );
      }

      // Sliding refresh: update last_refreshed_at if stale
      const hoursSinceRefresh = (now - row.last_refreshed_at) / (1000 * 60 * 60);
      let refreshed = false;

      if (hoursSinceRefresh > SLIDING_REFRESH_HOURS) {
        const newExpiresAt = now + SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
        await pool.query(`UPDATE sessions SET last_refreshed_at = $1, expires_at = $3 WHERE id = $2`, [
          now,
          sessionId,
          newExpiresAt,
        ]);
        refreshed = true;
      }

      // Opportunistic cleanup of expired sessions (AU-022)
      if (now - lastCleanupAt > CLEANUP_INTERVAL_MS) {
        lastCleanupAt = now;
        pool
          .query(`DELETE FROM sessions WHERE expires_at < $1`, [now])
          .then((res) => {
            const count = res.rowCount ?? 0;
            if (count > 0) {
              log.info({ count }, 'Cleaned up expired sessions (opportunistic)');
            }
          })
          .catch((err: unknown) => {
            log.warn({ err }, 'Opportunistic session cleanup failed');
          });
      }

      return { discordId: row.discord_id, role: row.role, refreshed };
    },

    async delete(sessionId: string): Promise<void> {
      await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
      log.info({ sessionId: logSessionId(sessionId) }, 'Session deleted');
    },

    async deleteByManagementId(discordId: string, managementId: string): Promise<boolean> {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM sessions WHERE discord_id = $1 AND expires_at > $2`,
        [discordId, Date.now()],
      );
      const target = rows.find((r) => sessionManagementId(r.id) === managementId);
      if (!target) return false;
      await pool.query(`DELETE FROM sessions WHERE id = $1`, [target.id]);
      log.info({ discordId, managementId }, 'Session revoked by management ID');
      return true;
    },

    async deleteAllForUser(discordId: string): Promise<number> {
      const result = await pool.query(`DELETE FROM sessions WHERE discord_id = $1`, [discordId]);
      const count = result.rowCount ?? 0;
      if (count > 0) {
        log.info({ discordId, count }, 'Purged all sessions for user');
      }
      return count;
    },

    async listForUser(discordId: string): Promise<SessionInfo[]> {
      const { rows } = await pool.query<{
        id: string;
        discord_id: string;
        created_at: string;
        expires_at: string;
        last_refreshed_at: string;
        ip_address: string | null;
        user_agent: string | null;
      }>(
        `SELECT id, discord_id, created_at, expires_at, last_refreshed_at, ip_address, user_agent
         FROM sessions
         WHERE discord_id = $1 AND expires_at > $2
         ORDER BY last_refreshed_at DESC`,
        [discordId, Date.now()],
      );

      return rows.map((row) => ({
        managementId: sessionManagementId(row.id),
        discordId: row.discord_id,
        createdAt: Number(row.created_at),
        expiresAt: Number(row.expires_at),
        lastRefreshedAt: Number(row.last_refreshed_at),
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        normalizedUA: row.user_agent
          ? row.user_agent.includes('/') && !row.user_agent.includes(' ')
            ? row.user_agent
            : normalizeUA(row.user_agent)
          : null,
      }));
    },

    async cleanupExpired(): Promise<number> {
      const result = await pool.query(`DELETE FROM sessions WHERE expires_at < $1`, [Date.now()]);
      const count = result.rowCount ?? 0;
      if (count > 0) {
        log.info({ count }, 'Cleaned up expired sessions');
      }
      return count;
    },
  };
}
