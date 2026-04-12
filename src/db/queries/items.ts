import pg from 'pg';
import { decodeTime } from 'ulid';

type Pool = pg.Pool;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}

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
