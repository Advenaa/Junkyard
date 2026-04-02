import { ulid } from 'ulid';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';

export interface SessionManager {
  create(discordId: string, ip: string, userAgent: string): Promise<string>;
  validate(
    sessionId: string,
  ): Promise<{ discordId: string; role: string } | null>;
  delete(sessionId: string): Promise<void>;
  cleanupExpired(): Promise<number>;
}

const MAX_SESSIONS_PER_USER = 5;
const SESSION_LIFETIME_DAYS = 30;
const SLIDING_REFRESH_HOURS = 24;

export function createSessionManager(pool: Pool, log: Logger): SessionManager {
  return {
    async create(
      discordId: string,
      ip: string,
      userAgent: string,
    ): Promise<string> {
      const sessionId = ulid();
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
      );

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
    ): Promise<{ discordId: string; role: string } | null> {
      const result = await pool.query<{
        discord_id: string;
        role: string;
        expires_at: Date;
        last_refreshed_at: Date;
      }>(
        `SELECT s.discord_id, u.role, s.expires_at, s.last_refreshed_at
         FROM sessions s
         JOIN users u ON u.discord_id = s.discord_id
         WHERE s.id = $1`,
        [sessionId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0]!;
      const now = new Date();

      if (row.expires_at < now) {
        // Session expired — clean it up
        await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
        return null;
      }

      // Sliding refresh: update last_refreshed_at if stale
      const hoursSinceRefresh =
        (now.getTime() - row.last_refreshed_at.getTime()) / (1000 * 60 * 60);

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
        `DELETE FROM sessions WHERE expires_at < NOW()`,
      );
      const count = result.rowCount ?? 0;
      if (count > 0) {
        log.info({ count }, 'Cleaned up expired sessions');
      }
      return count;
    },
  };
}
