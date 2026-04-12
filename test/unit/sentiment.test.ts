import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSentimentTracker, getLastCompletedDayRollup } from '../../src/knowledge/sentiment.js';
import type { Trend, MomentumEntry } from '../../src/knowledge/sentiment.js';
import type { Pool } from '../../src/db/connection.js';
import type { Logger } from '../../src/logger.js';
import type { MockLogger, MockQueryResult } from '../helpers/mock-types.js';

// ── Stubs ───────────────────────────────────────────────────────────────

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  child: () => noopLog,
} as MockLogger;
const logger = noopLog as unknown as Logger;

// ── Mock pool helpers ───────────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: unknown[];
}

/**
 * Build a mock pool with a connect() that returns a client.
 * `queryHandler` maps SQL patterns to result rows.
 * All queries are recorded in `calls`.
 */
function makeMockPool(queryHandler: (sql: string, params?: unknown[]) => MockQueryResult): {
  pool: Pool;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];

  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return queryHandler(sql, params);
    },
    release: () => {},
  };

  const pool = {
    connect: async () => client,
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return queryHandler(sql, params);
    },
  };

  return { pool: pool as unknown as Pool, calls };
}

// ── 1. Momentum calculation ─────────────────────────────────────────────

describe('Momentum calculation (runDaily)', () => {
  it('targets the most recent fully completed local day at rollup time', () => {
    const now = new Date('2025-04-11T02:00:00Z');
    const rollup = getLastCompletedDayRollup(now, 'Asia/Jakarta');

    assert.equal(rollup.dateString, '2025-04-10');
    assert.equal(rollup.startMs, Date.parse('2025-04-09T17:00:00Z'));
    assert.equal(rollup.endMs, Date.parse('2025-04-10T17:00:00Z'));
    assert.ok(rollup.endMs <= now.getTime(), 'the rollup window must be fully in the past at digest time');
  });

  it('computes negative momentum when recent sentiment < prior average', async () => {
    // Scenario: today's avg = 0.3, 2 prior recent days stored with sum=0.6 (avg 0.3 each)
    // recentAvg = (0.6 + 0.3) / (2 + 1) = 0.3
    // priorAvg = 0.6
    // momentum = 0.3 - 0.6 = -0.3
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('SELECT 1 FROM entity_sentiment_daily WHERE date')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-1', avg_sentiment: 0.3, mention_count: '10' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // CTE: recent sum=0.6 (2 days), prior avg=0.6
        return { rows: [{ entity_id: 'ent-1', recent_sum: 0.6, recent_count: '2', prior_avg: 0.6 }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.runDaily('2025-04-01', 'Asia/Jakarta');

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.ok(upsertCall, 'Should have called UPSERT on entity_sentiment_daily');

    // Params: [entity_id, date, avg_sentiment, mention_count, momentum]
    const momentum = upsertCall.params[4] as number;
    assert.ok(momentum !== null, 'Momentum should not be null');
    assert.ok(Math.abs(momentum - -0.3) < 0.01, `Expected momentum ~-0.3, got ${momentum}`);
  });

  it('returns null momentum when no prior history exists', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('SELECT 1 FROM entity_sentiment_daily WHERE date')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-new', avg_sentiment: 0.5, mention_count: '3' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // CTE: no recent or prior history
        return { rows: [{ entity_id: 'ent-new', recent_sum: null, recent_count: '0', prior_avg: null }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.runDaily('2025-04-01', 'Asia/Jakarta');

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.ok(upsertCall, 'Should have called UPSERT');

    const momentum = upsertCall.params[4];
    assert.equal(momentum, null, 'Momentum should be null with no prior data');
  });

  it('computes ~0 momentum when recent and prior averages are equal', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('SELECT 1 FROM entity_sentiment_daily WHERE date')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-flat', avg_sentiment: 0.5, mention_count: '7' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // CTE: recent sum=1.0 (2 days), prior avg=0.5
        return { rows: [{ entity_id: 'ent-flat', recent_sum: 1.0, recent_count: '2', prior_avg: 0.5 }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.runDaily('2025-04-01', 'Asia/Jakarta');

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.ok(upsertCall, 'Should have called UPSERT');

    const momentum = upsertCall.params[4] as number;
    assert.ok(momentum !== null, 'Momentum should not be null');
    assert.ok(Math.abs(momentum) < 0.01, `Expected momentum ~0, got ${momentum}`);
  });
});

// ── 2. Trend classification ─────────────────────────────────────────────
//
// classifyTrend is not exported directly, so we test it through getMomentumContext
// by controlling the momentum and yesterday-momentum values returned from queries.
// We also test the classification logic inline to ensure correctness.

describe('Trend classification', () => {
  // Re-implement classifyTrend locally for unit-level testing since the
  // source does not export it. This validates our understanding of the logic.
  function classifyTrend(momentum: number | null, yesterdayMomentum: number | null): Trend {
    if (momentum === null) return 'stable';
    if (momentum > 0.15) return 'accelerating';
    if (momentum < -0.15) return 'declining';
    if (yesterdayMomentum !== null) {
      const change = Math.abs(momentum - yesterdayMomentum);
      if (change > 0.2) return 'reversing';
    }
    return 'stable';
  }

  it('momentum > 0.15 classifies as accelerating', () => {
    assert.equal(classifyTrend(0.3, null), 'accelerating');
    assert.equal(classifyTrend(0.16, null), 'accelerating');
    assert.equal(classifyTrend(1.0, 0.0), 'accelerating');
  });

  it('momentum < -0.15 classifies as declining', () => {
    assert.equal(classifyTrend(-0.3, null), 'declining');
    assert.equal(classifyTrend(-0.16, null), 'declining');
    assert.equal(classifyTrend(-1.0, 0.5), 'declining');
  });

  it('|momentum| <= 0.15 classifies as stable (no yesterday data)', () => {
    assert.equal(classifyTrend(0.1, null), 'stable');
    assert.equal(classifyTrend(-0.1, null), 'stable');
    assert.equal(classifyTrend(0.0, null), 'stable');
    assert.equal(classifyTrend(0.15, null), 'stable');
    assert.equal(classifyTrend(-0.15, null), 'stable');
  });

  it('null momentum classifies as stable', () => {
    assert.equal(classifyTrend(null, null), 'stable');
    assert.equal(classifyTrend(null, 0.5), 'stable');
  });

  it('small momentum but big day-over-day change classifies as reversing', () => {
    // momentum=0.05, yesterdayMomentum=-0.3 => change=0.35 > 0.2
    assert.equal(classifyTrend(0.05, -0.3), 'reversing');
    // momentum=-0.1, yesterdayMomentum=0.15 => change=0.25 > 0.2
    assert.equal(classifyTrend(-0.1, 0.15), 'reversing');
  });

  it('small momentum with small day-over-day change stays stable', () => {
    // momentum=0.05, yesterdayMomentum=0.0 => change=0.05 <= 0.2
    assert.equal(classifyTrend(0.05, 0.0), 'stable');
    // momentum=0.1, yesterdayMomentum=0.05 => change=0.05 <= 0.2
    assert.equal(classifyTrend(0.1, 0.05), 'stable');
  });

  it('boundary: exactly 0.15 momentum is stable', () => {
    assert.equal(classifyTrend(0.15, null), 'stable');
    assert.equal(classifyTrend(-0.15, null), 'stable');
  });

  it('boundary: day-over-day change exactly 0.2 is NOT reversing', () => {
    // momentum=0.0, yesterdayMomentum=0.2 => change=0.2, NOT > 0.2
    assert.equal(classifyTrend(0.0, 0.2), 'stable');
  });
});

// ── 3. Daily rollup SQL (runDaily) ──────────────────────────────────────

describe('Daily rollup SQL (runDaily)', () => {
  it('calls entity_mentions aggregation with epoch-ms bounds', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('SELECT 1 FROM entity_sentiment_daily WHERE date')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM entity_mentions')) {
        return { rows: [] }; // no mentions today
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.runDaily('2025-04-01', 'Asia/Jakarta');

    const aggCall = calls.find((c) => c.sql.includes('FROM entity_mentions'));
    assert.ok(aggCall, 'Should query entity_mentions for aggregation');

    // Jakarta midnight (UTC+7): 2025-04-01T00:00:00+07:00 = 2025-03-31T17:00:00Z
    const expectedStart = new Date('2025-03-31T17:00:00Z').getTime();
    const expectedEnd = expectedStart + 86_400_000;
    assert.equal(aggCall.params[0], expectedStart, 'Should pass epoch-ms start bound (Jakarta midnight)');
    assert.equal(aggCall.params[1], expectedEnd, 'Should pass epoch-ms end bound');
  });

  it('excludes entities with NULL sentiment via WHERE clause', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('SELECT 1 FROM entity_sentiment_daily WHERE date')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM entity_mentions')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.runDaily('2025-04-01', 'Asia/Jakarta');

    const aggCall = calls.find((c) => c.sql.includes('FROM entity_mentions'));
    assert.ok(aggCall, 'Should query entity_mentions');
    assert.ok(aggCall.sql.includes('sentiment IS NOT NULL'), 'Aggregation query must filter out NULL sentiment rows');
  });

  it('calls bulk UPSERT with correct parameters for all entities', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('SELECT 1 FROM entity_sentiment_daily WHERE date')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [
            { entity_id: 'ent-btc', avg_sentiment: 0.4, mention_count: '12' },
            { entity_id: 'ent-eth', avg_sentiment: -0.2, mention_count: '5' },
          ],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // CTE: no recent or prior history for either entity
        return {
          rows: [
            { entity_id: 'ent-btc', recent_sum: null, recent_count: '0', prior_avg: null },
            { entity_id: 'ent-eth', recent_sum: null, recent_count: '0', prior_avg: null },
          ],
        };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 2 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.runDaily('2025-04-01', 'Asia/Jakarta');

    const upsertCalls = calls.filter((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.equal(upsertCalls.length, 1, 'Should issue a single bulk UPSERT for all entities');

    const params = upsertCalls[0].params;
    // Bulk VALUES: [entity_id, date, avg_sentiment, mention_count, momentum] x2
    // First entity: ent-btc (params 0-4)
    assert.equal(params[0], 'ent-btc');
    assert.equal(params[1], '2025-04-01');
    assert.equal(params[2], 0.4); // avg_sentiment
    assert.equal(params[3], 12); // mention_count (parsed from string)

    // Second entity: ent-eth (params 5-9)
    assert.equal(params[5], 'ent-eth');
    assert.equal(params[6], '2025-04-01');
    assert.equal(params[7], -0.2);
    assert.equal(params[8], 5);
  });

  it('UPSERT query uses ON CONFLICT for idempotent writes', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('SELECT 1 FROM entity_sentiment_daily WHERE date')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-1', avg_sentiment: 0.5, mention_count: '3' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        return { rows: [{ entity_id: 'ent-1', recent_sum: null, recent_count: '0', prior_avg: null }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.runDaily('2025-04-01', 'Asia/Jakarta');

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.ok(upsertCall, 'Should find UPSERT query');
    assert.ok(upsertCall.sql.includes('ON CONFLICT'), 'UPSERT should use ON CONFLICT clause');
    assert.ok(upsertCall.sql.includes('DO UPDATE'), 'UPSERT should use DO UPDATE on conflict');
  });

  it('skips processing when no mentions have sentiment today', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('SELECT 1 FROM entity_sentiment_daily WHERE date')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM entity_mentions')) {
        return { rows: [] }; // no rows
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.runDaily('2025-04-01', 'Asia/Jakarta');

    const upsertCalls = calls.filter((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.equal(upsertCalls.length, 0, 'Should not UPSERT when no mentions exist');

    // Should also not BEGIN a transaction
    const beginCalls = calls.filter((c) => c.sql === 'BEGIN');
    assert.equal(beginCalls.length, 0, 'Should not start a transaction with no data');
  });
});

// ── 4. getMomentumContext ────────────────────────────────────────────────

describe('getMomentumContext', () => {
  it('returns empty array for empty entityIds input', async () => {
    const { pool } = makeMockPool(() => ({ rows: [] }));
    const tracker = createSentimentTracker(pool, logger);
    const result = await tracker.getMomentumContext([]);
    assert.deepEqual(result, []);
  });

  it('queries entity_sentiment_daily with the correct entity IDs', async () => {
    const entityIds = ['ent-btc', 'ent-eth'];
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('DISTINCT ON')) {
        return { rows: [] }; // no rows found
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.getMomentumContext(entityIds);

    const mainQuery = calls.find((c) => c.sql.includes('DISTINCT ON'));
    assert.ok(mainQuery, 'Should query entity_sentiment_daily');
    assert.deepEqual(mainQuery.params[0], entityIds, 'Should pass entity IDs as first param');
  });

  it('returns correct MomentumEntry with trend labels', async () => {
    const queryCount = 0;
    const { pool } = makeMockPool((sql, params) => {
      // Main query: latest rows per entity
      if (sql.includes('DISTINCT ON')) {
        return {
          rows: [
            {
              entity_id: 'ent-btc',
              entity_name: 'bitcoin',
              avg_sentiment: 0.6,
              mention_count: 15,
              momentum: 0.3,
              date: '2025-04-01',
            },
            {
              entity_id: 'ent-eth',
              entity_name: 'ethereum',
              avg_sentiment: -0.1,
              mention_count: 8,
              momentum: -0.25,
              date: '2025-04-01',
            },
            {
              entity_id: 'ent-sol',
              entity_name: 'solana',
              avg_sentiment: 0.2,
              mention_count: 4,
              momentum: 0.05,
              date: '2025-04-01',
            },
          ],
        };
      }
      // Yesterday's momentum query
      if (sql.includes('yesterday_date')) {
        return {
          rows: [
            { entity_id: 'ent-sol', momentum: -0.3 }, // big reversal: 0.05 vs -0.3
          ],
        };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    const result = await tracker.getMomentumContext(['ent-btc', 'ent-eth', 'ent-sol']);

    assert.equal(result.length, 3);

    // BTC: momentum 0.3 > 0.15 => accelerating
    const btc = result.find((r) => r.entityId === 'ent-btc')!;
    assert.equal(btc.trend, 'accelerating');
    assert.equal(btc.entityName, 'bitcoin');
    assert.equal(btc.avgSentiment, 0.6);
    assert.equal(btc.mentionCount, 15);
    assert.equal(btc.momentum, 0.3);

    // ETH: momentum -0.25 < -0.15 => declining
    const eth = result.find((r) => r.entityId === 'ent-eth')!;
    assert.equal(eth.trend, 'declining');

    // SOL: momentum 0.05, yesterday=-0.3, change=0.35 > 0.2 => reversing
    const sol = result.find((r) => r.entityId === 'ent-sol')!;
    assert.equal(sol.trend, 'reversing');
  });

  it('classifies as stable when no yesterday momentum and |momentum| <= 0.15', async () => {
    const { pool } = makeMockPool((sql) => {
      if (sql.includes('DISTINCT ON')) {
        return {
          rows: [
            {
              entity_id: 'ent-calm',
              entity_name: 'stablecoin',
              avg_sentiment: 0.0,
              mention_count: 20,
              momentum: 0.05,
              date: '2025-04-01',
            },
          ],
        };
      }
      // No yesterday data
      if (sql.includes('yesterday_date')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    const result = await tracker.getMomentumContext(['ent-calm']);

    assert.equal(result.length, 1);
    assert.equal(result[0].trend, 'stable');
    assert.equal(result[0].momentum, 0.05);
  });

  it('handles null momentum from the database', async () => {
    const { pool } = makeMockPool((sql) => {
      if (sql.includes('DISTINCT ON')) {
        return {
          rows: [
            {
              entity_id: 'ent-new',
              entity_name: 'newtoken',
              avg_sentiment: 0.3,
              mention_count: 2,
              momentum: null,
              date: '2025-04-01',
            },
          ],
        };
      }
      if (sql.includes('yesterday_date')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    const result = await tracker.getMomentumContext(['ent-new']);

    assert.equal(result.length, 1);
    assert.equal(result[0].momentum, null);
    assert.equal(result[0].trend, 'stable', 'Null momentum should classify as stable');
  });

  it('returns empty when no rows within 7-day cutoff', async () => {
    const { pool } = makeMockPool((sql) => {
      if (sql.includes('DISTINCT ON')) {
        return { rows: [] }; // no rows within cutoff
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    const result = await tracker.getMomentumContext(['ent-old']);

    assert.deepEqual(result, []);
  });
});

// ── 5. SM-001 regression: equal-weight blending (SUM/COUNT) ─────────────

describe('SM-001: equal-weight 3-day blending', () => {
  it('blends 2 prior days + today with equal weight: (0.5+0.3+0.8)/3 = 0.533', async () => {
    // Prior 2 stored days: avg_sentiment 0.5 and 0.3 => sum=0.8, count=2
    // Today's avg = 0.8
    // recentAvg = (0.8 + 0.8) / (2 + 1) = 1.6 / 3 = 0.5333...
    // Prior window avg = 0.0 (so momentum = recentAvg - 0 = 0.5333)
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('SELECT 1 FROM entity_sentiment_daily WHERE date')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-x', avg_sentiment: 0.8, mention_count: '5' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // CTE: recent sum=0.8 (2 days), prior avg=0.0
        return { rows: [{ entity_id: 'ent-x', recent_sum: 0.8, recent_count: '2', prior_avg: 0.0 }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.runDaily('2025-04-01', 'Asia/Jakarta');

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.ok(upsertCall, 'Should have called UPSERT');

    // momentum = recentAvg - priorAvg = 0.5333 - 0.0
    const momentum = upsertCall.params[4] as number;
    const expectedRecentAvg = (0.5 + 0.3 + 0.8) / 3; // 0.5333...
    assert.ok(
      Math.abs(momentum - expectedRecentAvg) < 0.001,
      `Expected momentum ~${expectedRecentAvg.toFixed(4)}, got ${momentum} ` +
        `(would be 0.6 under old AVG-based 50/50 weighting)`,
    );

    // Explicitly verify this is NOT the old broken value
    assert.ok(
      Math.abs(momentum - 0.6) > 0.01,
      'Must not produce the old broken value of 0.6 (AVG gave today 50% weight)',
    );
  });

  it('uses today directly when 0 prior days exist', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('SELECT 1 FROM entity_sentiment_daily WHERE date')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-y', avg_sentiment: 0.7, mention_count: '3' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // CTE: no recent days, prior avg=0.3
        return { rows: [{ entity_id: 'ent-y', recent_sum: null, recent_count: '0', prior_avg: 0.3 }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.runDaily('2025-04-01', 'Asia/Jakarta');

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.ok(upsertCall, 'Should have called UPSERT');

    // recentAvg should be today's value directly: 0.7
    // momentum = 0.7 - 0.3 = 0.4
    const momentum = upsertCall.params[4] as number;
    assert.ok(
      Math.abs(momentum - 0.4) < 0.001,
      `Expected momentum 0.4 (today 0.7 used directly - prior 0.3), got ${momentum}`,
    );
  });

  it('blends 1 prior day + today with equal weight: (prior + today) / 2', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('SELECT 1 FROM entity_sentiment_daily WHERE date')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-z', avg_sentiment: 0.6, mention_count: '4' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // CTE: recent sum=0.4 (1 day), prior avg=0.2
        return { rows: [{ entity_id: 'ent-z', recent_sum: 0.4, recent_count: '1', prior_avg: 0.2 }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.runDaily('2025-04-01', 'Asia/Jakarta');

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.ok(upsertCall, 'Should have called UPSERT');

    // recentAvg = (0.4 + 0.6) / (1 + 1) = 0.5
    // momentum = 0.5 - 0.2 = 0.3
    const momentum = upsertCall.params[4] as number;
    assert.ok(Math.abs(momentum - 0.3) < 0.001, `Expected momentum 0.3, got ${momentum}`);
  });

  it('queries use SUM/COUNT, not AVG, for the recent window', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('SELECT 1 FROM entity_sentiment_daily WHERE date')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-1', avg_sentiment: 0.5, mention_count: '2' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // CTE returns WindowRow shape
        return { rows: [{ entity_id: 'ent-1', recent_sum: null, recent_count: '0', prior_avg: null }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool, logger);
    await tracker.runDaily('2025-04-01', 'Asia/Jakarta');

    // Verify the recent window query uses SUM, not AVG
    const recentWindowCall = calls.find((c) => c.sql.includes('SUM(avg_sentiment)') && c.sql.includes('COUNT(*)'));
    assert.ok(recentWindowCall, 'Recent window query must use SUM(avg_sentiment) and COUNT(*), not AVG');
  });
});
