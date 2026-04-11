import pg from 'pg';
import { decodeTime, ulid } from 'ulid';
import { distance } from 'fastest-levenshtein';

type Pool = pg.Pool;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}

// ── Row types ───────────────────────────────────────────────────────────

export interface ItemRow {
  id: string;
  source: string;
  source_id: string;
  author: string;
  content: string;
  timestamp: number;
  url: string | null;
  engagement: number;
  attachments: string | null;
  content_hash: string;
  content_anchor: string | null;
  original_language: string | null;
  translated: boolean;
  filter_reason: string | null;
  status: string;
  batch_id: string | null;
  created_at: number;
}

export interface SummaryRow {
  id: string;
  source: string;
  source_id: string;
  window_start: number;
  window_end: number;
  body: string;
  sentiment: number | null;
  urgency: string | null;
  item_count: number;
  created_at: number;
}

export interface ReportRow {
  id: string;
  date: string;
  type: string;
  body: string;
  tldr: string | null;
  sentiment: number | null;
  delivery_status: string;
  delivered_at: number | null;
  created_at: number;
}

export interface SourceRow {
  source: string;
  source_id: string;
  label: string | null;
  enabled: boolean;
  priority: number;
  poll_interval: number;
  trust_weight: number;
  initial_trust_weight: number;
  added_at: number;
  tier: string;
}

export interface AppConfigRow {
  key: string;
  value: string;
}

export interface ChatDailyUsageRow {
  user_id: string;
  usage_day: string;
  token_count: number;
  created_at: number;
  updated_at: number;
}

export interface LlmUsageRow {
  id: string;
  stage: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: number;
}

export interface HealthEventRow {
  id: string;
  category: string;
  severity: string;
  message: string;
  metadata: Record<string, unknown>;
  acknowledged: boolean;
  created_at: number;
}

export interface EmbeddingRow {
  id: string;
  target_type: string;
  target_id: string;
  model: string;
  dimensions: number;
  vector: Buffer;
  created_at: number;
}

export interface CalendarEventRow {
  id: string;
  name: string;
  category: 'macro' | 'unlock' | 'expiry' | 'governance' | 'launch' | 'legal' | 'custom';
  description: string | null;
  recurrence_rule: 'daily' | 'weekly' | 'monthly' | 'quarterly' | null;
  entity_id: string | null;
  entity_name: string | null;
  next_occurrence: number;
  created_at: number;
}

export interface EventRow {
  id: string;
  entity_id: string | null;
  entity_name: string;
  event_type: 'exploit' | 'audit' | 'governance' | 'launch' | 'partnership' | 'funding' | 'hack' | 'legal';
  description: string;
  event_time: number;
  source: string;
  source_id: string;
  summary_id: string;
  chain_id: string | null;
  created_at: number;
}

export interface EventChainRow {
  chain_root_id: string;
  entity_id: string | null;
  entity_name: string;
  event_count: number;
  first_event_time: number;
  latest_event_time: number;
  event_types: string[];
  descriptions: string[];
}

export interface SummaryEventWithChainRow {
  id: string;
  entity_name: string;
  event_type: EventRow['event_type'];
  description: string;
  event_time: number;
  summary_id: string;
  chain_root_id: string;
  chain_event_count: number;
  chain_position: number;
  chain_first_event_time: number;
  chain_latest_event_time: number;
  chain_event_types: string[];
  previous_summary_id: string | null;
  previous_event_type: EventRow['event_type'] | null;
  previous_event_description: string | null;
  previous_event_time: number | null;
  next_summary_id: string | null;
  next_event_type: EventRow['event_type'] | null;
  next_event_description: string | null;
  next_event_time: number | null;
}

export interface ReportChainDrilldownRow {
  chain_root_id: string;
  entity_name: string;
  event_count: number;
  first_event_time: number;
  latest_event_time: number;
  event_types: string[];
  latest_summary_id: string;
  latest_event_type: EventRow['event_type'];
  latest_event_description: string;
  total_chain_count: number;
}

export type EntityRelationshipType =
  | 'competes_with'
  | 'built_on'
  | 'invested_in'
  | 'forked_from'
  | 'acquired'
  | 'founded'
  | 'advises'
  | 'partnered_with'
  | 'regulated_by';
export type EntityRelationshipSource = 'llm_inferred' | 'manual' | 'coingecko';

export interface EntityRelationshipRow {
  id: string;
  entityIdA: string;
  entityNameA: string;
  entityIdB: string;
  entityNameB: string;
  relationshipType: EntityRelationshipType;
  confidence: number;
  source: EntityRelationshipSource;
  summaryId: string | null;
  sinceAt: number | null;
  untilAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface EntityRelationshipGraphNodeRow {
  id: string;
  name: string;
  depth: number;
  isRoot: boolean;
}

export interface EntityRelationshipGraphRow {
  rootEntityId: string;
  nodes: EntityRelationshipGraphNodeRow[];
  relationships: EntityRelationshipRow[];
}

// ── Items ───────────────────────────────────────────────────────────────

export async function insertItem(
  pool: Pool,
  item: {
    id: string;
    source: string;
    sourceId: string;
    author: string;
    content: string;
    timestamp: number;
    url?: string;
    engagement: number;
    contentHash: string;
    status: string;
    originalLanguage?: string;
    translated?: boolean;
    attachments?: string;
    filterReason?: string;
    contentAnchor?: string;
    createdAt: number;
  },
): Promise<{ inserted: boolean }> {
  try {
    const result = await pool.query(
      `INSERT INTO items (
        id, source, source_id, author, content, timestamp, url, engagement,
        content_hash, status, original_language, translated, attachments,
        filter_reason, content_anchor, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16
      ) ON CONFLICT (content_hash) WHERE content_hash IS NOT NULL DO NOTHING`,
      [
        item.id,
        item.source,
        item.sourceId,
        item.author,
        item.content,
        item.timestamp,
        item.url ?? null,
        item.engagement,
        item.contentHash,
        item.status,
        item.originalLanguage ?? null,
        item.translated ?? false,
        item.attachments ?? null,
        item.filterReason ?? null,
        item.contentAnchor ?? null,
        item.createdAt,
      ],
    );
    return { inserted: (result.rowCount ?? 0) > 0 };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { inserted: false };
    }
    throw err;
  }
}

export async function claimBatch(
  pool: Pool,
  batchId: string,
  source: string,
  sourceId: string,
  windowStart: number,
  windowEnd: number,
): Promise<number> {
  const result = await pool.query(
    `UPDATE items
       SET batch_id = $1, status = 'processing'
     WHERE status = 'ready'
       AND source = $2
       AND source_id = $3
       AND timestamp BETWEEN $4 AND $5`,
    [batchId, source, sourceId, windowStart, windowEnd],
  );
  return result.rowCount ?? 0;
}

export async function markProcessed(pool: Pool, batchId: string): Promise<void> {
  await pool.query(`UPDATE items SET status = 'processed' WHERE batch_id = $1`, [batchId]);
}

/**
 * On startup, reset orphaned 'processing' items back to 'ready'.
 * Items that have already exhausted their retry budget are marked 'failed' instead (DP-003).
 */
export async function resetCrashed(pool: Pool, maxRetries = 3): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Mark exhausted items as failed
    await client.query(
      `UPDATE items SET status = 'failed', batch_id = NULL
       WHERE status = 'processing' AND retry_count >= $1`,
      [maxRetries],
    );
    // Reset remaining orphaned items to ready
    const result = await client.query(`UPDATE items SET status = 'ready', batch_id = NULL WHERE status = 'processing'`);
    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Recover items stuck in 'processing' longer than `staleMinutes`.
 * Uses the ULID-encoded timestamp in `batch_id` to determine how long
 * each item has been processing — no schema migration needed.
 * Safe to call periodically (e.g., from health check) without a restart.
 */
export async function recoverStaleProcessing(pool: Pool, staleMinutes = 30, maxRetries = 3): Promise<number> {
  const staleThreshold = Date.now() - staleMinutes * 60 * 1000;

  // Fetch all processing items that have a batch_id (i.e., were claimed)
  const { rows } = await pool.query<{ id: string; batch_id: string; retry_count: number }>(
    `SELECT id, batch_id, retry_count FROM items WHERE status = 'processing' AND batch_id IS NOT NULL`,
  );

  // Determine which items are stale by decoding the ULID timestamp
  const staleIds: string[] = [];
  const exhaustedIds: string[] = [];

  for (const row of rows) {
    let claimedAt: number;
    try {
      claimedAt = decodeTime(row.batch_id);
    } catch {
      // Malformed ULID — treat as stale to avoid permanent stuck items
      claimedAt = 0;
    }
    if (claimedAt < staleThreshold) {
      if (row.retry_count >= maxRetries) {
        exhaustedIds.push(row.id);
      } else {
        staleIds.push(row.id);
      }
    }
  }

  if (staleIds.length === 0 && exhaustedIds.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (exhaustedIds.length > 0) {
      await client.query(
        `UPDATE items SET status = 'failed', batch_id = NULL
         WHERE id = ANY($1)`,
        [exhaustedIds],
      );
    }

    let recoveredCount = 0;
    if (staleIds.length > 0) {
      const result = await client.query(
        `UPDATE items SET status = 'ready', batch_id = NULL, retry_count = retry_count + 1
         WHERE id = ANY($1)`,
        [staleIds],
      );
      recoveredCount = result.rowCount ?? 0;
    }

    await client.query('COMMIT');
    return recoveredCount;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Summaries ───────────────────────────────────────────────────────────

export async function insertSummary(
  db: Pick<Pool, 'query'>,
  s: {
    id: string;
    source: string;
    sourceId: string;
    windowStart: number;
    windowEnd: number;
    body: string;
    sentiment: number | null;
    urgency: string | null;
    itemCount: number;
    createdAt: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO summaries (
      id, source, source_id, window_start, window_end,
      body, sentiment, urgency, item_count, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (id) DO NOTHING`,
    [s.id, s.source, s.sourceId, s.windowStart, s.windowEnd, s.body, s.sentiment, s.urgency, s.itemCount, s.createdAt],
  );
}

export async function getSummariesByTimeWindow(pool: Pool, start: number, end: number): Promise<SummaryRow[]> {
  const { rows } = await pool.query<SummaryRow>(
    `SELECT * FROM summaries WHERE created_at >= $1 AND created_at <= $2 ORDER BY created_at DESC LIMIT 200`,
    [start, end],
  );
  return rows;
}

export async function getSummaryById(pool: Pool, id: string): Promise<SummaryRow | null> {
  const { rows } = await pool.query<SummaryRow>(`SELECT * FROM summaries WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export async function insertEvents(
  pool: Pool,
  events: Array<{
    id: string;
    entityId: string | null;
    entityName: string;
    eventType: EventRow['event_type'];
    description: string;
    eventTime: number;
    source: string;
    sourceId: string;
    summaryId: string;
    chainId?: string | null;
    createdAt: number;
  }>,
): Promise<void> {
  if (events.length === 0) return;

  const values: unknown[] = [];
  const rows = events.map((event, index) => {
    const offset = index * 11;
    values.push(
      event.id,
      event.entityId,
      event.entityName,
      event.eventType,
      event.description,
      event.eventTime,
      event.source,
      event.sourceId,
      event.summaryId,
      event.chainId ?? null,
      event.createdAt,
    );
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`;
  });

  await pool.query(
    `INSERT INTO events (
      id, entity_id, entity_name, event_type, description, event_time,
      source, source_id, summary_id, chain_id, created_at
    ) VALUES ${rows.join(', ')}
    ON CONFLICT (id) DO NOTHING`,
    values,
  );
}

export async function getMostRecentEventForEntity(
  pool: Pool,
  entityId: string,
  beforeTime: number,
  sinceTime: number,
): Promise<EventRow | null> {
  const { rows } = await pool.query<EventRow>(
    `SELECT id, entity_id, entity_name, event_type, description, event_time, source, source_id, summary_id, chain_id, created_at
       FROM events
      WHERE entity_id = $1
        AND event_time < $2
        AND event_time >= $3
      ORDER BY event_time DESC
      LIMIT 1`,
    [entityId, beforeTime, sinceTime],
  );
  return rows[0] ?? null;
}

export async function getRecentEventChains(
  pool: Pool,
  entityIds: string[],
  sinceTime: number,
  limit = 5,
): Promise<EventChainRow[]> {
  const { rows } = await pool.query<EventChainRow>(
    `SELECT COALESCE(chain_id, id) AS chain_root_id,
            MIN(entity_id) AS entity_id,
            MIN(entity_name) AS entity_name,
            COUNT(*)::int AS event_count,
            MIN(event_time) AS first_event_time,
            MAX(event_time) AS latest_event_time,
            ARRAY_AGG(event_type ORDER BY event_time ASC) AS event_types,
            ARRAY_AGG(description ORDER BY event_time ASC) AS descriptions
       FROM events
      WHERE entity_id = ANY($1::text[])
        AND event_time >= $2
      GROUP BY COALESCE(chain_id, id)
     HAVING COUNT(*) > 1
      ORDER BY MAX(event_time) DESC
      LIMIT $3`,
    [entityIds, sinceTime, limit],
  );
  return rows;
}

export async function getSummaryEventsWithChainContext(
  pool: Pool,
  summaryId: string,
): Promise<SummaryEventWithChainRow[]> {
  const { rows } = await pool.query<SummaryEventWithChainRow>(
    `WITH summary_events AS (
       SELECT e.*,
              COALESCE(e.chain_id, e.id) AS chain_root_id
         FROM events e
        WHERE e.summary_id = $1
     ),
     chain_events AS (
       SELECT e.id,
              e.summary_id,
              e.description,
              e.event_type,
              e.event_time,
              e.created_at,
              COALESCE(e.chain_id, e.id) AS chain_root_id
         FROM events e
        WHERE COALESCE(e.chain_id, e.id) IN (SELECT DISTINCT chain_root_id FROM summary_events)
     ),
     chain_stats AS (
       SELECT chain_root_id,
              COUNT(*)::int AS chain_event_count,
              MIN(event_time) AS chain_first_event_time,
              MAX(event_time) AS chain_latest_event_time,
              ARRAY_AGG(event_type ORDER BY event_time ASC, created_at ASC, id ASC) AS chain_event_types
         FROM chain_events
        GROUP BY chain_root_id
     ),
     chain_positions AS (
       SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY chain_root_id
                ORDER BY event_time ASC, created_at ASC, id ASC
              )::int AS chain_position
         FROM chain_events
     )
     SELECT se.id,
            se.entity_name,
            se.event_type,
            se.description,
            se.event_time,
            se.summary_id,
            se.chain_root_id,
            cs.chain_event_count,
            cs.chain_first_event_time,
            cs.chain_latest_event_time,
            cs.chain_event_types,
            cp.chain_position,
            prev.previous_summary_id,
            prev.previous_event_type,
            prev.previous_event_description,
            prev.previous_event_time,
            next.next_summary_id,
            next.next_event_type,
            next.next_event_description,
            next.next_event_time
       FROM summary_events se
       JOIN chain_stats cs ON cs.chain_root_id = se.chain_root_id
       JOIN chain_positions cp ON cp.id = se.id
       LEFT JOIN LATERAL (
         SELECT ce.summary_id AS previous_summary_id,
                ce.event_type AS previous_event_type,
                ce.description AS previous_event_description,
                ce.event_time AS previous_event_time
           FROM chain_events ce
          WHERE ce.chain_root_id = se.chain_root_id
            AND ce.summary_id <> se.summary_id
            AND (
              ce.event_time < se.event_time
              OR (ce.event_time = se.event_time AND ce.created_at < se.created_at)
              OR (ce.event_time = se.event_time AND ce.created_at = se.created_at AND ce.id < se.id)
            )
          ORDER BY ce.event_time DESC, ce.created_at DESC, ce.id DESC
          LIMIT 1
       ) prev ON true
       LEFT JOIN LATERAL (
         SELECT ce.summary_id AS next_summary_id,
                ce.event_type AS next_event_type,
                ce.description AS next_event_description,
                ce.event_time AS next_event_time
           FROM chain_events ce
          WHERE ce.chain_root_id = se.chain_root_id
            AND ce.summary_id <> se.summary_id
            AND (
              ce.event_time > se.event_time
              OR (ce.event_time = se.event_time AND ce.created_at > se.created_at)
              OR (ce.event_time = se.event_time AND ce.created_at = se.created_at AND ce.id > se.id)
            )
          ORDER BY ce.event_time ASC, ce.created_at ASC, ce.id ASC
          LIMIT 1
       ) next ON true
      ORDER BY se.event_time ASC, se.created_at ASC, se.id ASC`,
    [summaryId],
  );
  return rows;
}

export async function getRecentReportChainDrilldowns(
  pool: Pool,
  entityNames: string[],
  beforeTime: number,
  sinceTime: number,
  limit = 5,
): Promise<ReportChainDrilldownRow[]> {
  const normalizedNames = [
    ...new Set(entityNames.map((name) => name.trim().toLowerCase()).filter((name) => name.length > 0)),
  ];
  if (normalizedNames.length === 0) {
    return [];
  }

  const { rows } = await pool.query<ReportChainDrilldownRow>(
    `WITH matching_events AS (
       SELECT e.id,
              e.entity_name,
              e.event_type,
              e.description,
              e.event_time,
              e.summary_id,
              e.created_at,
              COALESCE(e.chain_id, e.id) AS chain_root_id
         FROM events e
        WHERE LOWER(e.entity_name) = ANY($1::text[])
          AND e.event_time <= $2
          AND e.event_time >= $3
     ),
     chain_stats AS (
       SELECT chain_root_id,
              MIN(entity_name) AS entity_name,
              COUNT(*)::int AS event_count,
              MIN(event_time) AS first_event_time,
              MAX(event_time) AS latest_event_time,
              ARRAY_AGG(event_type ORDER BY event_time ASC, created_at ASC, id ASC) AS event_types
         FROM matching_events
        GROUP BY chain_root_id
       HAVING COUNT(*) > 1
     ),
     latest_chain_events AS (
       SELECT chain_root_id,
              summary_id AS latest_summary_id,
              event_type AS latest_event_type,
              description AS latest_event_description,
              ROW_NUMBER() OVER (
                PARTITION BY chain_root_id
                ORDER BY event_time DESC, created_at DESC, id DESC
              )::int AS latest_rank
         FROM matching_events
     )
     SELECT cs.chain_root_id,
            cs.entity_name,
            cs.event_count,
            cs.first_event_time,
            cs.latest_event_time,
            cs.event_types,
            lce.latest_summary_id,
            lce.latest_event_type,
            lce.latest_event_description,
            COUNT(*) OVER ()::int AS total_chain_count
       FROM chain_stats cs
       JOIN latest_chain_events lce
         ON lce.chain_root_id = cs.chain_root_id
        AND lce.latest_rank = 1
      ORDER BY cs.latest_event_time DESC
      LIMIT $4`,
    [normalizedNames, beforeTime, sinceTime, limit],
  );
  return rows;
}

// ── Reports ─────────────────────────────────────────────────────────────

export async function insertReport(
  pool: Pool,
  r: {
    id: string;
    date: string;
    type: string;
    body: string;
    tldr: string | null;
    sentiment: number | null;
    createdAt: number;
  },
): Promise<ReportRow> {
  const { rows } = await pool.query<ReportRow>(
    `INSERT INTO reports (id, date, type, body, tldr, sentiment, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [r.id, r.date, r.type, r.body, r.tldr, r.sentiment, r.createdAt],
  );
  return rows[0];
}

export async function dailyReportExists(pool: Pool, date: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM reports WHERE date = $1 AND type = 'daily') AS exists`,
    [date],
  );
  return rows[0].exists;
}

// ── Sources ─────────────────────────────────────────────────────────────

export interface SourceWithState extends SourceRow {
  last_fetched_at: number | null;
  last_id: string | null;
  error_count: number | null;
  last_error: string | null;
  state_status: string | null;
}

/** Scheduler-only: returns enabled sources for polling. */
export async function getSources(pool: Pool): Promise<SourceRow[]> {
  const { rows } = await pool.query<SourceRow>(`SELECT * FROM sources WHERE enabled = true`);
  return rows;
}

/** Admin dashboard: returns ALL sources (including disabled) with source_state. */
export async function getAllSourcesWithState(pool: Pool): Promise<SourceWithState[]> {
  const { rows } = await pool.query<SourceWithState>(
    `SELECT s.*, ss.last_fetched_at, ss.last_id, ss.error_count, ss.last_error, ss.status AS state_status
     FROM sources s
     LEFT JOIN source_state ss ON ss.source = s.source AND ss.source_id = s.source_id
     ORDER BY s.source, s.source_id`,
  );
  return rows;
}

export async function insertSource(
  pool: Pool,
  source: string,
  sourceId: string,
  label: string | null,
  trustWeight: number,
  addedAt: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO sources (source, source_id, label, trust_weight, initial_trust_weight, added_at)
     VALUES ($1, $2, $3, $4, $4, $5)`,
    [source, sourceId, label, trustWeight, addedAt],
  );
}

// ── App Config ──────────────────────────────────────────────────────────

export async function getAppConfig(pool: Pool, key: string): Promise<string | null> {
  const { rows } = await pool.query<AppConfigRow>(`SELECT value FROM app_config WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

export async function setAppConfig(pool: Pool, key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_config (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value],
  );
}

export async function reserveChatDailyTokens(
  pool: Pool,
  userId: string,
  usageDay: string,
  tokens: number,
  maxTokens: number,
  now: number,
): Promise<{ allowed: boolean; tokenCount: number }> {
  if (tokens <= 0) {
    return { allowed: true, tokenCount: 0 };
  }

  const { rows } = await pool.query<{ token_count: number }>(
    `INSERT INTO chat_daily_usage (user_id, usage_day, token_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (user_id, usage_day) DO UPDATE
       SET token_count = chat_daily_usage.token_count + EXCLUDED.token_count,
           updated_at = EXCLUDED.updated_at
     WHERE chat_daily_usage.token_count + EXCLUDED.token_count <= $5
     RETURNING token_count`,
    [userId, usageDay, tokens, now, maxTokens],
  );

  if (rows.length > 0) {
    return { allowed: true, tokenCount: rows[0]!.token_count };
  }

  const existing = await pool.query<{ token_count: number }>(
    `SELECT token_count FROM chat_daily_usage WHERE user_id = $1 AND usage_day = $2`,
    [userId, usageDay],
  );

  return { allowed: false, tokenCount: existing.rows[0]?.token_count ?? maxTokens };
}

export async function refundChatDailyTokens(
  pool: Pool,
  userId: string,
  usageDay: string,
  tokens: number,
  now: number,
): Promise<void> {
  if (tokens <= 0) return;

  await pool.query(
    `UPDATE chat_daily_usage
        SET token_count = GREATEST(token_count - $3, 0),
            updated_at = $4
      WHERE user_id = $1 AND usage_day = $2`,
    [userId, usageDay, tokens, now],
  );
}

// ── LLM Usage ───────────────────────────────────────────────────────────

export async function insertLlmUsage(
  pool: Pool,
  u: {
    id: string;
    stage: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    createdAt: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO llm_usage (id, stage, model, input_tokens, output_tokens, cost_usd, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [u.id, u.stage, u.model, u.inputTokens, u.outputTokens, u.costUsd, u.createdAt],
  );
}

// ── Health Events ───────────────────────────────────────────────────────

export async function insertHealthEvent(
  pool: Pool,
  e: {
    id: string;
    category: string;
    severity: string;
    message: string;
    metadata: Record<string, unknown>;
    createdAt: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO health_events (id, category, severity, message, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.id, e.category, e.severity, e.message, JSON.stringify(e.metadata), e.createdAt],
  );
}

// ── Embeddings ──────────────────────────────────────────────────────────

export async function insertEmbedding(
  pool: Pool,
  e: {
    id: string;
    targetType: string;
    targetId: string;
    model: string;
    dimensions: number;
    vector: Buffer;
    createdAt: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO embeddings (id, target_type, target_id, model, dimensions, vector, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [e.id, e.targetType, e.targetId, e.model, e.dimensions, e.vector, e.createdAt],
  );
}

// ── Sentiment Daily ────────────────────────────────────────────────────

export async function upsertSentimentDaily(
  pool: Pool,
  entityId: string,
  date: string,
  avgSentiment: number,
  mentionCount: number,
  momentum: number | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO entity_sentiment_daily (entity_id, date, avg_sentiment, mention_count, momentum)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (entity_id, date) DO UPDATE SET
       avg_sentiment = EXCLUDED.avg_sentiment,
       mention_count = EXCLUDED.mention_count,
       momentum = EXCLUDED.momentum`,
    [entityId, date, avgSentiment, mentionCount, momentum],
  );
}

// ── Regional Divergence ───────────────────────────────────────────────

export interface RegionalDivergenceRow {
  entity_id: string;
  entity_name: string;
  eng_sentiment: number;
  eng_mentions: number;
  ind_sentiment: number;
  ind_mentions: number;
  divergence: number;
}

export async function getRegionalDivergence(
  pool: Pool,
  startTime: number,
  endTime: number,
  minMentions: number = 3,
): Promise<RegionalDivergenceRow[]> {
  const { rows } = await pool.query<RegionalDivergenceRow>(
    `WITH per_lang AS (
       SELECT
         em.entity_id,
         e.name AS entity_name,
         em.language,
         AVG(em.sentiment) AS avg_sentiment,
         COUNT(*)::integer AS mention_count
       FROM entity_mentions em
       JOIN entities e ON e.id = em.entity_id
       WHERE em.created_at >= $1
         AND em.created_at <= $2
         AND em.language IN ('eng', 'ind')
         AND em.sentiment IS NOT NULL
       GROUP BY em.entity_id, e.name, em.language
       HAVING COUNT(*) >= $3
     )
     SELECT
       eng.entity_id,
       eng.entity_name,
       eng.avg_sentiment AS eng_sentiment,
       eng.mention_count AS eng_mentions,
       ind.avg_sentiment AS ind_sentiment,
       ind.mention_count AS ind_mentions,
       ABS(eng.avg_sentiment - ind.avg_sentiment) AS divergence
     FROM per_lang eng
     JOIN per_lang ind
       ON eng.entity_id = ind.entity_id
       AND eng.language = 'eng'
       AND ind.language = 'ind'
     WHERE ABS(eng.avg_sentiment - ind.avg_sentiment) > 0.3
     ORDER BY divergence DESC
     LIMIT 500`,
    [startTime, endTime, minMentions],
  );
  return rows;
}

export interface EntityDivergenceRow {
  engSentiment: number | null;
  engMentions: number;
  indSentiment: number | null;
  indMentions: number;
  divergence: number | null;
}

export async function getEntityDivergence(
  pool: Pool,
  entityId: string,
  startTime: number,
  endTime: number,
): Promise<EntityDivergenceRow> {
  const { rows } = await pool.query<{
    eng_sentiment: number | null;
    eng_mentions: number;
    ind_sentiment: number | null;
    ind_mentions: number;
    divergence: number | null;
  }>(
    `WITH per_lang AS (
       SELECT
         language,
         AVG(sentiment) AS avg_sentiment,
         COUNT(*)::integer AS mention_count
       FROM entity_mentions
       WHERE entity_id = $1
         AND created_at >= $2
         AND created_at <= $3
         AND language IN ('eng', 'ind')
         AND sentiment IS NOT NULL
       GROUP BY language
     )
     SELECT
       (SELECT avg_sentiment FROM per_lang WHERE language = 'eng') AS eng_sentiment,
       COALESCE((SELECT mention_count FROM per_lang WHERE language = 'eng'), 0) AS eng_mentions,
       (SELECT avg_sentiment FROM per_lang WHERE language = 'ind') AS ind_sentiment,
       COALESCE((SELECT mention_count FROM per_lang WHERE language = 'ind'), 0) AS ind_mentions,
       CASE
         WHEN (SELECT avg_sentiment FROM per_lang WHERE language = 'eng') IS NOT NULL
          AND (SELECT avg_sentiment FROM per_lang WHERE language = 'ind') IS NOT NULL
         THEN ABS(
           (SELECT avg_sentiment FROM per_lang WHERE language = 'eng')
           - (SELECT avg_sentiment FROM per_lang WHERE language = 'ind')
         )
         ELSE NULL
       END AS divergence`,
    [entityId, startTime, endTime],
  );

  const row = rows[0];
  return {
    engSentiment: row?.eng_sentiment ?? null,
    engMentions: row?.eng_mentions ?? 0,
    indSentiment: row?.ind_sentiment ?? null,
    indMentions: row?.ind_mentions ?? 0,
    divergence: row?.divergence ?? null,
  };
}

export async function getTopDivergentEntities(
  pool: Pool,
  startTime: number,
  endTime: number,
  limit: number = 20,
): Promise<RegionalDivergenceRow[]> {
  const { rows } = await pool.query<RegionalDivergenceRow>(
    `WITH per_lang AS (
       SELECT
         em.entity_id,
         e.name AS entity_name,
         em.language,
         AVG(em.sentiment) AS avg_sentiment,
         COUNT(*)::integer AS mention_count
       FROM entity_mentions em
       JOIN entities e ON e.id = em.entity_id
       WHERE em.created_at >= $1
         AND em.created_at <= $2
         AND em.language IN ('eng', 'ind')
         AND em.sentiment IS NOT NULL
       GROUP BY em.entity_id, e.name, em.language
     )
     SELECT
       eng.entity_id,
       eng.entity_name,
       eng.avg_sentiment AS eng_sentiment,
       eng.mention_count AS eng_mentions,
       ind.avg_sentiment AS ind_sentiment,
       ind.mention_count AS ind_mentions,
       ABS(eng.avg_sentiment - ind.avg_sentiment) AS divergence
     FROM per_lang eng
     JOIN per_lang ind
       ON eng.entity_id = ind.entity_id
       AND eng.language = 'eng'
       AND ind.language = 'ind'
     ORDER BY divergence DESC
     LIMIT $3`,
    [startTime, endTime, limit],
  );
  return rows;
}

// ── Daily Sentiment Computation ───────────────────────────────────────

export async function computeDailySentiment(
  pool: Pool,
  date: string,
): Promise<{ entity_id: string; avg_sentiment: number; mention_count: number }[]> {
  const dayStart = new Date(`${date}T00:00:00Z`).getTime();
  const dayEnd = dayStart + 86_400_000; // +24h in ms

  const { rows } = await pool.query<{
    entity_id: string;
    avg_sentiment: number;
    mention_count: number;
  }>(
    `SELECT
       entity_id,
       AVG(sentiment) AS avg_sentiment,
       COUNT(*)::integer AS mention_count
     FROM entity_mentions
     WHERE created_at >= $1 AND created_at < $2 AND sentiment IS NOT NULL
     GROUP BY entity_id`,
    [dayStart, dayEnd],
  );
  return rows;
}

export interface UnusualActivityEntry {
  entityId: string;
  entityName: string;
  date: string;
  mentionCount: number;
  baselineMentionCount: number | null;
  baselinePeakMentionCount: number | null;
  baselineDays: number;
  avgSentiment: number | null;
  momentum: number | null;
  spikeRatio: number | null;
  relevanceScore: number | null;
  lowRelevance: boolean;
  duplicateClusterSize: number | null;
  duplicateAuthorCount: number | null;
  duplicateSourceCount: number | null;
}

export interface UnusualActivityOverview {
  latestDate: string | null;
  entries: UnusualActivityEntry[];
}

export type NarrativeSignalStrength = 'new' | 'emerging' | 'strong' | 'stable' | 'fading';

export interface NarrativeWatchlistEntry {
  id: string;
  name: string;
  date: string;
  memberCount: number;
  avgSentiment: number | null;
  signalStrength: NarrativeSignalStrength;
}

export interface NarrativeWatchlistOverview {
  latestDate: string | null;
  entries: NarrativeWatchlistEntry[];
}

export interface NarrativeSummaryPreview {
  id: string;
  source: string;
  sourceId: string;
  sentiment: number | null;
  urgency: string | null;
  itemCount: number;
  createdAt: number;
  body: string;
}

export interface NarrativeDrilldown {
  id: string;
  name: string;
  date: string;
  memberCount: number;
  avgSentiment: number | null;
  signalStrength: NarrativeSignalStrength;
  summaries: NarrativeSummaryPreview[];
}

const LOW_RELEVANCE_ACTIVITY_THRESHOLD = 5;

function isLowRelevanceUnusualActivity(score: number | null): boolean {
  return score != null && score < LOW_RELEVANCE_ACTIVITY_THRESHOLD;
}

function toUnusualActivityEntry(row: Record<string, unknown>): UnusualActivityEntry {
  const relevanceScore = row.relevance_score == null ? null : Number.parseFloat(String(row.relevance_score));
  return {
    entityId: row.entity_id as string,
    entityName: row.entity_name as string,
    date: row.date as string,
    mentionCount: Number(row.mention_count),
    baselineMentionCount: row.baseline_mentions == null ? null : Number.parseFloat(String(row.baseline_mentions)),
    baselinePeakMentionCount:
      row.baseline_peak_mentions == null ? null : Number.parseInt(String(row.baseline_peak_mentions), 10),
    baselineDays: Number.parseInt(String(row.baseline_days ?? 0), 10),
    avgSentiment: row.avg_sentiment == null ? null : Number.parseFloat(String(row.avg_sentiment)),
    momentum: row.momentum == null ? null : Number.parseFloat(String(row.momentum)),
    spikeRatio: row.spike_ratio == null ? null : Number.parseFloat(String(row.spike_ratio)),
    relevanceScore,
    lowRelevance: isLowRelevanceUnusualActivity(relevanceScore),
    duplicateClusterSize:
      row.duplicate_cluster_size == null ? null : Number.parseInt(String(row.duplicate_cluster_size), 10),
    duplicateAuthorCount:
      row.duplicate_author_count == null ? null : Number.parseInt(String(row.duplicate_author_count), 10),
    duplicateSourceCount:
      row.duplicate_source_count == null ? null : Number.parseInt(String(row.duplicate_source_count), 10),
  };
}

interface DuplicateClusterSignal {
  duplicateClusterSize: number;
  duplicateAuthorCount: number;
  duplicateSourceCount: number;
}

interface DuplicateClusterItemRow {
  entity_id: string;
  item_id: string;
  author: string;
  source: string;
  source_id: string;
  duplicate_content: string | null;
}

interface DuplicateClusterAccumulator {
  representative: string;
  itemIds: Set<string>;
  authors: Set<string>;
  sources: Set<string>;
}

function normalizeDuplicateClusterContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/g, ' ')
    .replace(/[^a-z0-9\s$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

function duplicateClusterSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - distance(a, b) / maxLen;
}

function detectDuplicateClusterSignal(rows: DuplicateClusterItemRow[]): DuplicateClusterSignal | null {
  const clusters: DuplicateClusterAccumulator[] = [];

  for (const row of rows) {
    const rawContent = row.duplicate_content?.trim();
    if (!rawContent) continue;

    const normalized = normalizeDuplicateClusterContent(rawContent);
    if (normalized.length < 24) continue;

    const existingCluster = clusters.find(
      (cluster) => duplicateClusterSimilarity(normalized, cluster.representative) >= 0.9,
    );
    if (existingCluster) {
      existingCluster.itemIds.add(row.item_id);
      existingCluster.authors.add(row.author.trim().toLowerCase());
      existingCluster.sources.add(`${row.source}\0${row.source_id}`);
      if (normalized.length > existingCluster.representative.length) {
        existingCluster.representative = normalized;
      }
      continue;
    }

    clusters.push({
      representative: normalized,
      itemIds: new Set([row.item_id]),
      authors: new Set([row.author.trim().toLowerCase()]),
      sources: new Set([`${row.source}\0${row.source_id}`]),
    });
  }

  const strongestCluster = clusters
    .map((cluster) => ({
      duplicateClusterSize: cluster.itemIds.size,
      duplicateAuthorCount: [...cluster.authors].filter((author) => author.length > 0).length,
      duplicateSourceCount: cluster.sources.size,
    }))
    .filter((cluster) => cluster.duplicateClusterSize >= 3 && cluster.duplicateAuthorCount >= 2)
    .sort((a, b) => {
      if (b.duplicateClusterSize !== a.duplicateClusterSize) {
        return b.duplicateClusterSize - a.duplicateClusterSize;
      }
      if (b.duplicateAuthorCount !== a.duplicateAuthorCount) {
        return b.duplicateAuthorCount - a.duplicateAuthorCount;
      }
      return b.duplicateSourceCount - a.duplicateSourceCount;
    })[0];

  return strongestCluster ?? null;
}

async function getDuplicateClusterSignalsForEntities(
  pool: Pool,
  entityIds: string[],
  latestDate: string,
  timezone: string,
): Promise<Map<string, DuplicateClusterSignal>> {
  if (entityIds.length === 0) {
    return new Map();
  }

  const { rows } = await pool.query<DuplicateClusterItemRow>(
    `SELECT DISTINCT
       em.entity_id,
       i.id AS item_id,
       i.author,
       i.source,
       i.source_id,
       COALESCE(NULLIF(i.content_anchor, ''), i.content) AS duplicate_content
     FROM items i
     JOIN summaries s ON s.source = i.source AND s.source_id = i.source_id
     JOIN entity_mentions em ON em.summary_id = s.id
     WHERE em.entity_id = ANY($1::text[])
       AND i.status = 'ready'
       AND i.timestamp >= s.window_start
       AND i.timestamp <= s.window_end
       AND DATE(to_timestamp(i.timestamp / 1000.0) AT TIME ZONE $2) = $3::date
     ORDER BY i.timestamp DESC`,
    [entityIds, timezone, latestDate],
  );

  const rowsByEntity = new Map<string, DuplicateClusterItemRow[]>();
  for (const row of rows) {
    const existing = rowsByEntity.get(row.entity_id);
    if (existing) {
      existing.push(row);
    } else {
      rowsByEntity.set(row.entity_id, [row]);
    }
  }

  const signals = new Map<string, DuplicateClusterSignal>();
  for (const entityId of entityIds) {
    const signal = detectDuplicateClusterSignal(rowsByEntity.get(entityId) ?? []);
    if (signal) {
      signals.set(entityId, signal);
    }
  }

  return signals;
}

export async function getUnusualActivityOverview(
  pool: Pool,
  limit = 8,
  timezone = 'Asia/Jakarta',
): Promise<UnusualActivityOverview> {
  const {
    rows: [latestRow],
  } = await pool.query<{ latest_date: string | null }>(`SELECT MAX(date) AS latest_date FROM entity_sentiment_daily`);

  const latestDate = latestRow?.latest_date ?? null;
  if (!latestDate) {
    return { latestDate: null, entries: [] };
  }

  const { rows } = await pool.query(
    `WITH baseline AS (
       SELECT
         entity_id,
         ROUND(AVG(mention_count)::numeric, 2)::float AS baseline_mentions,
         MAX(mention_count)::integer AS baseline_peak_mentions,
         COUNT(*)::integer AS baseline_days
       FROM entity_sentiment_daily
       WHERE date < $1
         AND date >= ($1::date - ($2 * INTERVAL '1 day'))
       GROUP BY entity_id
     )
     SELECT
       sd.entity_id,
       e.name AS entity_name,
       e.relevance AS relevance_score,
       sd.date,
       sd.mention_count,
       sd.avg_sentiment,
       sd.momentum,
       b.baseline_mentions,
       b.baseline_peak_mentions,
       COALESCE(b.baseline_days, 0) AS baseline_days,
       CASE
         WHEN b.baseline_mentions IS NOT NULL AND b.baseline_mentions > 0
         THEN ROUND((sd.mention_count::numeric / b.baseline_mentions), 2)::float
         ELSE NULL
       END AS spike_ratio
     FROM entity_sentiment_daily sd
     JOIN entities e ON e.id = sd.entity_id
     LEFT JOIN baseline b ON b.entity_id = sd.entity_id
     WHERE sd.date = $1
       AND sd.mention_count >= $3
       AND (
         (COALESCE(b.baseline_days, 0) = 0 AND sd.mention_count >= $4)
         OR (
           COALESCE(b.baseline_days, 0) > 0
           AND b.baseline_mentions IS NOT NULL
           AND sd.mention_count >= GREATEST($3, COALESCE(b.baseline_peak_mentions, 0) + $5)
           AND (sd.mention_count::numeric / GREATEST(b.baseline_mentions, 1)) >= $6
         )
       )
     ORDER BY spike_ratio DESC NULLS LAST, sd.mention_count DESC, e.name ASC
     LIMIT $7`,
    [latestDate, 7, 5, 12, 3, 2.5, limit],
  );

  const entries = rows.map((row) => toUnusualActivityEntry(row as Record<string, unknown>));
  const duplicateSignals = await getDuplicateClusterSignalsForEntities(
    pool,
    entries.map((entry) => entry.entityId),
    latestDate,
    timezone,
  );

  return {
    latestDate,
    entries: entries.map((entry) => {
      const duplicateSignal = duplicateSignals.get(entry.entityId);
      if (!duplicateSignal) {
        return entry;
      }
      return {
        ...entry,
        duplicateClusterSize: duplicateSignal.duplicateClusterSize,
        duplicateAuthorCount: duplicateSignal.duplicateAuthorCount,
        duplicateSourceCount: duplicateSignal.duplicateSourceCount,
      };
    }),
  };
}

export async function getNarrativeWatchlist(pool: Pool, limit = 8): Promise<NarrativeWatchlistOverview> {
  const {
    rows: [latestRow],
  } = await pool.query<{ latest_date: string | null }>(`SELECT MAX(date)::text AS latest_date FROM narratives`);

  const latestDate = latestRow?.latest_date ?? null;
  if (!latestDate) {
    return { latestDate: null, entries: [] };
  }

  const { rows } = await pool.query<{
    id: string;
    name: string;
    date: string;
    member_count: number;
    avg_sentiment: number | null;
    signal_strength: NarrativeSignalStrength;
  }>(
    `SELECT
       id,
       name,
       date::text AS date,
       member_count,
       avg_sentiment,
       signal_strength
     FROM narratives
     WHERE date = $1::date
     ORDER BY
       CASE signal_strength
         WHEN 'new' THEN 0
         WHEN 'emerging' THEN 1
         WHEN 'strong' THEN 2
         WHEN 'stable' THEN 3
         WHEN 'fading' THEN 4
         ELSE 5
       END,
       member_count DESC,
       name ASC
     LIMIT $2`,
    [latestDate, limit],
  );

  return {
    latestDate,
    entries: rows.map((row) => ({
      id: row.id,
      name: row.name,
      date: row.date,
      memberCount: Number.parseInt(String(row.member_count), 10),
      avgSentiment: row.avg_sentiment == null ? null : Number.parseFloat(String(row.avg_sentiment)),
      signalStrength: row.signal_strength,
    })),
  };
}

export async function getNarrativeDrilldownById(
  pool: Pool,
  narrativeId: string,
  summaryLimit = 4,
): Promise<NarrativeDrilldown | null> {
  const {
    rows: [narrativeRow],
  } = await pool.query<{
    id: string;
    name: string;
    date: string;
    member_count: number;
    avg_sentiment: number | null;
    signal_strength: NarrativeSignalStrength;
    summary_ids: string[];
  }>(
    `SELECT
       id,
       name,
       date::text AS date,
       member_count,
       avg_sentiment,
       signal_strength,
       summary_ids
     FROM narratives
     WHERE id = $1
     LIMIT 1`,
    [narrativeId],
  );

  if (!narrativeRow) {
    return null;
  }

  const summaryIds = Array.isArray(narrativeRow.summary_ids)
    ? narrativeRow.summary_ids.filter((summaryId) => typeof summaryId === 'string' && summaryId.length > 0)
    : [];

  let summaries: NarrativeSummaryPreview[] = [];
  if (summaryIds.length > 0 && summaryLimit > 0) {
    const { rows } = await pool.query<SummaryRow>(
      `SELECT *
         FROM summaries
        WHERE id = ANY($1::text[])
        ORDER BY created_at DESC
        LIMIT $2`,
      [summaryIds, summaryLimit],
    );

    summaries = rows.map((row) => ({
      id: row.id,
      source: row.source,
      sourceId: row.source_id,
      sentiment: row.sentiment,
      urgency: row.urgency,
      itemCount: row.item_count,
      createdAt: row.created_at,
      body: row.body,
    }));
  }

  return {
    id: narrativeRow.id,
    name: narrativeRow.name,
    date: narrativeRow.date,
    memberCount: Number.parseInt(String(narrativeRow.member_count), 10),
    avgSentiment: narrativeRow.avg_sentiment == null ? null : Number.parseFloat(String(narrativeRow.avg_sentiment)),
    signalStrength: narrativeRow.signal_strength,
    summaries,
  };
}

// ── Discord Tokens ────────────────────────────────────────────────────

export interface DiscordTokenRow {
  id: string;
  encrypted_token: string;
  iv: string;
  auth_tag: string;
  proxy_url_encrypted: string | null;
  proxy_url_iv: string | null;
  proxy_url_auth_tag: string | null;
  label: string | null;
  status: string;
  added_at: number;
  last_used_at: number | null;
}

export async function getDiscordTokens(pool: Pool): Promise<DiscordTokenRow[]> {
  const { rows } = await pool.query<DiscordTokenRow>(
    `SELECT
       id,
       encrypted_token,
       iv,
       auth_tag,
       proxy_url_encrypted,
       proxy_url_iv,
       proxy_url_auth_tag,
       label,
       status,
       added_at,
       last_used_at
     FROM discord_tokens
     ORDER BY added_at`,
  );
  return rows;
}

export async function insertDiscordToken(
  pool: Pool,
  id: string,
  encryptedToken: string,
  iv: string,
  authTag: string,
  label: string | null,
  addedAt: number,
  proxy: { ciphertext: string; iv: string; authTag: string } | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO discord_tokens (
       id,
       encrypted_token,
       iv,
       auth_tag,
       proxy_url_encrypted,
       proxy_url_iv,
       proxy_url_auth_tag,
       label,
       added_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      encryptedToken,
      iv,
      authTag,
      proxy?.ciphertext ?? null,
      proxy?.iv ?? null,
      proxy?.authTag ?? null,
      label,
      addedAt,
    ],
  );
}

export async function deleteDiscordToken(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM discord_tokens WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function updateDiscordTokenStatus(pool: Pool, id: string, status: string): Promise<boolean> {
  const { rowCount } = await pool.query('UPDATE discord_tokens SET status = $1 WHERE id = $2', [status, id]);
  return (rowCount ?? 0) > 0;
}

export async function updateDiscordTokenLabel(pool: Pool, id: string, label: string): Promise<boolean> {
  const { rowCount } = await pool.query('UPDATE discord_tokens SET label = $1 WHERE id = $2', [label, id]);
  return (rowCount ?? 0) > 0;
}

export async function updateDiscordTokenLastUsed(pool: Pool, id: string, lastUsedAt: number): Promise<void> {
  await pool.query('UPDATE discord_tokens SET last_used_at = $1 WHERE id = $2', [lastUsedAt, id]);
}

export async function updateDiscordTokenProxy(
  pool: Pool,
  id: string,
  proxy: { ciphertext: string; iv: string; authTag: string } | null,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE discord_tokens
       SET proxy_url_encrypted = $1,
           proxy_url_iv = $2,
           proxy_url_auth_tag = $3
     WHERE id = $4`,
    [proxy?.ciphertext ?? null, proxy?.iv ?? null, proxy?.authTag ?? null, id],
  );
  return (rowCount ?? 0) > 0;
}

export interface EventSentimentShiftRow {
  pre_avg_sentiment: number | null;
  pre_mention_count: number;
  post_avg_sentiment: number | null;
  post_mention_count: number;
}

export async function getSentimentShiftAroundTime(
  pool: Pool,
  eventTime: number,
  entityId: string | null = null,
  preWindowMs = 48 * 60 * 60 * 1000,
  postWindowMs = 24 * 60 * 60 * 1000,
): Promise<EventSentimentShiftRow> {
  const preStart = eventTime - preWindowMs;
  const postEnd = eventTime + postWindowMs;
  const { rows } = await pool.query<{
    pre_avg_sentiment: number | null;
    pre_mention_count: number | string;
    post_avg_sentiment: number | null;
    post_mention_count: number | string;
  }>(
    `SELECT
       AVG(sentiment) FILTER (WHERE created_at >= $1 AND created_at < $2) AS pre_avg_sentiment,
       COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2) AS pre_mention_count,
       AVG(sentiment) FILTER (WHERE created_at >= $2 AND created_at < $3) AS post_avg_sentiment,
       COUNT(*) FILTER (WHERE created_at >= $2 AND created_at < $3) AS post_mention_count
     FROM entity_mentions
     WHERE sentiment IS NOT NULL
       AND created_at >= $1
       AND created_at < $3
       AND ($4::text IS NULL OR entity_id = $4)`,
    [preStart, eventTime, postEnd, entityId],
  );
  const row = rows[0];
  return {
    pre_avg_sentiment: row?.pre_avg_sentiment ?? null,
    pre_mention_count: Number(row?.pre_mention_count ?? 0),
    post_avg_sentiment: row?.post_avg_sentiment ?? null,
    post_mention_count: Number(row?.post_mention_count ?? 0),
  };
}

// ── Entity Relationships ──────────────────────────────────────────────

const ENTITY_RELATIONSHIP_SELECT = `SELECT
       er.id,
       er.entity_id_a AS "entityIdA",
       ea.name AS "entityNameA",
       er.entity_id_b AS "entityIdB",
       eb.name AS "entityNameB",
       er.relationship_type AS "relationshipType",
       er.confidence,
       er.source,
       er.summary_id AS "summaryId",
       er.since_at AS "sinceAt",
       er.until_at AS "untilAt",
       er.created_at AS "createdAt",
       er.updated_at AS "updatedAt"
     FROM entity_relationships er
     JOIN entities ea ON ea.id = er.entity_id_a
     JOIN entities eb ON eb.id = er.entity_id_b`;

export async function getEntityRelationships(pool: Pool, entityId: string): Promise<EntityRelationshipRow[]> {
  const { rows } = await pool.query<EntityRelationshipRow>(
    `${ENTITY_RELATIONSHIP_SELECT}
      WHERE er.entity_id_a = $1
         OR er.entity_id_b = $1
      ORDER BY er.updated_at DESC, er.created_at DESC`,
    [entityId],
  );
  return rows;
}

export async function getCompetitors(pool: Pool, entityId: string): Promise<EntityRelationshipRow[]> {
  const { rows } = await pool.query<EntityRelationshipRow>(
    `${ENTITY_RELATIONSHIP_SELECT}
      WHERE (er.entity_id_a = $1 OR er.entity_id_b = $1)
        AND er.relationship_type = 'competes_with'
      ORDER BY er.updated_at DESC, er.created_at DESC`,
    [entityId],
  );
  return rows;
}

async function getEntityRelationshipGraphRoot(
  pool: Pool,
  entityId: string,
): Promise<{ id: string; name: string } | null> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name
       FROM entities
      WHERE id = $1`,
    [entityId],
  );
  return rows[0] ?? null;
}

async function getEntityRelationshipBatch(pool: Pool, entityIds: readonly string[]): Promise<EntityRelationshipRow[]> {
  if (entityIds.length === 0) return [];

  const { rows } = await pool.query<EntityRelationshipRow>(
    `${ENTITY_RELATIONSHIP_SELECT}
      WHERE er.entity_id_a = ANY($1::text[])
         OR er.entity_id_b = ANY($1::text[])
      ORDER BY er.updated_at DESC, er.confidence DESC, er.created_at DESC`,
    [entityIds],
  );
  return rows;
}

export async function getEntityRelationshipGraph(
  pool: Pool,
  rootEntityId: string,
  depth = 2,
  nodeLimit = 18,
): Promise<EntityRelationshipGraphRow | null> {
  const root = await getEntityRelationshipGraphRoot(pool, rootEntityId);
  if (!root) return null;

  const boundedDepth = Math.max(1, Math.min(depth, 2));
  const boundedNodeLimit = Math.max(1, Math.min(nodeLimit, 24));
  const nodeDepths = new Map<string, number>([[root.id, 0]]);
  const nodeNames = new Map<string, string>([[root.id, root.name]]);
  const relationshipMap = new Map<string, EntityRelationshipRow>();
  let frontier = new Set<string>([root.id]);

  for (let currentDepth = 0; currentDepth < boundedDepth && frontier.size > 0; currentDepth += 1) {
    const frontierIds = Array.from(frontier);
    const frontierSet = new Set(frontierIds);
    frontier = new Set<string>();

    const rows = await getEntityRelationshipBatch(pool, frontierIds);
    for (const row of rows) {
      nodeNames.set(row.entityIdA, row.entityNameA);
      nodeNames.set(row.entityIdB, row.entityNameB);

      let shouldIncludeRelationship = nodeDepths.has(row.entityIdA) && nodeDepths.has(row.entityIdB);

      const candidateExpansions = [
        { fromId: row.entityIdA, toId: row.entityIdB },
        { fromId: row.entityIdB, toId: row.entityIdA },
      ];

      for (const expansion of candidateExpansions) {
        if (!frontierSet.has(expansion.fromId)) continue;
        const fromDepth = nodeDepths.get(expansion.fromId);
        if (fromDepth == null || fromDepth >= boundedDepth) continue;

        const nextDepth = fromDepth + 1;
        if (nextDepth > boundedDepth) continue;

        const existingDepth = nodeDepths.get(expansion.toId);
        if (existingDepth == null) {
          if (nodeDepths.size >= boundedNodeLimit) continue;
          nodeDepths.set(expansion.toId, nextDepth);
          frontier.add(expansion.toId);
        }

        shouldIncludeRelationship = true;
      }

      if (shouldIncludeRelationship) {
        relationshipMap.set(row.id, row);
      }
    }
  }

  const includedNodeIds = new Set(nodeDepths.keys());
  const relationships = Array.from(relationshipMap.values()).filter(
    (relationship) => includedNodeIds.has(relationship.entityIdA) && includedNodeIds.has(relationship.entityIdB),
  );

  const nodes = Array.from(nodeDepths.entries())
    .map(([id, discoveredDepth]) => ({
      id,
      name: nodeNames.get(id) ?? id,
      depth: discoveredDepth,
      isRoot: id === root.id,
    }))
    .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

  return {
    rootEntityId: root.id,
    nodes,
    relationships,
  };
}

export async function upsertEntityRelationship(
  pool: Pool,
  entityIdA: string,
  entityIdB: string,
  relationshipType: EntityRelationshipType,
  confidence: number,
  source: EntityRelationshipSource,
  summaryId: string | null = null,
  sinceAt: number | null = null,
  untilAt: number | null = null,
): Promise<void> {
  // Canonicalize pair order so (A,B) and (B,A) hit the same unique row
  const [canonA, canonB] = entityIdA < entityIdB ? [entityIdA, entityIdB] : [entityIdB, entityIdA];
  const id = ulid();
  const now = Date.now();

  await pool.query(
    `INSERT INTO entity_relationships (
       id,
       entity_id_a,
       entity_id_b,
       relationship_type,
       confidence,
       source,
       summary_id,
       since_at,
       until_at,
       created_at,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (entity_id_a, entity_id_b, relationship_type) DO UPDATE SET
       confidence = EXCLUDED.confidence,
       source = EXCLUDED.source,
       summary_id = COALESCE(EXCLUDED.summary_id, entity_relationships.summary_id),
       since_at = COALESCE(EXCLUDED.since_at, entity_relationships.since_at),
       until_at = COALESCE(EXCLUDED.until_at, entity_relationships.until_at),
       updated_at = EXCLUDED.updated_at`,
    [id, canonA, canonB, relationshipType, confidence, source, summaryId, sinceAt, untilAt, now, now],
  );
}

export async function deleteEntityRelationship(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM entity_relationships WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

// ── Calendar Events ───────────────────────────────────────────────────

const CALENDAR_EVENT_SELECT = `SELECT
       ce.id,
       ce.name,
       ce.category,
       ce.description,
       ce.recurrence_rule,
       ce.entity_id,
       e.name AS entity_name,
       ce.next_occurrence,
       ce.created_at
     FROM calendar_events ce
     LEFT JOIN entities e ON e.id = ce.entity_id`;

export async function getCalendarEvents(pool: Pool, fromTime: number, limit = 25): Promise<CalendarEventRow[]> {
  const { rows } = await pool.query<CalendarEventRow>(
    `${CALENDAR_EVENT_SELECT}
      WHERE ce.next_occurrence >= $1
      ORDER BY next_occurrence ASC
      LIMIT $2`,
    [fromTime, limit],
  );
  return rows;
}

export async function getUpcomingCalendarEvents(
  pool: Pool,
  startTime: number,
  endTime: number,
  limit = 8,
): Promise<CalendarEventRow[]> {
  const { rows } = await pool.query<CalendarEventRow>(
    `${CALENDAR_EVENT_SELECT}
      WHERE ce.next_occurrence >= $1
        AND ce.next_occurrence <= $2
      ORDER BY ce.next_occurrence ASC
      LIMIT $3`,
    [startTime, endTime, limit],
  );
  return rows;
}

export async function getCalendarEventsInRange(
  pool: Pool,
  startTime: number,
  endTime: number,
  limit = 25,
): Promise<CalendarEventRow[]> {
  const { rows } = await pool.query<CalendarEventRow>(
    `${CALENDAR_EVENT_SELECT}
      WHERE ce.next_occurrence >= $1
        AND ce.next_occurrence <= $2
      ORDER BY ce.next_occurrence DESC
      LIMIT $3`,
    [startTime, endTime, limit],
  );
  return rows;
}

export async function getOverdueRecurringCalendarEvents(pool: Pool, beforeTime: number): Promise<CalendarEventRow[]> {
  const { rows } = await pool.query<CalendarEventRow>(
    `${CALENDAR_EVENT_SELECT}
      WHERE ce.recurrence_rule IS NOT NULL
        AND ce.next_occurrence < $1
      ORDER BY ce.next_occurrence ASC`,
    [beforeTime],
  );
  return rows;
}

export async function insertCalendarEvent(
  pool: Pool,
  event: {
    id: string;
    name: string;
    category: CalendarEventRow['category'];
    description: string | null;
    recurrenceRule: string | null;
    entityId: string | null;
    nextOccurrence: number;
    createdAt: number;
  },
): Promise<CalendarEventRow> {
  const { rows } = await pool.query<CalendarEventRow>(
    `INSERT INTO calendar_events (id, name, category, description, recurrence_rule, entity_id, next_occurrence, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING
       id,
       name,
       category,
       description,
       recurrence_rule,
       entity_id,
       (SELECT entities.name FROM entities WHERE entities.id = calendar_events.entity_id) AS entity_name,
       next_occurrence,
       created_at`,
    [
      event.id,
      event.name,
      event.category,
      event.description,
      event.recurrenceRule,
      event.entityId,
      event.nextOccurrence,
      event.createdAt,
    ],
  );
  return rows[0]!;
}

export async function getCalendarEventById(pool: Pool, id: string): Promise<CalendarEventRow | null> {
  const { rows } = await pool.query<CalendarEventRow>(
    `${CALENDAR_EVENT_SELECT}
      WHERE ce.id = $1
      LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function updateCalendarEvent(
  pool: Pool,
  event: {
    id: string;
    name: string;
    category: CalendarEventRow['category'];
    description: string | null;
    recurrenceRule: CalendarEventRow['recurrence_rule'];
    entityId: string | null;
    nextOccurrence: number;
  },
): Promise<CalendarEventRow | null> {
  const { rows } = await pool.query<CalendarEventRow>(
    `UPDATE calendar_events
        SET name = $2,
            category = $3,
            description = $4,
            recurrence_rule = $5,
            entity_id = $6,
            next_occurrence = $7
      WHERE id = $1
      RETURNING
        id,
        name,
        category,
        description,
        recurrence_rule,
        entity_id,
        (SELECT entities.name FROM entities WHERE entities.id = calendar_events.entity_id) AS entity_name,
        next_occurrence,
        created_at`,
    [
      event.id,
      event.name,
      event.category,
      event.description,
      event.recurrenceRule,
      event.entityId,
      event.nextOccurrence,
    ],
  );
  return rows[0] ?? null;
}

export async function updateCalendarEventOccurrence(pool: Pool, id: string, nextOccurrence: number): Promise<boolean> {
  const { rowCount } = await pool.query(`UPDATE calendar_events SET next_occurrence = $2 WHERE id = $1`, [
    id,
    nextOccurrence,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function deleteExpiredOneTimeCalendarEvents(pool: Pool, beforeTime: number): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM calendar_events
      WHERE recurrence_rule IS NULL
        AND next_occurrence < $1`,
    [beforeTime],
  );
  return rowCount ?? 0;
}

export async function deleteCalendarEvent(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM calendar_events WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

// ── Price Snapshots ────────────────────────────────────────────────────

export interface PriceSnapshotRow {
  id: string;
  entityId: string;
  timestamp: number;
  priceUsd: number;
  priceChange24h: number | null;
  priceChange7d: number | null;
  volume24h: number | null;
  marketCap: number | null;
  source: string;
  createdAt: number;
}

export type PriceContrarianSignal = 'price-up-sentiment-down' | 'price-down-sentiment-up';

export interface PriceWatchEntry {
  entityId: string;
  entityName: string;
  timestamp: number;
  priceUsd: number;
  priceChange24h: number | null;
  priceChange7d: number | null;
  volume24h: number | null;
  marketCap: number | null;
  avgSentiment: number | null;
  momentum: number | null;
  contrarianSignal: PriceContrarianSignal | null;
}

export interface PriceWatchOverview {
  latestTimestamp: number | null;
  entries: PriceWatchEntry[];
}

const PRICE_CONTRARIAN_SENTIMENT_THRESHOLD = 0.2;
const PRICE_CONTRARIAN_MOVE_THRESHOLD = 3;

/** Map a snake_case DB row to a camelCase PriceSnapshotRow. */
function toPriceSnapshotRow(row: Record<string, unknown>): PriceSnapshotRow {
  return {
    id: row.id as string,
    entityId: row.entity_id as string,
    timestamp: row.timestamp as number,
    priceUsd: row.price_usd as number,
    priceChange24h: (row.price_change_24h as number | null) ?? null,
    priceChange7d: (row.price_change_7d as number | null) ?? null,
    volume24h: (row.volume_24h as number | null) ?? null,
    marketCap: (row.market_cap as number | null) ?? null,
    source: row.source as string,
    createdAt: row.created_at as number,
  };
}

function derivePriceContrarianSignal(
  avgSentiment: number | null,
  priceChange24h: number | null,
): PriceContrarianSignal | null {
  if (avgSentiment == null || priceChange24h == null) {
    return null;
  }
  if (avgSentiment <= -PRICE_CONTRARIAN_SENTIMENT_THRESHOLD && priceChange24h >= PRICE_CONTRARIAN_MOVE_THRESHOLD) {
    return 'price-up-sentiment-down';
  }
  if (avgSentiment >= PRICE_CONTRARIAN_SENTIMENT_THRESHOLD && priceChange24h <= -PRICE_CONTRARIAN_MOVE_THRESHOLD) {
    return 'price-down-sentiment-up';
  }
  return null;
}

function toPriceWatchEntry(row: Record<string, unknown>): PriceWatchEntry {
  const avgSentiment = row.avg_sentiment == null ? null : Number.parseFloat(String(row.avg_sentiment));
  const priceChange24h = row.price_change_24h == null ? null : Number.parseFloat(String(row.price_change_24h));

  return {
    entityId: row.entity_id as string,
    entityName: row.entity_name as string,
    timestamp: Number(row.timestamp),
    priceUsd: Number(row.price_usd),
    priceChange24h,
    priceChange7d: row.price_change_7d == null ? null : Number.parseFloat(String(row.price_change_7d)),
    volume24h: row.volume_24h == null ? null : Number.parseFloat(String(row.volume_24h)),
    marketCap: row.market_cap == null ? null : Number.parseFloat(String(row.market_cap)),
    avgSentiment,
    momentum: row.momentum == null ? null : Number.parseFloat(String(row.momentum)),
    contrarianSignal: derivePriceContrarianSignal(avgSentiment, priceChange24h),
  };
}

export async function insertPriceSnapshot(
  pool: Pool,
  snapshot: {
    entityId: string;
    timestamp: number;
    priceUsd: number;
    priceChange24h?: number | null;
    priceChange7d?: number | null;
    volume24h?: number | null;
    marketCap?: number | null;
    source?: string;
  },
): Promise<PriceSnapshotRow> {
  const id = ulid();
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO price_snapshots (
      id, entity_id, timestamp, price_usd, price_change_24h,
      price_change_7d, volume_24h, market_cap, source, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      id,
      snapshot.entityId,
      snapshot.timestamp,
      snapshot.priceUsd,
      snapshot.priceChange24h ?? null,
      snapshot.priceChange7d ?? null,
      snapshot.volume24h ?? null,
      snapshot.marketCap ?? null,
      snapshot.source ?? 'coingecko',
      now,
    ],
  );
  return toPriceSnapshotRow(rows[0]);
}

export async function insertPriceSnapshots(
  pool: Pool,
  snapshots: Array<{
    entityId: string;
    timestamp: number;
    priceUsd: number;
    priceChange24h?: number | null;
    priceChange7d?: number | null;
    volume24h?: number | null;
    marketCap?: number | null;
    source?: string;
  }>,
): Promise<number> {
  if (snapshots.length === 0) return 0;

  const cols = 10; // number of columns per row
  const now = Date.now();
  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    const offset = i * cols;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`,
    );
    values.push(
      ulid(),
      s.entityId,
      s.timestamp,
      s.priceUsd,
      s.priceChange24h ?? null,
      s.priceChange7d ?? null,
      s.volume24h ?? null,
      s.marketCap ?? null,
      s.source ?? 'coingecko',
      now,
    );
  }

  const result = await pool.query(
    `INSERT INTO price_snapshots (
      id, entity_id, timestamp, price_usd, price_change_24h,
      price_change_7d, volume_24h, market_cap, source, created_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
  return result.rowCount ?? 0;
}

export async function getLatestPriceSnapshot(pool: Pool, entityId: string): Promise<PriceSnapshotRow | null> {
  const { rows } = await pool.query(
    `SELECT * FROM price_snapshots
      WHERE entity_id = $1
      ORDER BY timestamp DESC
      LIMIT 1`,
    [entityId],
  );
  return rows.length > 0 ? toPriceSnapshotRow(rows[0]) : null;
}

export async function getPriceHistory(
  pool: Pool,
  entityId: string,
  startTime: number,
  endTime: number,
  limit = 30,
): Promise<PriceSnapshotRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM price_snapshots
      WHERE entity_id = $1
        AND timestamp >= $2
        AND timestamp <= $3
      ORDER BY timestamp DESC
      LIMIT $4`,
    [entityId, startTime, endTime, limit],
  );
  return rows.map(toPriceSnapshotRow);
}

export async function getLatestPricesForEntities(pool: Pool, entityIds: string[]): Promise<PriceSnapshotRow[]> {
  if (entityIds.length === 0) return [];

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (entity_id) *
      FROM price_snapshots
      WHERE entity_id = ANY($1)
      ORDER BY entity_id, timestamp DESC`,
    [entityIds],
  );
  return rows.map(toPriceSnapshotRow);
}

export async function getPriceWatchOverview(pool: Pool, limit = 8): Promise<PriceWatchOverview> {
  const {
    rows: [latestRow],
  } = await pool.query<{ latest_timestamp: number | null }>(
    `SELECT MAX(timestamp) AS latest_timestamp
       FROM price_snapshots`,
  );

  const latestTimestamp = latestRow?.latest_timestamp != null ? Number(latestRow.latest_timestamp) : null;
  if (latestTimestamp == null) {
    return { latestTimestamp: null, entries: [] };
  }

  const freshnessCutoff = latestTimestamp - 3 * 86_400_000;

  const { rows } = await pool.query(
    `WITH latest_prices AS (
       SELECT DISTINCT ON (ps.entity_id)
         ps.entity_id,
         e.name AS entity_name,
         e.relevance,
         ps.timestamp,
         ps.price_usd,
         ps.price_change_24h,
         ps.price_change_7d,
         ps.volume_24h,
         ps.market_cap,
         sd.avg_sentiment,
         sd.momentum
       FROM price_snapshots ps
       JOIN entities e ON e.id = ps.entity_id
       LEFT JOIN LATERAL (
         SELECT avg_sentiment, momentum
           FROM entity_sentiment_daily
          WHERE entity_id = ps.entity_id
          ORDER BY date DESC
          LIMIT 1
       ) sd ON TRUE
       WHERE e.status = 'active'
         AND e.type = 'token'
         AND ps.timestamp >= $1
       ORDER BY ps.entity_id, ps.timestamp DESC
     )
     SELECT
       entity_id,
       entity_name,
       timestamp,
       price_usd,
       price_change_24h,
       price_change_7d,
       volume_24h,
       market_cap,
       avg_sentiment,
       momentum
     FROM latest_prices
     ORDER BY
       CASE
         WHEN avg_sentiment IS NOT NULL
           AND price_change_24h IS NOT NULL
           AND avg_sentiment <= $3
           AND price_change_24h >= $4
         THEN 0
         WHEN avg_sentiment IS NOT NULL
           AND price_change_24h IS NOT NULL
           AND avg_sentiment >= $5
           AND price_change_24h <= $6
         THEN 0
         ELSE 1
       END,
       ABS(COALESCE(price_change_24h, 0)) DESC,
       COALESCE(volume_24h, 0) DESC,
       COALESCE(market_cap, 0) DESC,
       relevance DESC NULLS LAST,
       entity_name ASC
     LIMIT $2`,
    [
      freshnessCutoff,
      limit,
      -PRICE_CONTRARIAN_SENTIMENT_THRESHOLD,
      PRICE_CONTRARIAN_MOVE_THRESHOLD,
      PRICE_CONTRARIAN_SENTIMENT_THRESHOLD,
      -PRICE_CONTRARIAN_MOVE_THRESHOLD,
    ],
  );

  return {
    latestTimestamp,
    entries: rows.map((row) => toPriceWatchEntry(row as Record<string, unknown>)),
  };
}

export type MacroIndicator = 'vix' | 'dxy' | 'us10y' | 'spx' | 'gold';
export type MacroRegimeClassification = 'risk-on' | 'risk-off' | 'transition' | 'unclear';

export interface MacroSnapshotRow {
  id: string;
  date: string;
  indicator: MacroIndicator;
  value: number;
  change1d: number | null;
  change7d: number | null;
  source: string;
  createdAt: number;
}

function toMacroSnapshotRow(row: Record<string, unknown>): MacroSnapshotRow {
  return {
    id: row.id as string,
    date: row.date as string,
    indicator: row.indicator as MacroIndicator,
    value: row.value as number,
    change1d: (row.change_1d as number | null) ?? null,
    change7d: (row.change_7d as number | null) ?? null,
    source: row.source as string,
    createdAt: row.created_at as number,
  };
}

export async function upsertMacroSnapshots(
  pool: Pool,
  snapshots: Array<{
    date: string;
    indicator: MacroIndicator;
    value: number;
    change1d?: number | null;
    change7d?: number | null;
    source?: string;
  }>,
): Promise<number> {
  if (snapshots.length === 0) return 0;

  const cols = 8;
  const now = Date.now();
  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const offset = i * cols;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`,
    );
    values.push(
      ulid(),
      snapshot.date,
      snapshot.indicator,
      snapshot.value,
      snapshot.change1d ?? null,
      snapshot.change7d ?? null,
      snapshot.source ?? 'fred',
      now,
    );
  }

  const result = await pool.query(
    `INSERT INTO macro_snapshots (
      id, date, indicator, value, change_1d, change_7d, source, created_at
    ) VALUES ${placeholders.join(', ')}
    ON CONFLICT (indicator, date) DO UPDATE SET
      value = EXCLUDED.value,
      change_1d = EXCLUDED.change_1d,
      change_7d = EXCLUDED.change_7d,
      source = EXCLUDED.source`,
    values,
  );
  return result.rowCount ?? 0;
}

export async function getLatestMacroSnapshots(pool: Pool, indicators?: MacroIndicator[]): Promise<MacroSnapshotRow[]> {
  const { rows } =
    indicators && indicators.length > 0
      ? await pool.query(
          `SELECT DISTINCT ON (indicator) *
            FROM macro_snapshots
            WHERE indicator = ANY($1)
            ORDER BY indicator, date DESC`,
          [indicators],
        )
      : await pool.query(
          `SELECT DISTINCT ON (indicator) *
            FROM macro_snapshots
            ORDER BY indicator, date DESC`,
        );
  return rows.map(toMacroSnapshotRow);
}

export async function getMacroHistory(pool: Pool, indicator: MacroIndicator, limit = 30): Promise<MacroSnapshotRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM macro_snapshots
      WHERE indicator = $1
      ORDER BY date DESC
      LIMIT $2`,
    [indicator, limit],
  );
  return rows.map(toMacroSnapshotRow);
}

export interface MacroRegimeRow {
  id: string;
  reportId: string;
  date: string;
  reportType: 'daily' | 'pulse';
  classification: MacroRegimeClassification;
  confidence: number;
  rationale: string;
  createdAt: number;
}

export interface MacroRegimeHistory {
  streakDays: number;
  regimeStartedAt: string;
  previousClassification: MacroRegimeClassification | null;
}

function toMacroRegimeRow(row: Record<string, unknown>): MacroRegimeRow {
  return {
    id: row.id as string,
    reportId: row.report_id as string,
    date: row.date as string,
    reportType: row.report_type as 'daily' | 'pulse',
    classification: row.classification as MacroRegimeClassification,
    confidence: row.confidence as number,
    rationale: row.rationale as string,
    createdAt: row.created_at as number,
  };
}

function previousDay(date: string): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function insertMacroRegime(
  pool: Pool,
  regime: {
    reportId: string;
    date: string;
    reportType: 'daily' | 'pulse';
    classification: MacroRegimeClassification;
    confidence: number;
    rationale: string;
    createdAt: number;
  },
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO macro_regimes (
      id, report_id, date, report_type, classification, confidence, rationale, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8
    ) ON CONFLICT (report_id) DO NOTHING`,
    [
      ulid(),
      regime.reportId,
      regime.date,
      regime.reportType,
      regime.classification,
      regime.confidence,
      regime.rationale,
      regime.createdAt,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getMacroRegimeHistoryByReport(pool: Pool, reportId: string): Promise<MacroRegimeHistory | null> {
  const { rows: currentRows } = await pool.query(`SELECT * FROM macro_regimes WHERE report_id = $1 LIMIT 1`, [
    reportId,
  ]);
  if (currentRows.length === 0) return null;

  const current = toMacroRegimeRow(currentRows[0] as Record<string, unknown>);
  const { rows } = await pool.query(
    `SELECT date, classification
       FROM macro_regimes
       WHERE report_type = 'daily' AND date <= $1
       ORDER BY date DESC
       LIMIT 30`,
    [current.date],
  );

  let streakDays = 0;
  let regimeStartedAt = current.date;
  let expectedDate = current.date;
  let previousClassification: MacroRegimeClassification | null = null;

  for (const row of rows as Array<Record<string, unknown>>) {
    const date = row.date as string;
    const classification = row.classification as MacroRegimeClassification;

    if (date !== expectedDate) {
      break;
    }

    if (classification !== current.classification) {
      previousClassification = classification;
      break;
    }

    streakDays += 1;
    regimeStartedAt = date;
    expectedDate = previousDay(date);
  }

  return {
    streakDays,
    regimeStartedAt,
    previousClassification,
  };
}

export interface TokenCoinGeckoMapping {
  entityId: string;
  entityName: string;
  coingeckoId: string;
}

/**
 * Get active token entities with their CoinGecko IDs.
 * CoinGecko IDs come from entity_aliases.context_key ('coingecko:{id}' pattern)
 * for non-top tokens, or fall back to entity.name for top-100 tokens
 * that were seeded with empty context_key.
 */
export async function getActiveTokensWithCoinGeckoIds(pool: Pool): Promise<TokenCoinGeckoMapping[]> {
  const { rows } = await pool.query<{
    entity_id: string;
    entity_name: string;
    coingecko_id: string;
  }>(
    `SELECT DISTINCT ON (e.id)
       e.id AS entity_id,
       e.name AS entity_name,
       CASE
         WHEN ea.context_key LIKE 'coingecko:%'
         THEN SUBSTRING(ea.context_key FROM 11)
         ELSE e.name
       END AS coingecko_id
     FROM entities e
     JOIN entity_aliases ea ON ea.entity_id = e.id
     WHERE e.status = 'active'
       AND e.type = 'token'
       AND (ea.context_key LIKE 'coingecko:%' OR ea.context_key = '')
     ORDER BY e.id, ea.context_key DESC`,
  );

  return rows.map((r) => ({
    entityId: r.entity_id,
    entityName: r.entity_name,
    coingeckoId: r.coingecko_id,
  }));
}

// ── Alpha Propagation ─────────────────────────────────────────────────

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

export async function updateSourceTier(pool: Pool, source: string, sourceId: string, tier: string): Promise<void> {
  await pool.query(`UPDATE sources SET tier = $3 WHERE source = $1 AND source_id = $2`, [source, sourceId, tier]);
}

// ── Author Tracking ──────────────────────────────────────────────────

export interface AuthorRow {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
  createdAt: number;
}

export interface EntityAuthorRow extends AuthorRow {
  entityMentionCount: number;
  firstEntityCallTime: number | null;
  firstMover: boolean;
  firstMoverLagMs: number | null;
}

export interface EntityFirstMoverRow {
  entityId: string;
  entityName: string;
  authorId: string;
  platform: string;
  handle: string;
  displayName: string | null;
  claimType: string;
  claimText: string;
  sourceItemId: string | null;
  timestamp: number;
  nextTrackedCallTime: number | null;
  leadWindowMs: number | null;
}

export interface FirstMoverWatchlistOverview {
  latestTimestamp: number | null;
  entries: EntityFirstMoverRow[];
}

export interface AuthorCallRow {
  id: string;
  authorId: string;
  entityId: string;
  entityName: string | null;
  claimType: string;
  claimText: string;
  confidence: number;
  sourceItemId: string | null;
  timestamp: number;
  createdAt: number;
}

const AUTHOR_BASE_COLUMNS = [
  'id',
  'platform',
  'handle',
  'display_name',
  'first_seen',
  'last_seen',
  'mention_count',
  'created_at',
].join(', ');

const AUTHOR_CALL_COLUMNS = [
  'id',
  'author_id',
  'entity_id',
  'claim_type',
  'claim_text',
  'confidence',
  'source_item_id',
  'timestamp',
  'created_at',
].join(', ');

function toAuthorRow(row: Record<string, unknown>): AuthorRow {
  return {
    id: row.id as string,
    platform: row.platform as string,
    handle: row.handle as string,
    displayName: (row.display_name as string) ?? null,
    firstSeen: Number(row.first_seen),
    lastSeen: Number(row.last_seen),
    mentionCount: Number(row.mention_count),
    createdAt: Number(row.created_at),
  };
}

function toAuthorCallRow(row: Record<string, unknown>): AuthorCallRow {
  return {
    id: row.id as string,
    authorId: row.author_id as string,
    entityId: row.entity_id as string,
    entityName: (row.entity_name as string) ?? null,
    claimType: row.claim_type as string,
    claimText: row.claim_text as string,
    confidence: Number(row.confidence),
    sourceItemId: (row.source_item_id as string) ?? null,
    timestamp: Number(row.timestamp),
    createdAt: Number(row.created_at),
  };
}

export async function upsertAuthor(
  pool: Pool,
  platform: string,
  handle: string,
  displayName: string | null,
  timestamp: number,
): Promise<AuthorRow> {
  const id = ulid();
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO authors (id, platform, handle, display_name, first_seen, last_seen, mention_count, created_at)
     VALUES ($1, $2, $3, $4, $5, $5, 1, $6)
     ON CONFLICT (platform, handle) DO UPDATE
     SET last_seen = GREATEST(authors.last_seen, EXCLUDED.last_seen),
         mention_count = authors.mention_count + 1,
         display_name = COALESCE(EXCLUDED.display_name, authors.display_name)
     RETURNING ${AUTHOR_BASE_COLUMNS}`,
    [id, platform, handle, displayName, timestamp, now],
  );
  return toAuthorRow(rows[0]);
}

export async function getAuthorByHandle(pool: Pool, platform: string, handle: string): Promise<AuthorRow | null> {
  const { rows } = await pool.query(`SELECT ${AUTHOR_BASE_COLUMNS} FROM authors WHERE platform = $1 AND handle = $2`, [
    platform,
    handle,
  ]);
  return rows.length > 0 ? toAuthorRow(rows[0]) : null;
}

export async function getAuthorById(pool: Pool, authorId: string): Promise<AuthorRow | null> {
  const { rows } = await pool.query(`SELECT ${AUTHOR_BASE_COLUMNS} FROM authors WHERE id = $1`, [authorId]);
  return rows.length > 0 ? toAuthorRow(rows[0]) : null;
}

export async function getTopAuthorsByEntity(pool: Pool, entityId: string, limit = 10): Promise<EntityAuthorRow[]> {
  const { rows } = await pool.query(
    `WITH mention_counts AS (
       SELECT a.id AS author_id, COUNT(DISTINCT i.id) AS entity_mention_count
         FROM authors a
         JOIN items i ON i.author = a.handle AND i.source = a.platform
         JOIN summaries s ON s.source = i.source AND s.source_id = i.source_id
         JOIN entity_mentions em ON em.summary_id = s.id AND em.entity_id = $1
        WHERE i.timestamp >= s.window_start AND i.timestamp <= s.window_end
        GROUP BY a.id
     ),
     first_calls AS (
       SELECT ac.author_id, MIN(ac.timestamp) AS first_entity_call_time
         FROM author_calls ac
        WHERE ac.entity_id = $1
        GROUP BY ac.author_id
     ),
     ranked_authors AS (
       SELECT
         a.id,
         a.platform,
         a.handle,
         a.display_name,
         a.first_seen,
         a.last_seen,
         a.mention_count,
         a.created_at,
         mc.entity_mention_count,
         fc.first_entity_call_time,
         MIN(fc.first_entity_call_time) OVER () AS earliest_entity_call_time
       FROM mention_counts mc
       JOIN authors a ON a.id = mc.author_id
       LEFT JOIN first_calls fc ON fc.author_id = a.id
     )
     SELECT
       ranked_authors.*,
       CASE
         WHEN ranked_authors.first_entity_call_time IS NOT NULL
           AND ranked_authors.first_entity_call_time = ranked_authors.earliest_entity_call_time
         THEN true
         ELSE false
       END AS first_mover,
       CASE
         WHEN ranked_authors.first_entity_call_time IS NULL OR ranked_authors.earliest_entity_call_time IS NULL
         THEN NULL
         ELSE ranked_authors.first_entity_call_time - ranked_authors.earliest_entity_call_time
       END AS first_mover_lag_ms
     FROM ranked_authors
     ORDER BY entity_mention_count DESC, first_entity_call_time ASC NULLS LAST, last_seen DESC
     LIMIT $2`,
    [entityId, limit],
  );
  return rows.map((r) => ({
    ...toAuthorRow(r),
    entityMentionCount: Number(r.entity_mention_count),
    firstEntityCallTime: r.first_entity_call_time != null ? Number(r.first_entity_call_time) : null,
    firstMover: Boolean(r.first_mover),
    firstMoverLagMs: r.first_mover_lag_ms != null ? Number(r.first_mover_lag_ms) : null,
  }));
}

function toEntityFirstMoverRow(row: Record<string, unknown>): EntityFirstMoverRow {
  return {
    entityId: row.entity_id as string,
    entityName: row.entity_name as string,
    authorId: row.author_id as string,
    platform: row.platform as string,
    handle: row.handle as string,
    displayName: (row.display_name as string) ?? null,
    claimType: row.claim_type as string,
    claimText: row.claim_text as string,
    sourceItemId: (row.source_item_id as string) ?? null,
    timestamp: Number(row.timestamp),
    nextTrackedCallTime: row.next_tracked_call_time != null ? Number(row.next_tracked_call_time) : null,
    leadWindowMs: row.lead_window_ms != null ? Number(row.lead_window_ms) : null,
  };
}

export async function getEntityFirstMovers(
  pool: Pool,
  entityIds: string[],
  sinceTime: number,
  limit = 6,
): Promise<EntityFirstMoverRow[]> {
  if (entityIds.length === 0) return [];

  const { rows } = await pool.query(
    `WITH ranked_calls AS (
       SELECT
         ac.entity_id,
         e.name AS entity_name,
         ac.author_id,
         a.platform,
         a.handle,
         a.display_name,
         ac.claim_type,
         ac.claim_text,
         ac.source_item_id,
         ac.timestamp,
         LEAD(ac.timestamp) OVER (
           PARTITION BY ac.entity_id
           ORDER BY ac.timestamp ASC, ac.created_at ASC, ac.id ASC
         ) AS next_tracked_call_time,
         ROW_NUMBER() OVER (
           PARTITION BY ac.entity_id
           ORDER BY ac.timestamp ASC, ac.created_at ASC, ac.id ASC
         ) AS entity_rank
       FROM author_calls ac
       JOIN authors a ON a.id = ac.author_id
       JOIN entities e ON e.id = ac.entity_id
       WHERE ac.entity_id = ANY($1::text[])
         AND ac.timestamp >= $2
     )
     SELECT
       ranked_calls.*,
       CASE
         WHEN ranked_calls.next_tracked_call_time IS NULL THEN NULL
         ELSE ranked_calls.next_tracked_call_time - ranked_calls.timestamp
       END AS lead_window_ms
     FROM ranked_calls
     WHERE ranked_calls.entity_rank = 1
     ORDER BY ranked_calls.timestamp ASC
     LIMIT $3`,
    [entityIds, sinceTime, limit],
  );
  return rows.map((row) => toEntityFirstMoverRow(row as Record<string, unknown>));
}

export async function getRecentFirstMoverWatchlist(
  pool: Pool,
  sinceTime: number,
  limit = 8,
): Promise<FirstMoverWatchlistOverview> {
  const {
    rows: [latestRow],
  } = await pool.query<{ latest_timestamp: number | null }>(
    `SELECT MAX(timestamp) AS latest_timestamp
       FROM author_calls
      WHERE timestamp >= $1`,
    [sinceTime],
  );

  const latestTimestamp = latestRow?.latest_timestamp != null ? Number(latestRow.latest_timestamp) : null;
  if (latestTimestamp == null) {
    return { latestTimestamp: null, entries: [] };
  }

  const { rows } = await pool.query(
    `WITH ranked_calls AS (
       SELECT
         ac.entity_id,
         e.name AS entity_name,
         ac.author_id,
         a.platform,
         a.handle,
         a.display_name,
         ac.claim_type,
         ac.claim_text,
         ac.source_item_id,
         ac.timestamp,
         LEAD(ac.timestamp) OVER (
           PARTITION BY ac.entity_id
           ORDER BY ac.timestamp ASC, ac.created_at ASC, ac.id ASC
         ) AS next_tracked_call_time,
         ROW_NUMBER() OVER (
           PARTITION BY ac.entity_id
           ORDER BY ac.timestamp ASC, ac.created_at ASC, ac.id ASC
         ) AS entity_rank
       FROM author_calls ac
       JOIN authors a ON a.id = ac.author_id
       JOIN entities e ON e.id = ac.entity_id
       WHERE ac.timestamp >= $1
     )
     SELECT
       ranked_calls.*,
       CASE
         WHEN ranked_calls.next_tracked_call_time IS NULL THEN NULL
         ELSE ranked_calls.next_tracked_call_time - ranked_calls.timestamp
       END AS lead_window_ms
     FROM ranked_calls
     WHERE ranked_calls.entity_rank = 1
     ORDER BY ranked_calls.timestamp DESC, ranked_calls.entity_name ASC
     LIMIT $2`,
    [sinceTime, limit],
  );

  return {
    latestTimestamp,
    entries: rows.map((row) => toEntityFirstMoverRow(row as Record<string, unknown>)),
  };
}

export async function insertAuthorCall(
  pool: Pool,
  call: {
    authorId: string;
    entityId: string;
    claimType: string;
    claimText: string;
    confidence: number;
    sourceItemId?: string | null;
    timestamp: number;
  },
): Promise<AuthorCallRow> {
  const id = ulid();
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO author_calls (id, author_id, entity_id, claim_type, claim_text, confidence, source_item_id, timestamp, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${AUTHOR_CALL_COLUMNS}`,
    [
      id,
      call.authorId,
      call.entityId,
      call.claimType,
      call.claimText,
      call.confidence,
      call.sourceItemId ?? null,
      call.timestamp,
      now,
    ],
  );
  return toAuthorCallRow(rows[0]);
}

export async function getAuthorCalls(pool: Pool, authorId: string, limit = 20): Promise<AuthorCallRow[]> {
  const { rows } = await pool.query(
    `SELECT ${AUTHOR_CALL_COLUMNS.replaceAll(/(^|,\s*)([a-z_]+)/g, '$1ac.$2')}, e.name AS entity_name
       FROM author_calls ac
       JOIN entities e ON e.id = ac.entity_id
      WHERE ac.author_id = $1
      ORDER BY ac.timestamp DESC
      LIMIT $2`,
    [authorId, limit],
  );
  return rows.map(toAuthorCallRow);
}
