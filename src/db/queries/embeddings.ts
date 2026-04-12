import pg from 'pg';

type Pool = pg.Pool;

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
