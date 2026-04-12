import pg from 'pg';
import { ulid } from 'ulid';

type Pool = pg.Pool;

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
