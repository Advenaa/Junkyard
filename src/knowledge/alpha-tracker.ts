import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import { insertAlphaPropagation } from '../db/queries.js';

/** 7-day lookback window for deduplicating entity-tier mentions. */
const ALPHA_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

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
      const tierResult = await pool.query(
        'SELECT tier FROM sources WHERE source = $1 AND source_id = $2',
        [source, sourceId],
      );
      const tier: string =
        tierResult.rows.length > 0 && tierResult.rows[0].tier != null
          ? (tierResult.rows[0].tier as string)
          : 'general';

      // Check which entity+tier combos already have records in the lookback window
      const lookbackStart = mentionTime - ALPHA_LOOKBACK_MS;
      const existingResult = await pool.query(
        `SELECT DISTINCT entity_id FROM alpha_propagation
         WHERE entity_id = ANY($1::text[]) AND tier = $2 AND first_mention_time >= $3`,
        [entityIds, tier, lookbackStart],
      );
      const existingSet = new Set<string>(
        existingResult.rows.map((r) => r.entity_id as string),
      );

      // Insert new records for entities without existing entries
      const newEntityIds = entityIds.filter((id) => !existingSet.has(id));
      const skipped = entityIds.length - newEntityIds.length;

      for (const entityId of newEntityIds) {
        await insertAlphaPropagation(pool, {
          entityId,
          tier,
          source,
          sourceId,
          firstMentionTime: mentionTime,
          eventId: null,
          itemId: null,
        });
      }

      log.info(
        { tracked: newEntityIds.length, skipped, tier, source, sourceId },
        `Alpha tracker: tracked ${newEntityIds.length} new entity-tier mentions, skipped ${skipped} existing`,
      );

      return { tracked: newEntityIds.length, skipped };
    } catch (err) {
      log.warn(
        { err, source, sourceId, entityCount: entityIds.length },
        'Alpha tracker: failed to track mentions',
      );
      return { tracked: 0, skipped: entityIds.length };
    }
  }

  return { trackMentions };
}
