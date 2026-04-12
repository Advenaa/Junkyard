import pg from 'pg';
import { ulid } from 'ulid';

type Pool = pg.Pool;

export async function addBookmark(pool: Pool, userId: string, reportId: string): Promise<string> {
  const id = ulid();
  const now = Date.now();
  await pool.query(
    `INSERT INTO bookmarks (id, user_id, report_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, report_id) DO NOTHING`,
    [id, userId, reportId, now],
  );
  return id;
}

export async function removeBookmark(pool: Pool, userId: string, reportId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM bookmarks WHERE user_id = $1 AND report_id = $2`, [userId, reportId]);
  return (result.rowCount ?? 0) > 0;
}

export async function getBookmarkedReportIds(pool: Pool, userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ report_id: string }>(
    `SELECT report_id FROM bookmarks WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map((r) => r.report_id);
}
