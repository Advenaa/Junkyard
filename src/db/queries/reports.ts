import pg from 'pg';

import type { ReportRow } from './types.js';

type Pool = pg.Pool;

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
