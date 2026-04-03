import pg from 'pg';

export type Pool = pg.Pool;

export function createPool(databaseUrl: string): pg.Pool {
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
