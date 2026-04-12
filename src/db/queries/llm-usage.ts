import pg from 'pg';

type Pool = pg.Pool;

export async function insertLlmUsage(
  pool: Pool,
  u: {
    id: string;
    stage: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    createdAt: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO llm_usage (id, stage, model, input_tokens, output_tokens, cost_usd, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [u.id, u.stage, u.model, u.inputTokens, u.outputTokens, u.costUsd, u.createdAt],
  );
}

export interface LlmCostByModelEntry {
  model: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
}

export async function getLlmCostByModel(pool: Pool, sinceEpochMs: number): Promise<LlmCostByModelEntry[]> {
  const { rows } = await pool.query<{
    model: string;
    total_cost: string;
    total_input_tokens: string;
    total_output_tokens: string;
    call_count: string;
  }>(
    `SELECT
       model,
       COALESCE(SUM(cost_usd), 0) AS total_cost,
       COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
       COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
       COUNT(*) AS call_count
     FROM llm_usage
     WHERE created_at > $1
     GROUP BY model
     ORDER BY total_cost DESC`,
    [sinceEpochMs],
  );

  return rows.map((row) => ({
    model: row.model,
    totalCost: parseFloat(row.total_cost),
    totalInputTokens: parseInt(row.total_input_tokens, 10),
    totalOutputTokens: parseInt(row.total_output_tokens, 10),
    callCount: parseInt(row.call_count, 10),
  }));
}
