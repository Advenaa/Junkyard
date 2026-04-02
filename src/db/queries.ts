import pg from 'pg';

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
  await pool.query(
    `UPDATE items SET status = 'processed' WHERE batch_id = $1`,
    [batchId],
  );
}

export async function resetCrashed(pool: Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE items SET status = 'ready', batch_id = NULL WHERE status = 'processing'`,
  );
  return result.rowCount ?? 0;
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
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      s.id,
      s.source,
      s.sourceId,
      s.windowStart,
      s.windowEnd,
      s.body,
      s.sentiment,
      s.urgency,
      s.itemCount,
      s.createdAt,
    ],
  );
}

export async function getSummariesByTimeWindow(
  pool: Pool,
  start: number,
  end: number,
): Promise<SummaryRow[]> {
  const { rows } = await pool.query<SummaryRow>(
    `SELECT * FROM summaries WHERE created_at >= $1 AND created_at <= $2 ORDER BY created_at`,
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

export async function getLatestReport(pool: Pool): Promise<ReportRow | null> {
  const { rows } = await pool.query<ReportRow>(
    `SELECT * FROM reports ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

// ── Sources ─────────────────────────────────────────────────────────────

export async function getSources(pool: Pool): Promise<SourceRow[]> {
  const { rows } = await pool.query<SourceRow>(
    `SELECT * FROM sources WHERE enabled = true`,
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
  const { rows } = await pool.query<AppConfigRow>(
    `SELECT value FROM app_config WHERE key = $1`,
    [key],
  );
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
