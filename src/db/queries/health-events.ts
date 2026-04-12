import pg from 'pg';

type Pool = pg.Pool;

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
