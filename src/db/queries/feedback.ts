import pg from 'pg';
import { ulid } from 'ulid';

type Pool = pg.Pool;

export interface FeedbackRow {
  id: string;
  user_id: string;
  target_type: string;
  target_id: string;
  category: string;
  note: string | null;
  status: string;
  created_at: number;
}

export async function insertFeedback(
  pool: Pool,
  userId: string,
  targetType: string,
  targetId: string,
  category: string,
  note: string | null,
): Promise<string> {
  const id = ulid();
  const now = Date.now();
  await pool.query(
    `INSERT INTO feedback (id, user_id, target_type, target_id, category, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, targetType, targetId, category, note, now],
  );
  return id;
}

export async function getFeedbackList(
  pool: Pool,
  opts: { status?: string; limit: number; offset: number },
): Promise<{ rows: FeedbackRow[]; total: number }> {
  const params: unknown[] = [opts.limit, opts.offset];
  let where = '';

  if (opts.status) {
    params.push(opts.status);
    where = `WHERE status = $${params.length}`;
  }

  const [dataResult, countResult] = await Promise.all([
    pool.query<FeedbackRow>(`SELECT * FROM feedback ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`, params),
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM feedback ${where}`, opts.status ? [opts.status] : []),
  ]);

  return {
    rows: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function updateFeedbackStatus(pool: Pool, id: string, status: string): Promise<boolean> {
  const result = await pool.query(`UPDATE feedback SET status = $1 WHERE id = $2`, [status, id]);
  return (result.rowCount ?? 0) > 0;
}
