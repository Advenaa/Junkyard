import pg from 'pg';
import { ulid } from 'ulid';

type Pool = pg.Pool;

export interface AlphaPropagationRow {
  id: string;
  entityId: string;
  eventId: string | null;
  tier: string;
  source: string;
  sourceId: string;
  firstMentionTime: number;
  itemId: string | null;
  createdAt: number;
}

function toAlphaPropagationRow(row: Record<string, unknown>): AlphaPropagationRow {
  return {
    id: row.id as string,
    entityId: row.entity_id as string,
    eventId: (row.event_id as string | null) ?? null,
    tier: row.tier as string,
    source: row.source as string,
    sourceId: row.source_id as string,
    firstMentionTime: row.first_mention_time as number,
    itemId: (row.item_id as string | null) ?? null,
    createdAt: row.created_at as number,
  };
}

export async function insertAlphaPropagation(
  pool: Pool,
  record: {
    entityId: string;
    eventId?: string | null;
    tier: string;
    source: string;
    sourceId: string;
    firstMentionTime: number;
    itemId?: string | null;
  },
): Promise<number> {
  const id = ulid();
  const now = Date.now();
  const result = await pool.query(
    `INSERT INTO alpha_propagation (id, entity_id, event_id, tier, source, source_id, first_mention_time, item_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (entity_id, tier, first_mention_day) DO NOTHING`,
    [
      id,
      record.entityId,
      record.eventId ?? null,
      record.tier,
      record.source,
      record.sourceId,
      record.firstMentionTime,
      record.itemId ?? null,
      now,
    ],
  );
  return result.rowCount ?? 0;
}

export async function getAlphaPropagationByEntity(
  pool: Pool,
  entityId: string,
  sinceTime: number,
  limit = 20,
): Promise<AlphaPropagationRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM alpha_propagation
     WHERE entity_id = $1 AND first_mention_time >= $2
     ORDER BY first_mention_time ASC
     LIMIT $3`,
    [entityId, sinceTime, limit],
  );
  return rows.map(toAlphaPropagationRow);
}

export async function getAlphaPropagationByEvent(pool: Pool, eventId: string): Promise<AlphaPropagationRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM alpha_propagation
     WHERE event_id = $1
     ORDER BY first_mention_time ASC`,
    [eventId],
  );
  return rows.map(toAlphaPropagationRow);
}

/** Get the earliest mention per tier for a given entity within a time window. */
export async function getAlphaPropagationSummary(
  pool: Pool,
  entityId: string,
  sinceTime: number,
): Promise<Array<{ tier: string; firstMentionTime: number; source: string; sourceId: string }>> {
  const { rows } = await pool.query<{
    tier: string;
    first_mention_time: number;
    source: string;
    source_id: string;
  }>(
    `SELECT DISTINCT ON (tier)
       tier, first_mention_time, source, source_id
     FROM alpha_propagation
     WHERE entity_id = $1 AND first_mention_time >= $2
     ORDER BY tier, first_mention_time ASC`,
    [entityId, sinceTime],
  );
  return rows.map((r) => ({
    tier: r.tier,
    firstMentionTime: r.first_mention_time,
    source: r.source,
    sourceId: r.source_id,
  }));
}

export interface AlphaWatchEntryRow {
  entityId: string;
  entityName: string;
  firstSignalTier: string;
  firstSignalTime: number;
  latestTier: string;
  latestMentionTime: number;
  propagationLagMs: number | null;
  tierCount: number;
  sourceCount: number;
}

export interface AlphaWatchOverview {
  latestTimestamp: number | null;
  entries: AlphaWatchEntryRow[];
}

function toAlphaWatchEntryRow(row: Record<string, unknown>): AlphaWatchEntryRow {
  return {
    entityId: row.entity_id as string,
    entityName: row.entity_name as string,
    firstSignalTier: row.first_signal_tier as string,
    firstSignalTime: Number(row.first_signal_time),
    latestTier: row.latest_tier as string,
    latestMentionTime: Number(row.latest_mention_time),
    propagationLagMs: row.propagation_lag_ms != null ? Number(row.propagation_lag_ms) : null,
    tierCount: Number(row.tier_count),
    sourceCount: Number(row.source_count),
  };
}

export async function getRecentAlphaWatchlist(pool: Pool, sinceTime: number, limit = 8): Promise<AlphaWatchOverview> {
  const {
    rows: [latestRow],
  } = await pool.query<{ latest_timestamp: number | null }>(
    `SELECT MAX(ap.first_mention_time) AS latest_timestamp
       FROM alpha_propagation ap
       JOIN entities e ON e.id = ap.entity_id
      WHERE ap.first_mention_time >= $1
        AND e.status = 'active'
        AND ap.tier IN ('alpha', 'influencer')`,
    [sinceTime],
  );

  const latestTimestamp = latestRow?.latest_timestamp != null ? Number(latestRow.latest_timestamp) : null;
  if (latestTimestamp == null) {
    return { latestTimestamp: null, entries: [] };
  }

  const { rows } = await pool.query<{
    entity_id: string;
    entity_name: string;
    first_signal_tier: string;
    first_signal_time: number;
    latest_tier: string;
    latest_mention_time: number;
    propagation_lag_ms: number | null;
    tier_count: number;
    source_count: number;
  }>(
    `WITH recent AS (
       SELECT
         ap.entity_id,
         e.name AS entity_name,
         ap.tier,
         ap.source,
         ap.source_id,
         ap.first_mention_time,
         ap.created_at,
         ap.id
       FROM alpha_propagation ap
       JOIN entities e ON e.id = ap.entity_id
       WHERE ap.first_mention_time >= $1
         AND e.status = 'active'
     ),
     first_signal AS (
       SELECT DISTINCT ON (entity_id)
         entity_id,
         entity_name,
         tier AS first_signal_tier,
         first_mention_time AS first_signal_time
       FROM recent
       WHERE tier IN ('alpha', 'influencer')
       ORDER BY entity_id, first_mention_time ASC, created_at ASC, id ASC
     ),
     latest_hits AS (
       SELECT DISTINCT ON (entity_id)
         entity_id,
         tier AS latest_tier,
         first_mention_time AS latest_mention_time
       FROM recent
       WHERE entity_id IN (SELECT entity_id FROM first_signal)
       ORDER BY entity_id, first_mention_time DESC, created_at DESC, id DESC
     ),
     aggregated AS (
       SELECT
         recent.entity_id,
         MAX(recent.entity_name) AS entity_name,
         COUNT(DISTINCT recent.tier) AS tier_count,
         COUNT(DISTINCT recent.source || ':' || recent.source_id) AS source_count
       FROM recent
       WHERE recent.entity_id IN (SELECT entity_id FROM first_signal)
       GROUP BY recent.entity_id
     )
     SELECT
       aggregated.entity_id,
       aggregated.entity_name,
       first_signal.first_signal_tier,
       first_signal.first_signal_time,
       latest_hits.latest_tier,
       latest_hits.latest_mention_time,
       CASE
         WHEN latest_hits.latest_mention_time > first_signal.first_signal_time
         THEN latest_hits.latest_mention_time - first_signal.first_signal_time
         ELSE NULL
       END AS propagation_lag_ms,
       aggregated.tier_count,
       aggregated.source_count
     FROM aggregated
     JOIN first_signal ON first_signal.entity_id = aggregated.entity_id
     JOIN latest_hits ON latest_hits.entity_id = aggregated.entity_id
     ORDER BY latest_hits.latest_mention_time DESC, aggregated.tier_count DESC, aggregated.entity_name ASC
     LIMIT $2`,
    [sinceTime, limit],
  );

  return {
    latestTimestamp,
    entries: rows.map((row) => toAlphaWatchEntryRow(row as Record<string, unknown>)),
  };
}
