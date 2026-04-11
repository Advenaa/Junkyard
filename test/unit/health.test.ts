import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
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
    models: { normalizer: 'h', chunk: 'h', thinkalot: 's' },
    secrets: [],
    ...overrides,
  };
}

/**
 * Creates a mock pool where pool.query returns different results
 * based on the SQL text. By default all queries return empty rows
 * or zero counts so that health checks pass.
 */
function createMockPool(
  overrides: {
    queryFn?: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
    totalCount?: number;
    idleCount?: number;
  } = {},
) {
  const defaultQuery = async (_text: string, _params?: unknown[]) => {
    if (_text.includes('SELECT 1')) {
      return { rows: [{ '?column?': 1 }] };
    }
    if (_text.includes('FROM entity_aliases')) {
      return { rows: [{ alias_count: 1000 }] };
    }
    if (_text.includes('FROM entities') && _text.includes('WHERE last_seen')) {
      return { rows: [{ entity_count: 1000 }] };
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
      assert.ok(
        dbCheck.message?.includes('DB responsive'),
        `Expected message containing "DB responsive", got: ${dbCheck.message}`,
      );
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
      assert.ok(
        dbCheck.message?.includes('connection refused'),
        `Expected message containing "connection refused", got: ${dbCheck.message}`,
      );
    });
  });

  describe('checkReadyBacklog', () => {
    function createReadyBacklogPool(getBacklogCount: () => string) {
      return createMockPool({
        queryFn: async (text: string) => {
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes('FROM llm_usage')) {
            return { rows: [{ count: '1' }] };
          }
          if (
            text.includes('FROM items') &&
            text.includes("WHERE status = 'ready'") &&
            !text.includes('created_at <')
          ) {
            return { rows: [{ count: getBacklogCount() }] };
          }
          if (text.includes('FROM entity_aliases')) {
            return { rows: [{ alias_count: 1000 }] };
          }
          if (text.includes('FROM entities') && text.includes('WHERE last_seen')) {
            return { rows: [{ entity_count: 1000 }] };
          }
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
    }

    it('returns ok when ready backlog is below threshold', async () => {
      const pool = createReadyBacklogPool(() => '100');
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const { checks } = await monitor.getStatus();
      const backlog = checks.find((check) => check.name === 'ready_backlog');

      assert.ok(backlog, 'ready_backlog check should exist');
      assert.equal(backlog.status, 'ok');
    });

    it('returns warn on first tick above threshold, critical on second consecutive tick', async () => {
      const pool = createReadyBacklogPool(() => '6000');
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const firstStatus = await monitor.getStatus();
      const firstBacklog = firstStatus.checks.find((check) => check.name === 'ready_backlog');
      assert.ok(firstBacklog, 'ready_backlog check should exist on first tick');
      assert.equal(firstBacklog.status, 'warn');
      assert.ok(firstBacklog.message?.includes('first tick'));

      const secondStatus = await monitor.getStatus();
      const secondBacklog = secondStatus.checks.find((check) => check.name === 'ready_backlog');
      assert.ok(secondBacklog, 'ready_backlog check should exist on second tick');
      assert.equal(secondBacklog.status, 'critical');
      assert.ok(secondBacklog.message?.includes('2 consecutive'));
    });

    it('resets the rising-edge counter when backlog drops back under threshold', async () => {
      const backlogCounts = ['6000', '6000', '100', '6000'];
      let backlogIndex = 0;
      const pool = createReadyBacklogPool(() => backlogCounts[backlogIndex++] ?? '0');
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const firstStatus = await monitor.getStatus();
      const firstBacklog = firstStatus.checks.find((check) => check.name === 'ready_backlog');
      assert.ok(firstBacklog, 'ready_backlog check should exist on first tick');
      assert.equal(firstBacklog.status, 'warn');

      const secondStatus = await monitor.getStatus();
      const secondBacklog = secondStatus.checks.find((check) => check.name === 'ready_backlog');
      assert.ok(secondBacklog, 'ready_backlog check should exist on second tick');
      assert.equal(secondBacklog.status, 'critical');

      const thirdStatus = await monitor.getStatus();
      const thirdBacklog = thirdStatus.checks.find((check) => check.name === 'ready_backlog');
      assert.ok(thirdBacklog, 'ready_backlog check should exist after backlog recovery');
      assert.equal(thirdBacklog.status, 'ok');

      const fourthStatus = await monitor.getStatus();
      const fourthBacklog = fourthStatus.checks.find((check) => check.name === 'ready_backlog');
      assert.ok(fourthBacklog, 'ready_backlog check should exist after the counter resets');
      assert.equal(fourthBacklog.status, 'warn');
    });

    it('alerts on the second consecutive high tick after recording a first-tick warn', async (t) => {
      const insertedEvents: Array<{ category: string; severity: string; createdAt: number }> = [];
      const backlogCounts = ['6000', '6000'];
      let backlogIndex = 0;
      const pool = createMockPool({
        queryFn: async (text: string, params?: unknown[]) => {
          if (text.includes('INSERT INTO health_events')) {
            const [, category, severity, , , createdAt, cutoff] = params as [
              string,
              string,
              string,
              string,
              string,
              number,
              number,
            ];
            const isDuplicate = insertedEvents.some(
              (event) =>
                event.category === category &&
                event.createdAt > cutoff &&
                (event.severity === severity || severity === 'warn'),
            );
            if (isDuplicate) {
              return { rows: [], rowCount: 0 };
            }
            insertedEvents.push({ category, severity, createdAt });
            return { rows: [], rowCount: 1 };
          }
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes('FROM llm_usage')) {
            return { rows: [{ count: '1' }] };
          }
          if (
            text.includes('FROM items') &&
            text.includes("WHERE status = 'ready'") &&
            !text.includes('created_at <')
          ) {
            return { rows: [{ count: backlogCounts[backlogIndex++] ?? '0' }] };
          }
          if (text.includes('FROM entity_aliases')) {
            return { rows: [{ alias_count: 1000 }] };
          }
          if (text.includes('FROM entities') && text.includes('WHERE last_seen')) {
            return { rows: [{ entity_count: 1000 }] };
          }
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

      const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
      const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
        throw new Error('no AAAA record');
      });
      const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));

      const monitor = createHealthMonitor(
        pool,
        silentLog,
        fakeConfig({ alertWebhookUrl: 'https://alerts.example.com/hook' }),
      );

      await monitor.check();
      assert.equal(insertedEvents.length, 1, 'first high backlog tick should record a warn event');
      assert.equal(insertedEvents[0]?.severity, 'warn');
      assert.strictEqual(fetchMock.mock.callCount(), 0, 'first high backlog tick should not alert yet');

      await monitor.check();
      assert.equal(insertedEvents.length, 2, 'second high backlog tick should record a critical event');
      assert.equal(insertedEvents[1]?.severity, 'critical');
      assert.strictEqual(fetchMock.mock.callCount(), 1, 'second high backlog tick should trigger one alert');

      resolve4Mock.mock.restore();
      resolve6Mock.mock.restore();
      fetchMock.mock.restore();
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

  describe('missed pulse check', () => {
    it('returns critical when no pulse report exists in the last 4 hours and summaries were created', async () => {
      const pool = createMockPool({
        queryFn: async (text: string) => {
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes("type = 'pulse'")) {
            return { rows: [{ count: '0' }] };
          }
          if (text.includes('FROM summaries')) {
            return { rows: [{ count: '2' }] };
          }
          if (text.includes("type = 'daily'")) {
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

      const { checks } = await monitor.getStatus();
      const pulse = checks.find((check) => check.name === 'missed_pulse');

      assert.ok(pulse, 'missed_pulse check should exist');
      assert.equal(pulse.status, 'critical');
      assert.equal(pulse.message, 'No pulse report in last 4 hours');
    });

    it('returns ok when no pulse report exists but the window was quiet', async () => {
      let summaryParams: unknown[] | undefined;
      const pool = createMockPool({
        queryFn: async (text: string, params?: unknown[]) => {
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes("type = 'pulse'")) {
            return { rows: [{ count: '0' }] };
          }
          if (text.includes('FROM summaries')) {
            summaryParams = params;
            return { rows: [{ count: '0' }] };
          }
          if (text.includes("type = 'daily'")) {
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

      const { checks } = await monitor.getStatus();
      const pulse = checks.find((check) => check.name === 'missed_pulse');

      assert.ok(pulse, 'missed_pulse check should exist');
      assert.equal(pulse.status, 'ok');
      assert.equal(summaryParams?.length, 2, 'summary query should inspect the closed missing-pulse window');
    });

    it('returns ok when a pulse report exists in the last 4 hours', async () => {
      const pool = createMockPool();
      const monitor = createHealthMonitor(pool, silentLog, fakeConfig());

      const { checks } = await monitor.getStatus();
      const pulse = checks.find((check) => check.name === 'missed_pulse');

      assert.ok(pulse, 'missed_pulse check should exist');
      assert.equal(pulse.status, 'ok');
    });

    it('records a critical health event and sends an alert webhook when pulse is missing', async (t) => {
      const insertedEvents: unknown[][] = [];
      const pool = createMockPool({
        queryFn: async (text: string, params?: unknown[]) => {
          if (text.includes('INSERT INTO health_events')) {
            insertedEvents.push([...(params ?? [])]);
            return { rows: [], rowCount: 1 };
          }
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes("type = 'pulse'")) {
            return { rows: [{ count: '0' }] };
          }
          if (text.includes('FROM summaries')) {
            return { rows: [{ count: '3' }] };
          }
          if (text.includes("type = 'daily'")) {
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

      const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
      const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
        throw new Error('no AAAA record');
      });
      const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));

      const monitor = createHealthMonitor(
        pool,
        silentLog,
        fakeConfig({ alertWebhookUrl: 'https://alerts.example.com/hook' }),
      );
      await monitor.check();

      assert.equal(insertedEvents.length, 1, 'missed pulse should insert exactly one health event');
      assert.equal(insertedEvents[0]?.[1], 'missed_pulse');
      assert.equal(insertedEvents[0]?.[2], 'critical');
      assert.equal(insertedEvents[0]?.[3], 'No pulse report in last 4 hours');

      assert.strictEqual(fetchMock.mock.callCount(), 1, 'critical missed pulse should trigger one alert webhook');
      const [, requestInit] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
      const payload = JSON.parse(String(requestInit.body)) as {
        embeds: Array<{ title: string; description: string }>;
      };
      assert.equal(payload.embeds[0]?.title, 'Health Alert: missed_pulse');
      assert.equal(payload.embeds[0]?.description, 'No pulse report in last 4 hours');

      resolve4Mock.mock.restore();
      resolve6Mock.mock.restore();
      fetchMock.mock.restore();
    });

    it('does not record a health event or alert when no pulse report exists but the window was quiet', async (t) => {
      const insertedEvents: unknown[][] = [];
      const pool = createMockPool({
        queryFn: async (text: string, params?: unknown[]) => {
          if (text.includes('INSERT INTO health_events')) {
            insertedEvents.push([...(params ?? [])]);
            return { rows: [], rowCount: 1 };
          }
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes("type = 'pulse'")) {
            return { rows: [{ count: '0' }] };
          }
          if (text.includes('FROM summaries')) {
            return { rows: [{ count: '0' }] };
          }
          if (text.includes("type = 'daily'")) {
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

      const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
      const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
        throw new Error('no AAAA record');
      });
      const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));

      const monitor = createHealthMonitor(
        pool,
        silentLog,
        fakeConfig({ alertWebhookUrl: 'https://alerts.example.com/hook' }),
      );
      await monitor.check();

      assert.equal(insertedEvents.length, 0, 'quiet window should not insert a missed pulse event');
      assert.strictEqual(fetchMock.mock.callCount(), 0, 'quiet window should not trigger the alert webhook');

      resolve4Mock.mock.restore();
      resolve6Mock.mock.restore();
      fetchMock.mock.restore();
    });
  });

  describe('alert webhook retries', () => {
    it('reuses the original DNS validation across alert-webhook retries when DB is down', async (t) => {
      const pool = createMockPool({
        queryFn: async (text: string) => {
          if (text.includes('SELECT 1')) {
            throw new Error('db down');
          }
          return { rows: [] };
        },
      });

      const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
      const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
        throw new Error('no AAAA record');
      });
      let fetchAttempt = 0;
      const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
        fetchAttempt++;
        return new Response(null, { status: fetchAttempt === 1 ? 500 : 200 });
      });
      const setTimeoutMock = t.mock.method(globalThis, 'setTimeout', ((callback: (...args: any[]) => void) => {
        callback();
        return 0;
      }) as typeof setTimeout);

      const monitor = createHealthMonitor(
        pool,
        silentLog,
        fakeConfig({ alertWebhookUrl: 'https://alerts.example.com/hook' }),
      );
      await monitor.check();

      assert.strictEqual(fetchMock.mock.callCount(), 2, 'alert webhook should retry once after a 5xx response');
      assert.strictEqual(
        resolve4Mock.mock.callCount(),
        1,
        'alert retries should reuse the first validated IPv4 result',
      );
      assert.strictEqual(resolve6Mock.mock.callCount(), 1, 'alert retries should not re-run IPv6 resolution either');

      const firstCall = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
      const secondCall = fetchMock.mock.calls[1]!.arguments as [string, RequestInit];
      assert.strictEqual(firstCall[0], 'https://alerts.example.com/hook');
      assert.strictEqual(secondCall[0], 'https://alerts.example.com/hook');
      assert.ok(firstCall[1].dispatcher, 'first alert attempt should use a pinned dispatcher');
      assert.ok(secondCall[1].dispatcher, 'retry should also use a pinned dispatcher');

      setTimeoutMock.mock.restore();
      fetchMock.mock.restore();
      resolve4Mock.mock.restore();
      resolve6Mock.mock.restore();
    });
  });

  describe('checkEntityAliases', () => {
    it('returns ok on fresh install when there are no active entities', async () => {
      const pool = createMockPool({
        queryFn: async (text: string) => {
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes('FROM entity_aliases')) {
            return { rows: [{ alias_count: 0 }] };
          }
          if (text.includes('FROM entities') && text.includes('WHERE last_seen')) {
            return { rows: [{ entity_count: 0 }] };
          }
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

      const { checks } = await monitor.getStatus();
      const aliasCheck = checks.find((c) => c.name === 'entity_aliases');

      assert.ok(aliasCheck, 'entity_aliases check should exist');
      assert.equal(aliasCheck.status, 'ok');
      assert.equal(aliasCheck.message, 'No active entities yet — skipping alias health check');
    });

    it('returns warn when seeding likely failed', async () => {
      const pool = createMockPool({
        queryFn: async (text: string) => {
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes('FROM entity_aliases')) {
            return { rows: [{ alias_count: 10 }] };
          }
          if (text.includes('FROM entities') && text.includes('WHERE last_seen')) {
            return { rows: [{ entity_count: 500 }] };
          }
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

      const { checks } = await monitor.getStatus();
      const aliasCheck = checks.find((c) => c.name === 'entity_aliases');

      assert.ok(aliasCheck, 'entity_aliases check should exist');
      assert.equal(aliasCheck.status, 'warn');
      assert.ok(aliasCheck.message?.includes('10'));
      assert.ok(aliasCheck.message?.includes('500'));
    });

    it('returns ok when well seeded', async () => {
      const pool = createMockPool({
        queryFn: async (text: string) => {
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes('FROM entity_aliases')) {
            return { rows: [{ alias_count: 3000 }] };
          }
          if (text.includes('FROM entities') && text.includes('WHERE last_seen')) {
            return { rows: [{ entity_count: 500 }] };
          }
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

      const { checks } = await monitor.getStatus();
      const aliasCheck = checks.find((c) => c.name === 'entity_aliases');

      assert.ok(aliasCheck, 'entity_aliases check should exist');
      assert.equal(aliasCheck.status, 'ok');
      assert.ok(aliasCheck.message?.includes('3000'));
      assert.ok(aliasCheck.message?.includes('500'));
    });

    it('returns critical on query error', async () => {
      const pool = createMockPool({
        queryFn: async (text: string) => {
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes('FROM entity_aliases')) {
            throw new Error('alias query failed');
          }
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

      const { checks } = await monitor.getStatus();
      const aliasCheck = checks.find((c) => c.name === 'entity_aliases');

      assert.ok(aliasCheck, 'entity_aliases check should exist');
      assert.equal(aliasCheck.status, 'critical');
      assert.ok(aliasCheck.message?.includes('alias query failed'));
    });

    it('recordEvent inserts a health event via the existing dedup path', async () => {
      const insertedEvents: unknown[][] = [];
      const pool = createMockPool({
        queryFn: async (text: string, params?: unknown[]) => {
          if (text.includes('INSERT INTO health_events')) {
            insertedEvents.push([...(params ?? [])]);
            return { rows: [], rowCount: 1 };
          }
          if (text.includes('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          if (text.includes('FROM entity_aliases')) {
            return { rows: [{ alias_count: 1000 }] };
          }
          if (text.includes('FROM entities') && text.includes('WHERE last_seen')) {
            return { rows: [{ entity_count: 1000 }] };
          }
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

      await monitor.recordEvent({
        category: 'seed_failure',
        severity: 'warn',
        message: 'test',
        metadata: {},
      });

      assert.equal(insertedEvents.length, 1, 'recordEvent should insert one health event');
      assert.equal(insertedEvents[0]?.[1], 'seed_failure');
      assert.equal(insertedEvents[0]?.[2], 'warn');
      assert.equal(insertedEvents[0]?.[3], 'test');
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
          if (text.includes('LEFT JOIN source_state')) {
            return {
              rows: [
                {
                  label: 'stale-discord',
                  poll_interval: 60, // 60 seconds
                  last_fetched_at: Date.now() - 300_000, // 5 minutes ago = 5x the interval (> 3x threshold)
                  status: 'active',
                },
              ],
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

  describe('SC-001: catchUpTime wraps past midnight', () => {
    /**
     * Mirrors the exact computation from src/index.ts onHealthCheck (~line 291-295).
     * Extracted here so we can unit-test the arithmetic without wiring up the full
     * health-check handler (which needs pool, config, synthesizer, etc.).
     */
    function computeCatchUpTime(digestTime: string, bufferMinutes: number): string {
      const [dh, dm] = digestTime.split(':').map(Number);
      const totalMinutes = dh * 60 + dm + bufferMinutes;
      const catchUpHours = Math.floor(totalMinutes / 60) % 24;
      return `${String(catchUpHours).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
    }

    it('wraps hours past midnight: "23:56" + 5min = "00:01"', () => {
      assert.equal(computeCatchUpTime('23:56', 5), '00:01');
    });

    it('does not produce "24:01" for late-night digest times', () => {
      const result = computeCatchUpTime('23:56', 5);
      assert.notEqual(result, '24:01');
      assert.ok(Number(result.split(':')[0]) < 24, 'hours must be 0-23');
    });

    it('handles normal case: "09:00" + 5min = "09:05"', () => {
      assert.equal(computeCatchUpTime('09:00', 5), '09:05');
    });

    it('handles exact midnight wrap: "23:55" + 5min = "00:00"', () => {
      assert.equal(computeCatchUpTime('23:55', 5), '00:00');
    });

    it('handles large buffer crossing midnight: "22:00" + 150min = "00:30"', () => {
      assert.equal(computeCatchUpTime('22:00', 150), '00:30');
    });

    it('pads single-digit hours and minutes', () => {
      assert.equal(computeCatchUpTime('01:02', 3), '01:05');
    });
  });
});
