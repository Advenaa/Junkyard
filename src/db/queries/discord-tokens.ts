import pg from 'pg';

type Pool = pg.Pool;

export interface DiscordTokenRow {
  id: string;
  encrypted_token: string;
  iv: string;
  auth_tag: string;
  proxy_url_encrypted: string | null;
  proxy_url_iv: string | null;
  proxy_url_auth_tag: string | null;
  label: string | null;
  status: string;
  added_at: number;
  last_used_at: number | null;
}

export async function getDiscordTokens(pool: Pool): Promise<DiscordTokenRow[]> {
  const { rows } = await pool.query<DiscordTokenRow>(
    `SELECT
       id,
       encrypted_token,
       iv,
       auth_tag,
       proxy_url_encrypted,
       proxy_url_iv,
       proxy_url_auth_tag,
       label,
       status,
       added_at,
       last_used_at
     FROM discord_tokens
     ORDER BY added_at`,
  );
  return rows;
}

export async function insertDiscordToken(
  pool: Pool,
  id: string,
  encryptedToken: string,
  iv: string,
  authTag: string,
  label: string | null,
  addedAt: number,
  proxy: { ciphertext: string; iv: string; authTag: string } | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO discord_tokens (
       id,
       encrypted_token,
       iv,
       auth_tag,
       proxy_url_encrypted,
       proxy_url_iv,
       proxy_url_auth_tag,
       label,
       added_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      encryptedToken,
      iv,
      authTag,
      proxy?.ciphertext ?? null,
      proxy?.iv ?? null,
      proxy?.authTag ?? null,
      label,
      addedAt,
    ],
  );
}

export async function deleteDiscordToken(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM discord_tokens WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function updateDiscordTokenStatus(pool: Pool, id: string, status: string): Promise<boolean> {
  const { rowCount } = await pool.query('UPDATE discord_tokens SET status = $1 WHERE id = $2', [status, id]);
  return (rowCount ?? 0) > 0;
}

export async function updateDiscordTokenLabel(pool: Pool, id: string, label: string): Promise<boolean> {
  const { rowCount } = await pool.query('UPDATE discord_tokens SET label = $1 WHERE id = $2', [label, id]);
  return (rowCount ?? 0) > 0;
}

export async function updateDiscordTokenLastUsed(pool: Pool, id: string, lastUsedAt: number): Promise<void> {
  await pool.query('UPDATE discord_tokens SET last_used_at = $1 WHERE id = $2', [lastUsedAt, id]);
}

export async function updateDiscordTokenProxy(
  pool: Pool,
  id: string,
  proxy: { ciphertext: string; iv: string; authTag: string } | null,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE discord_tokens
       SET proxy_url_encrypted = $1,
           proxy_url_iv = $2,
           proxy_url_auth_tag = $3
     WHERE id = $4`,
    [proxy?.ciphertext ?? null, proxy?.iv ?? null, proxy?.authTag ?? null, id],
  );
  return (rowCount ?? 0) > 0;
}
