import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHealthMonitor } from '../../src/health.js';
import type { Config } from '../../src/config.js';

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLog,
} as never;

function fakeConfig(overrides: Partial<Config> = {}): Config {
  return {
    anthropicApiKey: 'test',
    geminiApiKey: 'test',
    databaseUrl: 'postgresql://test',
    discordClientId: null,
    discordClientSecret: null,
    adminUserIds: [],
    discordTokens: [],
    twitterApiKey: null,
    apiKey: 'test',
    sessionSecret: 'test',
    port: 3000,
    dataDir: './data',
    publicUrl: null,
    alertWebhookUrl: null,
    models: { haiku: 'h', sonnet: 's' },
    secrets: [],
    ...overrides,
  };
}

/**
 * Creates a mock pool where pool.query returns different results
 * based on the SQL text. By default all queries return empty rows
 * or zero counts so that health checks pass.
 */
function createMockPool(overrides: {
  queryFn?: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  totalCount?: number;
  idleCount?: number;
} = {}) {
  const defaultQuery = async (_text: string, _params?: unknown[]) => {
    if (_text.includes('SELECT 1')) {
      return { rows: [{ '?column?': 1 }] };
    }
    // missed_pulse and missed_daily need count > 0 to pass
    if (_text.includes("type = 'pulse'") || _text.includes("type = 'daily'")) {
      return { rows: [{ count: '1' }] };
    }
    if (_text.includes('COUNT(*)')) {
      return { rows: [{ count: '0' }] };
    }
    if (_text.includes('today_cost')) {
      return { rows: [{ today_cost: '0', avg_cost: '0' }] };
    }
    // source_silence and source_disabled: return empty rows (no active/disabled sources)
    return { rows: [] };
  };

  return {
    query: overrides.queryFn ?? defaultQuery,
    totalCount: overrides.totalCount ?? 5,
    idleCount: overrides.idleCount ?? 3,
  } as never;
}

describe('health monitor', () => {
  describe('checkDbConnectivity', () => {
    it('returns ok when pool.query succeeds quickly', async () => {
      const pool = createMockPool();
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const { checks } = await monitor.getStatus();
      const dbCheck = checks.find((c) => c.name === 'db_connectivity');

      assert.ok(dbCheck, 'db_connectivity check should exist');
      assert.equal(dbCheck.status, 'ok');
      assert.ok(dbCheck.message?.includes('DB responsive'), `Expected message containing "DB responsive", got: ${dbCheck.message}`);
    });

    it('returns critical when pool.query throws', async () => {
      const pool = createMockPool({
        queryFn: async (text: string) => {
          if (text.includes('SELECT 1')) {
            throw new Error('connection refused');
          }
          return { rows: [{ count: '0' }] };
        },
      });
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const { checks } = await monitor.getStatus();
      const dbCheck = checks.find((c) => c.name === 'db_connectivity');

      assert.ok(dbCheck, 'db_connectivity check should exist');
      assert.equal(dbCheck.status, 'critical');
      assert.ok(dbCheck.message?.includes('connection refused'), `Expected message containing "connection refused", got: ${dbCheck.message}`);
    });
  });

  describe('getStatus aggregation', () => {
    it('returns healthy=true when all checks pass', async () => {
      const pool = createMockPool();
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const { checks, healthy } = await monitor.getStatus();

      assert.equal(healthy, true);
      for (const check of checks) {
        assert.equal(check.status, 'ok', `Expected ${check.name} to be ok but got ${check.status}`);
      }
    });

    it('returns healthy=false when a check is critical', async () => {
      // Return disabled sources to trigger source_disabled critical
      const pool = createMockPool({
        queryFn: async (text: string) => {
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes("status = 'disabled'")) {
            return { rows: [{ label: 'broken-source' }] };
          }
          if (text.includes('COUNT(*)')) {
            return { rows: [{ count: '0' }] };
          }
          if (text.includes('today_cost')) {
            return { rows: [{ today_cost: '0', avg_cost: '0' }] };
          }
          return { rows: [] };
        },
      });
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const { checks, healthy } = await monitor.getStatus();

      assert.equal(healthy, false);
      const disabled = checks.find((c) => c.name === 'source_disabled');
      assert.ok(disabled, 'source_disabled check should exist');
      assert.equal(disabled.status, 'critical');
      assert.ok(disabled.message?.includes('broken-source'));
    });

    it('returns healthy=false when db connectivity is critical', async () => {
      const pool = createMockPool({
        queryFn: async (text: string) => {
          if (text.includes('SELECT 1')) {
            throw new Error('db down');
          }
          // Other checks still need valid responses
          if (text.includes("type = 'pulse'") || text.includes("type = 'daily'")) {
            return { rows: [{ count: '1' }] };
          }
          if (text.includes('COUNT(*)')) {
            return { rows: [{ count: '0' }] };
          }
          if (text.includes('today_cost')) {
            return { rows: [{ today_cost: '0', avg_cost: '0' }] };
          }
          return { rows: [] };
        },
      });
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const { healthy } = await monitor.getStatus();

      assert.equal(healthy, false);
    });
  });

  describe('source silence check', () => {
    it('returns ok when no active sources exist', async () => {
      const pool = createMockPool();
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const { checks } = await monitor.getStatus();
      const silence = checks.find((c) => c.name === 'source_silence');

      assert.ok(silence);
      assert.equal(silence.status, 'ok');
    });

    it('returns warn when a source has been silent too long', async () => {
      const pool = createMockPool({
        queryFn: async (text: string) => {
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes("status = 'active'")) {
            return {
              rows: [{
                label: 'stale-discord',
                poll_interval: 60, // 60 seconds
                last_fetched_at: Date.now() - 300_000, // 5 minutes ago = 5x the interval (> 3x threshold)
              }],
            };
          }
          if (text.includes("status = 'disabled'")) {
            return { rows: [] };
          }
          if (text.includes('COUNT(*)')) {
            return { rows: [{ count: '0' }] };
          }
          if (text.includes('today_cost')) {
            return { rows: [{ today_cost: '0', avg_cost: '0' }] };
          }
          return { rows: [] };
        },
      });
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const { checks } = await monitor.getStatus();
      const silence = checks.find((c) => c.name === 'source_silence');

      assert.ok(silence);
      assert.equal(silence.status, 'warn');
      assert.ok(silence.message?.includes('stale-discord'));
    });
  });

  describe('db pool exhaustion check', () => {
    it('returns ok when pool has idle connections', async () => {
      const pool = createMockPool({ totalCount: 10, idleCount: 2 });
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const { checks } = await monitor.getStatus();
      const poolCheck = checks.find((c) => c.name === 'db_pool_exhaustion');

      assert.ok(poolCheck);
      assert.equal(poolCheck.status, 'ok');
    });

    it('returns warn when pool is exhausted', async () => {
      const pool = createMockPool({ totalCount: 10, idleCount: 0 });
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const { checks } = await monitor.getStatus();
      const poolCheck = checks.find((c) => c.name === 'db_pool_exhaustion');

      assert.ok(poolCheck);
      assert.equal(poolCheck.status, 'warn');
      assert.ok(poolCheck.message?.includes('Pool exhausted'));
    });
  });
});
