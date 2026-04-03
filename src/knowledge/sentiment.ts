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

interface WindowAvgRow {
  avg_sentiment: number | null;
}

interface WindowSumRow {
  sum_sentiment: number | null;
  day_count: string; // COUNT returns bigint string in pg
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
  async function runDaily(dateString: string): Promise<void> {
    const client = await pool.connect();
    try {
      // 1. Aggregate today's mentions per entity
      const { rows: todayAggs } = await client.query<DailyAggRow>(
        `SELECT entity_id,
                AVG(sentiment) AS avg_sentiment,
                COUNT(*)       AS mention_count
         FROM entity_mentions
         WHERE to_char(to_timestamp(created_at / 1000.0), 'YYYY-MM-DD') = $1
           AND sentiment IS NOT NULL
         GROUP BY entity_id`,
        [dateString],
      );

      if (todayAggs.length === 0) {
        log.info({ date: dateString }, 'Sentiment rollup: no mentions with sentiment today');
        return;
      }

      log.info(
        { date: dateString, entities: todayAggs.length },
        `Sentiment rollup: processing ${todayAggs.length} entities`,
      );

      // 2. For each entity, compute momentum and upsert
      await client.query('BEGIN');

      for (const agg of todayAggs) {
        const mentionCount = parseInt(agg.mention_count, 10);

        // Recent window: last 3 days including today (dateString - 2 .. dateString)
        const recentStart = shiftDate(dateString, -2);
        const { rows: recentRows } = await client.query<WindowSumRow>(
          `SELECT SUM(avg_sentiment) AS sum_sentiment,
                  COUNT(*)           AS day_count
           FROM entity_sentiment_daily
           WHERE entity_id = $1
             AND date >= $2
             AND date <= $3`,
          [agg.entity_id, recentStart, dateString],
        );

        // Prior window: days -10 to -3 relative to today
        const priorStart = shiftDate(dateString, -10);
        const priorEnd = shiftDate(dateString, -3);
        const { rows: priorRows } = await client.query<WindowAvgRow>(
          `SELECT AVG(avg_sentiment) AS avg_sentiment
           FROM entity_sentiment_daily
           WHERE entity_id = $1
             AND date >= $2
             AND date <= $3`,
          [agg.entity_id, priorStart, priorEnd],
        );

        // Include today's value in the recent average calculation.
        // The recent window query above only covers already-persisted rows,
        // so we blend in today's fresh avg_sentiment manually.
        const recentSum = recentRows[0]?.sum_sentiment;
        const recentCount = parseInt(recentRows[0]?.day_count ?? '0', 10);
        const recentAvg =
          recentCount > 0 && recentSum !== null && recentSum !== undefined
            ? (recentSum + agg.avg_sentiment) / (recentCount + 1)
            : agg.avg_sentiment;

        const priorAvg = priorRows[0]?.avg_sentiment;

        // Momentum = recent_avg - prior_avg; null if no prior history
        const momentum =
          priorAvg !== null && priorAvg !== undefined
            ? recentAvg - priorAvg
            : null;

        await client.query(
          `INSERT INTO entity_sentiment_daily (entity_id, date, avg_sentiment, mention_count, momentum)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (entity_id, date)
           DO UPDATE SET avg_sentiment  = EXCLUDED.avg_sentiment,
                         mention_count  = EXCLUDED.mention_count,
                         momentum       = EXCLUDED.momentum`,
          [agg.entity_id, dateString, agg.avg_sentiment, mentionCount, momentum],
        );
      }

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

    // Get yesterday's momentum for each entity to detect reversals
    const latestEntityIds = latestRows.map((r) => r.entity_id);
    const latestDates = latestRows.map((r) => r.date);

    const { rows: yesterdayRows } = await pool.query<YesterdayMomentumRow>(
      `SELECT sd.entity_id, sd.momentum
       FROM entity_sentiment_daily sd
       WHERE sd.entity_id = ANY($1)
         AND sd.date = ANY(
           SELECT to_char(
             (to_date(unnest, 'YYYY-MM-DD') - INTERVAL '1 day'),
             'YYYY-MM-DD'
           )
           FROM unnest($2::text[])
         )
         AND sd.entity_id = ANY($1)`,
      [latestEntityIds, latestDates],
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
