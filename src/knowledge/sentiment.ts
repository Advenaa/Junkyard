import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';

// ── Types ────────────────────────────────────────────────────────────────

export type Trend = 'accelerating' | 'declining' | 'stable' | 'reversing';

export interface MomentumEntry {
  entityId: string;
  entityName: string;
  avgSentiment: number;
  mentionCount: number;
  momentum: number | null;
  trend: Trend;
}

interface DailyAggRow {
  entity_id: string;
  avg_sentiment: number;
  mention_count: string; // COUNT returns bigint string in pg
}

interface MomentumRow {
  entity_id: string;
  entity_name: string;
  avg_sentiment: number;
  mention_count: number;
  momentum: number | null;
  date: string;
}

interface YesterdayMomentumRow {
  entity_id: string;
  momentum: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Shift a YYYY-MM-DD date string by `days` (negative = past). */
function shiftDate(dateString: string, days: number): string {
  const d = new Date(dateString + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Convert a YYYY-MM-DD date string to epoch-ms bounds [startMs, endMs) in the given timezone. */
function dateToEpochMsBounds(dateString: string, timezone: string): { startMs: number; endMs: number } {
  // Compute UTC offset for the given timezone using the target date (not now) to handle DST correctly
  // Use midday of the target date to avoid midnight edge cases
  const referenceDate = new Date(dateString + 'T12:00:00Z');
  const utcStr = referenceDate.toLocaleString('en-US', { timeZone: 'UTC' });
  const localStr = referenceDate.toLocaleString('en-US', { timeZone: timezone });
  const offsetMs = new Date(localStr).getTime() - new Date(utcStr).getTime();

  // Midnight in target timezone expressed as UTC epoch
  const [year, month, day] = dateString.split('-').map(Number);
  const midnightUtc = Date.UTC(year, month - 1, day);
  const startMs = midnightUtc - offsetMs;
  const endMs = startMs + 86_400_000; // +24h
  return { startMs, endMs };
}

/** Classify momentum + day-over-day change into a human-readable trend. */
function classifyTrend(
  momentum: number | null,
  yesterdayMomentum: number | null,
): Trend {
  if (momentum === null) return 'stable';

  if (momentum > 0.15) return 'accelerating';
  if (momentum < -0.15) return 'declining';

  // Check for reversal: |momentum| <= 0.15 but big day-over-day shift
  if (yesterdayMomentum !== null) {
    const change = Math.abs(momentum - yesterdayMomentum);
    if (change > 0.2) return 'reversing';
  }

  return 'stable';
}

// ── Tracker factory ──────────────────────────────────────────────────────

export function createSentimentTracker(pool: Pool, log: Logger) {
  /**
   * Run daily after Stage 1 completes.
   * Aggregates today's entity mentions into entity_sentiment_daily with momentum.
   */
  async function runDaily(dateString: string, timezone: string): Promise<void> {
    const client = await pool.connect();
    try {
      // SM-006: Idempotency guard — skip if we already ran for this date
      const { rowCount: alreadyRan } = await client.query(
        `SELECT 1 FROM entity_sentiment_daily WHERE date = $1 LIMIT 1`,
        [dateString],
      );
      if (alreadyRan && alreadyRan > 0) {
        log.info({ date: dateString }, 'Sentiment rollup: already ran for this date, skipping');
        return;
      }

      // SM-005: Use epoch-ms range bounds instead of to_char() for index usage
      const { startMs, endMs } = dateToEpochMsBounds(dateString, timezone);

      // 1. Aggregate today's mentions per entity
      const { rows: todayAggs } = await client.query<DailyAggRow>(
        `SELECT entity_id,
                AVG(sentiment) AS avg_sentiment,
                COUNT(*)       AS mention_count
         FROM entity_mentions
         WHERE created_at >= $1 AND created_at < $2
           AND sentiment IS NOT NULL
         GROUP BY entity_id`,
        [startMs, endMs],
      );

      if (todayAggs.length === 0) {
        log.info({ date: dateString }, 'Sentiment rollup: no mentions with sentiment today');
        return;
      }

      log.info(
        { date: dateString, entities: todayAggs.length },
        `Sentiment rollup: processing ${todayAggs.length} entities`,
      );

      // SM-003: Batch window lookups into a single query using CTEs
      const recentStart = shiftDate(dateString, -2);
      const priorStart = shiftDate(dateString, -10);
      const priorEnd = shiftDate(dateString, -3);

      const entityIds = todayAggs.map((a) => a.entity_id);

      interface WindowRow {
        entity_id: string;
        recent_sum: number | null;
        recent_count: string;
        prior_avg: number | null;
      }

      const { rows: windowRows } = await client.query<WindowRow>(
        `WITH recent AS (
           SELECT entity_id,
                  SUM(avg_sentiment) AS sum_sentiment,
                  COUNT(*)           AS day_count
           FROM entity_sentiment_daily
           WHERE entity_id = ANY($1)
             AND date >= $2
             AND date <= $3
           GROUP BY entity_id
         ),
         prior AS (
           SELECT entity_id,
                  AVG(avg_sentiment) AS avg_sentiment
           FROM entity_sentiment_daily
           WHERE entity_id = ANY($1)
             AND date >= $4
             AND date <= $5
           GROUP BY entity_id
         )
         SELECT e.entity_id,
                r.sum_sentiment AS recent_sum,
                COALESCE(r.day_count, 0) AS recent_count,
                p.avg_sentiment AS prior_avg
         FROM unnest($1::text[]) AS e(entity_id)
         LEFT JOIN recent r ON r.entity_id = e.entity_id
         LEFT JOIN prior  p ON p.entity_id = e.entity_id`,
        [entityIds, recentStart, dateString, priorStart, priorEnd],
      );

      // Index window results by entity_id for O(1) lookup
      const windowMap = new Map<string, WindowRow>();
      for (const row of windowRows) {
        windowMap.set(row.entity_id, row);
      }

      // Build bulk upsert values
      const upsertValues: unknown[] = [];
      const placeholders: string[] = [];
      let paramIdx = 1;

      for (const agg of todayAggs) {
        const mentionCount = parseInt(agg.mention_count, 10);
        const window = windowMap.get(agg.entity_id);

        // Include today's value in the recent average calculation.
        // The recent window query only covers already-persisted rows,
        // so we blend in today's fresh avg_sentiment manually.
        const recentSum = window?.recent_sum ?? null;
        const recentCount = parseInt(window?.recent_count ?? '0', 10);
        const recentAvg =
          recentCount > 0 && recentSum !== null && recentSum !== undefined
            ? (recentSum + agg.avg_sentiment) / (recentCount + 1)
            : agg.avg_sentiment;

        const priorAvg = window?.prior_avg ?? null;

        // Momentum = recent_avg - prior_avg; null if no prior history
        const momentum =
          priorAvg !== null && priorAvg !== undefined
            ? recentAvg - priorAvg
            : null;

        placeholders.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4})`,
        );
        upsertValues.push(agg.entity_id, dateString, agg.avg_sentiment, mentionCount, momentum);
        paramIdx += 5;
      }

      await client.query('BEGIN');

      await client.query(
        `INSERT INTO entity_sentiment_daily (entity_id, date, avg_sentiment, mention_count, momentum)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (entity_id, date)
         DO UPDATE SET avg_sentiment  = EXCLUDED.avg_sentiment,
                       mention_count  = EXCLUDED.mention_count,
                       momentum       = EXCLUDED.momentum`,
        upsertValues,
      );

      await client.query('COMMIT');

      log.info(
        { date: dateString, upserted: todayAggs.length },
        `Sentiment rollup complete: ${todayAggs.length} rows upserted`,
      );
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      log.error({ err, date: dateString }, 'Sentiment rollup failed');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get momentum context for active entities — used by Stage 3 prompt builder.
   * Returns the latest daily row for each entity plus trend classification.
   */
  async function getMomentumContext(entityIds: string[]): Promise<MomentumEntry[]> {
    if (entityIds.length === 0) return [];

    // Get each entity's most recent daily row (within last 7 days)
    const cutoffDate = shiftDate(new Date().toISOString().slice(0, 10), -7);

    const { rows: latestRows } = await pool.query<MomentumRow>(
      `SELECT DISTINCT ON (sd.entity_id)
              sd.entity_id,
              e.name AS entity_name,
              sd.avg_sentiment,
              sd.mention_count,
              sd.momentum,
              sd.date
       FROM entity_sentiment_daily sd
       JOIN entities e ON e.id = sd.entity_id
       WHERE sd.entity_id = ANY($1)
         AND sd.date >= $2
       ORDER BY sd.entity_id, sd.date DESC`,
      [entityIds, cutoffDate],
    );

    if (latestRows.length === 0) return [];

    // SM-004: Get yesterday's momentum paired per entity via lateral join
    // Build a VALUES list that pairs each entity_id with its specific yesterday date
    const pairValues: unknown[] = [];
    const pairPlaceholders: string[] = [];
    let pIdx = 1;
    for (const row of latestRows) {
      const yesterday = shiftDate(row.date, -1);
      pairPlaceholders.push(`($${pIdx}, $${pIdx + 1})`);
      pairValues.push(row.entity_id, yesterday);
      pIdx += 2;
    }

    const { rows: yesterdayRows } = await pool.query<YesterdayMomentumRow>(
      `SELECT sd.entity_id, sd.momentum
       FROM (VALUES ${pairPlaceholders.join(', ')}) AS v(entity_id, yesterday_date)
       JOIN entity_sentiment_daily sd
         ON sd.entity_id = v.entity_id
        AND sd.date = v.yesterday_date::date`,
      pairValues,
    );

    const yesterdayMap = new Map<string, number | null>();
    for (const row of yesterdayRows) {
      yesterdayMap.set(row.entity_id, row.momentum);
    }

    return latestRows.map((row) => ({
      entityId: row.entity_id,
      entityName: row.entity_name,
      avgSentiment: row.avg_sentiment,
      mentionCount: row.mention_count,
      momentum: row.momentum,
      trend: classifyTrend(row.momentum, yesterdayMap.get(row.entity_id) ?? null),
    }));
  }

  return { runDaily, getMomentumContext };
}
