import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';

export interface RetentionResult {
  itemsDeleted: number;
  summariesDeleted: number;
  mentionsDeleted: number;
  sentimentDailyDeleted: number;
  embeddingsDeleted: number;
  sessionsDeleted: number;
}

export function createRetention(pool: Pool, log: Logger) {
  async function run(): Promise<RetentionResult> {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

    const itemsResult = await pool.query(
      `DELETE FROM items WHERE status = 'processed' AND created_at < $1`,
      [thirtyDaysAgo],
    );
    const itemsDeleted = itemsResult.rowCount ?? 0;
    log.info({ itemsDeleted }, 'retention: deleted processed items older than 30 days');

    // Delete summaries first — CASCADE handles associated entity_mentions.
    // Then delete remaining mentions by date to catch any not tied to summaries.
    const summariesResult = await pool.query(
      `DELETE FROM summaries WHERE created_at < $1`,
      [ninetyDaysAgo],
    );
    const summariesDeleted = summariesResult.rowCount ?? 0;
    log.info({ summariesDeleted }, 'retention: deleted summaries older than 90 days');

    const mentionsResult = await pool.query(
      `DELETE FROM entity_mentions WHERE created_at < $1`,
      [ninetyDaysAgo],
    );
    const mentionsDeleted = mentionsResult.rowCount ?? 0;
    log.info({ mentionsDeleted }, 'retention: deleted entity mentions older than 90 days');

    const sentimentRetentionDays = 365; // Keep 1 year of daily sentiment data
    const sentimentCutoff = now - sentimentRetentionDays * 24 * 60 * 60 * 1000;
    // entity_sentiment_daily.date is a DATE string, not epoch
    const cutoffDate = new Date(sentimentCutoff).toISOString().slice(0, 10);
    const sentimentResult = await pool.query(
      `DELETE FROM entity_sentiment_daily WHERE date < $1`,
      [cutoffDate],
    );
    const sentimentDailyDeleted = sentimentResult.rowCount ?? 0;
    log.info({ sentimentDailyDeleted }, 'retention: deleted entity_sentiment_daily older than 365 days');

    const MAX_EMBEDDING_ITERATIONS = 100;
    let embeddingsDeleted = 0;
    let cappedEmbeddingCleanup = false;
    for (const [targetType, sourceTable] of [['item', 'items'], ['summary', 'summaries']] as const) {
      let deleted: number;
      let iterations = 0;
      do {
        const result = await pool.query(
          `DELETE FROM embeddings WHERE id IN (
            SELECT e.id FROM embeddings e
            WHERE e.target_type = $1
              AND NOT EXISTS (SELECT 1 FROM ${sourceTable} t WHERE t.id = e.target_id)
            LIMIT 1000
          )`,
          [targetType],
        );
        deleted = result.rowCount ?? 0;
        embeddingsDeleted += deleted;
        iterations++;
      } while (deleted > 0 && iterations < MAX_EMBEDDING_ITERATIONS);
      if (deleted > 0) {
        cappedEmbeddingCleanup = true;
        log.warn(
          { targetType, iterations },
          'retention: orphaned embeddings cleanup hit iteration cap; remaining orphans will be cleaned next run',
        );
      }
    }
    log.info({ embeddingsDeleted, cappedEmbeddingCleanup }, 'retention: deleted orphaned embeddings');

    const sessionsResult = await pool.query(
      `DELETE FROM sessions WHERE expires_at < $1`,
      [now],
    );
    const sessionsDeleted = sessionsResult.rowCount ?? 0;
    log.info({ sessionsDeleted }, 'retention: deleted expired sessions');

    const result: RetentionResult = {
      itemsDeleted,
      summariesDeleted,
      mentionsDeleted,
      sentimentDailyDeleted,
      embeddingsDeleted,
      sessionsDeleted,
    };

    log.info({ result }, 'retention: completed');
    return result;
  }

  return { run };
}
