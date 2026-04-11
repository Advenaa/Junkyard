import pg from 'pg';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(databaseUrl: string): pg.Pool {
  // OID 20 = INT8/BIGINT. node-postgres returns BIGINT as string by default.
  // Parse to number — safe because epoch-ms (~1.7T) is well within Number.MAX_SAFE_INTEGER (~9Q).
  pg.types.setTypeParser(20, (val: string) => parseInt(val, 10));

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    // 20 connections: ~5 parallel source polls + embed pipeline + scheduler + API + narrative detection + headroom
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    // Idle client error — pool removes the dead client automatically.
    // Log but do NOT crash; the pool self-heals.
    console.error('pg pool idle client error:', err.message);
  });

  pool.on('connect', (client) => {
    client.query('SET statement_timeout = 30000').catch(() => {
      // Connection will fail on next real query; no action needed
    });
  });

  return pool;
}
