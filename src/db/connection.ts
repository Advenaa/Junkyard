import pg from 'pg';

export type Pool = pg.Pool;

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    // 20 connections: ~5 parallel source polls + embed pipeline + scheduler + API + narrative detection + headroom
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
}
