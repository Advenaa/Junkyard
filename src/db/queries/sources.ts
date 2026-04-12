import pg from 'pg';

import type { SourceRow } from './types.js';

type Pool = pg.Pool;

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

export async function updateSourceTier(pool: Pool, source: string, sourceId: string, tier: string): Promise<void> {
  await pool.query(`UPDATE sources SET tier = $3 WHERE source = $1 AND source_id = $2`, [source, sourceId, tier]);
}
