import pg from 'pg';
import { ulid } from 'ulid';

type Pool = pg.Pool;

interface PriceSnapshotQueryRow {
  id: string;
  entity_id: string;
  timestamp: number;
  price_usd: number;
  price_change_24h: number | null;
  price_change_7d: number | null;
  volume_24h: number | null;
  market_cap: number | null;
  source: string;
  created_at: number;
}

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

interface PriceWatchQueryRow {
  entity_id: string;
  entity_name: string;
  timestamp: number;
  price_usd: string | number;
  price_change_24h: string | number | null;
  price_change_7d: string | number | null;
  volume_24h: string | number | null;
  market_cap: string | number | null;
  avg_sentiment: string | number | null;
  momentum: string | number | null;
}

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
function toPriceSnapshotRow(row: PriceSnapshotQueryRow): PriceSnapshotRow {
  return {
    id: row.id,
    entityId: row.entity_id,
    timestamp: row.timestamp,
    priceUsd: row.price_usd,
    priceChange24h: row.price_change_24h ?? null,
    priceChange7d: row.price_change_7d ?? null,
    volume24h: row.volume_24h ?? null,
    marketCap: row.market_cap ?? null,
    source: row.source,
    createdAt: row.created_at,
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

function toPriceWatchEntry(row: PriceWatchQueryRow): PriceWatchEntry {
  const avgSentiment = row.avg_sentiment == null ? null : Number.parseFloat(String(row.avg_sentiment));
  const priceChange24h = row.price_change_24h == null ? null : Number.parseFloat(String(row.price_change_24h));

  return {
    entityId: row.entity_id,
    entityName: row.entity_name,
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
  const { rows } = await pool.query<PriceSnapshotQueryRow>(
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
  const { rows } = await pool.query<PriceSnapshotQueryRow>(
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
  const { rows } = await pool.query<PriceSnapshotQueryRow>(
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

  const { rows } = await pool.query<PriceSnapshotQueryRow>(
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

  const { rows } = await pool.query<PriceWatchQueryRow>(
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
         AND EXISTS (
           SELECT 1 FROM entity_mentions em
           WHERE em.entity_id = ps.entity_id
         )
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
    entries: rows.map((row) => toPriceWatchEntry(row)),
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
