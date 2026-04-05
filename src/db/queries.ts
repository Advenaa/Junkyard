import pg from 'pg';
import { decodeTime } from 'ulid';

type Pool = pg.Pool;

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
}

export interface AppConfigRow {
  key: string;
  value: string;
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
  const result = await pool.query(
    `INSERT INTO items (
      id, source, source_id, author, content, timestamp, url, engagement,
      content_hash, status, original_language, translated, attachments,
      filter_reason, content_anchor, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13,
      $14, $15, $16
    ) ON CONFLICT (content_hash) DO NOTHING`,
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
  pool: Pool,
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
  await pool.query(
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
