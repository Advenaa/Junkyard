import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import { insertAlphaPropagation } from '../db/queries.js';

export interface AlphaTracker {
  trackMentions(
    source: string,
    sourceId: string,
    entityIds: string[],
    mentionTime: number,
  ): Promise<{ tracked: number; skipped: number }>;
}

export function createAlphaTracker(pool: Pool, log: Logger): AlphaTracker {
  async function trackMentions(
    source: string,
    sourceId: string,
    entityIds: string[],
    mentionTime: number,
  ): Promise<{ tracked: number; skipped: number }> {
    if (entityIds.length === 0) {
      return { tracked: 0, skipped: 0 };
    }

    try {
      // Look up source tier
      const tierResult = await pool.query('SELECT tier FROM sources WHERE source = $1 AND source_id = $2', [
        source,
        sourceId,
      ]);
      const tier: string =
        tierResult.rows.length > 0 && tierResult.rows[0].tier != null ? (tierResult.rows[0].tier as string) : 'general';

      let tracked = 0;
      for (const entityId of entityIds) {
        const rowCount = await insertAlphaPropagation(pool, {
          entityId,
          tier,
          source,
          sourceId,
          firstMentionTime: mentionTime,
          eventId: null,
          itemId: null,
        });
        tracked += rowCount;
      }
      const skipped = entityIds.length - tracked;

      const message =
        skipped > 0
          ? `Alpha tracker: tracked ${tracked} entity-tier mentions, skipped ${skipped} duplicate attempts`
          : `Alpha tracker: tracked ${tracked} entity-tier mentions`;
      log.info({ tracked, skipped, tier, source, sourceId }, message);

      return { tracked, skipped };
    } catch (err) {
      log.warn({ err, source, sourceId, entityCount: entityIds.length }, 'Alpha tracker: failed to track mentions');
      return { tracked: 0, skipped: entityIds.length };
    }
  }

  return { trackMentions };
}
