import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';

/** Multiplicative decay applied each cycle (5% reduction). */
export const DECAY_FACTOR = 0.95;

/** Entities below this relevance (and stale >90 days) get archived. */
export const ARCHIVE_THRESHOLD = 0.01;

/** Days of inactivity required before archival. */
export const ARCHIVE_STALE_DAYS = 90;

interface DecayManager {
  runDecay(): Promise<{ decayed: number; archived: number }>;
}

export function createDecayManager(pool: Pool, log: Logger): DecayManager {
  async function runDecay(): Promise<{ decayed: number; archived: number }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock active entities to prevent concurrent relevance updates during decay
      await client.query(
        "SELECT id FROM entities WHERE status = 'active' FOR UPDATE",
      );

      // Apply 5% decay to all active entities
      const decayResult = await client.query(
        "UPDATE entities SET relevance = relevance * 0.95 WHERE status = 'active'",
      );
      const decayed = decayResult.rowCount ?? 0;

      // Archive entities with negligible relevance not seen in 90 days
      const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;

      const archiveResult = await client.query(
        `UPDATE entities SET status = 'archived'
         WHERE status = 'active'
           AND relevance < 0.01
           AND last_seen < $1`,
        [cutoff],
      );
      const archived = archiveResult.rowCount ?? 0;

      await client.query('COMMIT');

      log.info(
        { decayed, archived },
        `Decay complete: decayed ${decayed} entities, archived ${archived}`,
      );

      return { decayed, archived };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return { runDecay };
}
