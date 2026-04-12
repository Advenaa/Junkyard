import pg from 'pg';

import type { AppConfigRow } from './types.js';

type Pool = pg.Pool;

export async function getAppConfig(pool: Pool, key: string): Promise<string | null> {
  const { rows } = await pool.query<AppConfigRow>(`SELECT value FROM app_config WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

export async function setAppConfig(pool: Pool, key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_config (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value],
  );
}

export async function reserveChatDailyTokens(
  pool: Pool,
  userId: string,
  usageDay: string,
  tokens: number,
  maxTokens: number,
  now: number,
): Promise<{ allowed: boolean; tokenCount: number }> {
  if (tokens <= 0) {
    return { allowed: true, tokenCount: 0 };
  }

  const { rows } = await pool.query<{ token_count: number }>(
    `INSERT INTO chat_daily_usage (user_id, usage_day, token_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (user_id, usage_day) DO UPDATE
       SET token_count = chat_daily_usage.token_count + EXCLUDED.token_count,
           updated_at = EXCLUDED.updated_at
     WHERE chat_daily_usage.token_count + EXCLUDED.token_count <= $5
     RETURNING token_count`,
    [userId, usageDay, tokens, now, maxTokens],
  );

  if (rows.length > 0) {
    return { allowed: true, tokenCount: rows[0]!.token_count };
  }

  const existing = await pool.query<{ token_count: number }>(
    `SELECT token_count FROM chat_daily_usage WHERE user_id = $1 AND usage_day = $2`,
    [userId, usageDay],
  );

  return { allowed: false, tokenCount: existing.rows[0]?.token_count ?? maxTokens };
}

export async function refundChatDailyTokens(
  pool: Pool,
  userId: string,
  usageDay: string,
  tokens: number,
  now: number,
): Promise<void> {
  if (tokens <= 0) return;

  await pool.query(
    `UPDATE chat_daily_usage
        SET token_count = GREATEST(token_count - $3, 0),
            updated_at = $4
      WHERE user_id = $1 AND usage_day = $2`,
    [userId, usageDay, tokens, now],
  );
}
