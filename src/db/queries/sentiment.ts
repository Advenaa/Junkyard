import pg from 'pg';
import { distance } from 'fastest-levenshtein';

import type { SummaryRow } from './types.js';

type Pool = pg.Pool;

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
