import type pg from 'pg';

export type PgPool = pg.Pool;

export type MockQueryResult = {
  rows: Record<string, unknown>[];
  rowCount?: number;
};

export type MockQueryFn = (...args: unknown[]) => Promise<MockQueryResult>;

export type MockPool = {
  query: MockQueryFn;
  connect?: () => Promise<{ query: MockQueryFn; release: () => void }>;
};

export type MockLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  fatal: (...args: unknown[]) => void;
  child: () => MockLogger;
};
