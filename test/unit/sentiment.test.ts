import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSentimentTracker } from '../../src/knowledge/sentiment.js';
import type { Trend, MomentumEntry } from '../../src/knowledge/sentiment.js';
import { computeDailySentiment } from '../../src/db/queries.js';

// ── Stubs ───────────────────────────────────────────────────────────────

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  child: () => noopLog,
} as any;

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
function makeMockPool(queryHandler: (sql: string, params?: unknown[]) => { rows: any[]; rowCount?: number }) {
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

  return { pool, calls };
}

// ── 1. Momentum calculation ─────────────────────────────────────────────

describe('Momentum calculation (runDaily)', () => {
  it('computes negative momentum when recent sentiment < prior average', async () => {
    // Scenario: today's avg = 0.3, 2 prior recent days stored with sum=0.6 (avg 0.3 each)
    // recentAvg = (0.6 + 0.3) / (2 + 1) = 0.3
    // priorAvg = 0.6
    // momentum = 0.3 - 0.6 = -0.3
    let windowCallCount = 0;
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-1', avg_sentiment: 0.3, mention_count: '10' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // Recent window: 2 stored days, sum_sentiment=0.6
        return { rows: [{ sum_sentiment: 0.6, day_count: '2' }] };
      }
      if (sql.includes('AVG(avg_sentiment)') && sql.includes('entity_sentiment_daily')) {
        // Prior window: avg of prior 7 days
        return { rows: [{ avg_sentiment: 0.6 }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.runDaily('2025-04-01');

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.ok(upsertCall, 'Should have called UPSERT on entity_sentiment_daily');

    // Params: [entity_id, date, avg_sentiment, mention_count, momentum]
    const momentum = upsertCall.params[4] as number;
    assert.ok(momentum !== null, 'Momentum should not be null');
    assert.ok(
      Math.abs(momentum - (-0.3)) < 0.01,
      `Expected momentum ~-0.3, got ${momentum}`,
    );
  });

  it('returns null momentum when no prior history exists', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-new', avg_sentiment: 0.5, mention_count: '3' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // Recent window: no prior rows stored
        return { rows: [{ sum_sentiment: null, day_count: '0' }] };
      }
      if (sql.includes('AVG(avg_sentiment)') && sql.includes('entity_sentiment_daily')) {
        // Prior window: no history
        return { rows: [{ avg_sentiment: null }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.runDaily('2025-04-01');

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.ok(upsertCall, 'Should have called UPSERT');

    const momentum = upsertCall.params[4];
    assert.equal(momentum, null, 'Momentum should be null with no prior data');
  });

  it('computes ~0 momentum when recent and prior averages are equal', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-flat', avg_sentiment: 0.5, mention_count: '7' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // Recent window: 2 stored days with avg 0.5 each => sum=1.0
        // Blend: (1.0 + 0.5) / (2 + 1) = 0.5
        return { rows: [{ sum_sentiment: 1.0, day_count: '2' }] };
      }
      if (sql.includes('AVG(avg_sentiment)') && sql.includes('entity_sentiment_daily')) {
        // Prior window avg = 0.5 too
        return { rows: [{ avg_sentiment: 0.5 }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.runDaily('2025-04-01');

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.ok(upsertCall, 'Should have called UPSERT');

    const momentum = upsertCall.params[4] as number;
    assert.ok(momentum !== null, 'Momentum should not be null');
    assert.ok(
      Math.abs(momentum) < 0.01,
      `Expected momentum ~0, got ${momentum}`,
    );
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
  function classifyTrend(
    momentum: number | null,
    yesterdayMomentum: number | null,
  ): Trend {
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
  it('calls entity_mentions aggregation with the correct date', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('FROM entity_mentions')) {
        return { rows: [] }; // no mentions today
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.runDaily('2025-04-01');

    const aggCall = calls.find((c) => c.sql.includes('FROM entity_mentions'));
    assert.ok(aggCall, 'Should query entity_mentions for aggregation');
    assert.equal(aggCall.params[0], '2025-04-01', 'Should pass date parameter');
  });

  it('excludes entities with NULL sentiment via WHERE clause', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('FROM entity_mentions')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.runDaily('2025-04-01');

    const aggCall = calls.find((c) => c.sql.includes('FROM entity_mentions'));
    assert.ok(aggCall, 'Should query entity_mentions');
    assert.ok(
      aggCall.sql.includes('sentiment IS NOT NULL'),
      'Aggregation query must filter out NULL sentiment rows',
    );
  });

  it('calls UPSERT with correct parameters for each entity', async () => {
    const { pool, calls } = makeMockPool((sql) => {
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
        return { rows: [{ sum_sentiment: null, day_count: '0' }] };
      }
      if (sql.includes('AVG(avg_sentiment)') && sql.includes('entity_sentiment_daily')) {
        return { rows: [{ avg_sentiment: null }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.runDaily('2025-04-01');

    const upsertCalls = calls.filter((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.equal(upsertCalls.length, 2, 'Should UPSERT once per entity');

    // First entity: ent-btc
    assert.equal(upsertCalls[0].params[0], 'ent-btc');
    assert.equal(upsertCalls[0].params[1], '2025-04-01');
    assert.equal(upsertCalls[0].params[2], 0.4); // avg_sentiment
    assert.equal(upsertCalls[0].params[3], 12);   // mention_count (parsed from string)

    // Second entity: ent-eth
    assert.equal(upsertCalls[1].params[0], 'ent-eth');
    assert.equal(upsertCalls[1].params[1], '2025-04-01');
    assert.equal(upsertCalls[1].params[2], -0.2);
    assert.equal(upsertCalls[1].params[3], 5);
  });

  it('UPSERT query uses ON CONFLICT for idempotent writes', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-1', avg_sentiment: 0.5, mention_count: '3' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        return { rows: [{ sum_sentiment: null, day_count: '0' }] };
      }
      if (sql.includes('AVG(avg_sentiment)') && sql.includes('entity_sentiment_daily')) {
        return { rows: [{ avg_sentiment: null }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.runDaily('2025-04-01');

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.ok(upsertCall, 'Should find UPSERT query');
    assert.ok(
      upsertCall.sql.includes('ON CONFLICT'),
      'UPSERT should use ON CONFLICT clause',
    );
    assert.ok(
      upsertCall.sql.includes('DO UPDATE'),
      'UPSERT should use DO UPDATE on conflict',
    );
  });

  it('skips processing when no mentions have sentiment today', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('FROM entity_mentions')) {
        return { rows: [] }; // no rows
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.runDaily('2025-04-01');

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
    const tracker = createSentimentTracker(pool as any, noopLog);
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

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.getMomentumContext(entityIds);

    const mainQuery = calls.find((c) => c.sql.includes('DISTINCT ON'));
    assert.ok(mainQuery, 'Should query entity_sentiment_daily');
    assert.deepEqual(mainQuery.params[0], entityIds, 'Should pass entity IDs as first param');
  });

  it('returns correct MomentumEntry with trend labels', async () => {
    let queryCount = 0;
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
      if (sql.includes('INTERVAL') || sql.includes('unnest')) {
        return {
          rows: [
            { entity_id: 'ent-sol', momentum: -0.3 }, // big reversal: 0.05 vs -0.3
          ],
        };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
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
      if (sql.includes('INTERVAL') || sql.includes('unnest')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
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
      if (sql.includes('INTERVAL') || sql.includes('unnest')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
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

    const tracker = createSentimentTracker(pool as any, noopLog);
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
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-x', avg_sentiment: 0.8, mention_count: '5' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // 2 stored prior days: 0.5 + 0.3 = 0.8
        return { rows: [{ sum_sentiment: 0.8, day_count: '2' }] };
      }
      if (sql.includes('AVG(avg_sentiment)') && sql.includes('entity_sentiment_daily')) {
        // Prior window: not relevant for this test's assertion, use 0
        return { rows: [{ avg_sentiment: 0.0 }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.runDaily('2025-04-01');

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
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-y', avg_sentiment: 0.7, mention_count: '3' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // No stored recent days
        return { rows: [{ sum_sentiment: null, day_count: '0' }] };
      }
      if (sql.includes('AVG(avg_sentiment)') && sql.includes('entity_sentiment_daily')) {
        // Prior window has data so momentum is computable
        return { rows: [{ avg_sentiment: 0.3 }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.runDaily('2025-04-01');

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
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-z', avg_sentiment: 0.6, mention_count: '4' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        // 1 stored prior day with avg_sentiment = 0.4
        return { rows: [{ sum_sentiment: 0.4, day_count: '1' }] };
      }
      if (sql.includes('AVG(avg_sentiment)') && sql.includes('entity_sentiment_daily')) {
        return { rows: [{ avg_sentiment: 0.2 }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.runDaily('2025-04-01');

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO entity_sentiment_daily'));
    assert.ok(upsertCall, 'Should have called UPSERT');

    // recentAvg = (0.4 + 0.6) / (1 + 1) = 0.5
    // momentum = 0.5 - 0.2 = 0.3
    const momentum = upsertCall.params[4] as number;
    assert.ok(
      Math.abs(momentum - 0.3) < 0.001,
      `Expected momentum 0.3, got ${momentum}`,
    );
  });

  it('queries use SUM/COUNT, not AVG, for the recent window', async () => {
    const { pool, calls } = makeMockPool((sql) => {
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: [{ entity_id: 'ent-1', avg_sentiment: 0.5, mention_count: '2' }],
        };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SUM(avg_sentiment)')) {
        return { rows: [{ sum_sentiment: null, day_count: '0' }] };
      }
      if (sql.includes('AVG(avg_sentiment)') && sql.includes('entity_sentiment_daily')) {
        return { rows: [{ avg_sentiment: null }] };
      }
      if (sql.includes('INSERT INTO entity_sentiment_daily')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const tracker = createSentimentTracker(pool as any, noopLog);
    await tracker.runDaily('2025-04-01');

    // Verify the recent window query uses SUM, not AVG
    const recentWindowCall = calls.find(
      (c) => c.sql.includes('SUM(avg_sentiment)') && c.sql.includes('COUNT(*)'),
    );
    assert.ok(
      recentWindowCall,
      'Recent window query must use SUM(avg_sentiment) and COUNT(*), not AVG',
    );
  });
});

// ── 6. CF-004 regression: computeDailySentiment epoch bounds ────────────

describe('CF-004: computeDailySentiment epoch-ms bounds', () => {
  it('converts date string to correct epoch-ms range bounds', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const mockPool = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: params ?? [] });
        return { rows: [] };
      },
    };

    await computeDailySentiment(mockPool as any, '2025-04-01');

    assert.equal(calls.length, 1, 'Should issue exactly one query');
    const [dayStart, dayEnd] = calls[0].params as [number, number];

    // 2025-04-01T00:00:00Z in epoch-ms
    const expectedStart = new Date('2025-04-01T00:00:00Z').getTime();
    const expectedEnd = expectedStart + 86_400_000;

    assert.equal(dayStart, expectedStart, `dayStart should be ${expectedStart}, got ${dayStart}`);
    assert.equal(dayEnd, expectedEnd, `dayEnd should be ${expectedEnd}, got ${dayEnd}`);
  });

  it('bounds span exactly 24 hours (86400000 ms)', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const mockPool = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: params ?? [] });
        return { rows: [] };
      },
    };

    await computeDailySentiment(mockPool as any, '2025-04-01');

    const [dayStart, dayEnd] = calls[0].params as [number, number];
    assert.equal(
      dayEnd - dayStart,
      86_400_000,
      `Bounds must span exactly 86400000 ms (24h), got ${dayEnd - dayStart}`,
    );
  });

  it('uses >= for start and < for end (half-open interval)', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const mockPool = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: params ?? [] });
        return { rows: [] };
      },
    };

    await computeDailySentiment(mockPool as any, '2025-04-01');

    const sql = calls[0].sql;
    assert.ok(
      sql.includes('created_at >= $1') && sql.includes('created_at < $2'),
      'Query must use >= $1 AND < $2 for half-open interval (no off-by-one at midnight)',
    );
  });

  it('passes epoch-ms numbers, not date strings, to the query', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const mockPool = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: params ?? [] });
        return { rows: [] };
      },
    };

    await computeDailySentiment(mockPool as any, '2025-12-31');

    const [dayStart, dayEnd] = calls[0].params as [unknown, unknown];
    assert.equal(typeof dayStart, 'number', 'dayStart must be a number (epoch-ms)');
    assert.equal(typeof dayEnd, 'number', 'dayEnd must be a number (epoch-ms)');

    // Verify they are plausible epoch-ms values (> year 2000 in ms)
    assert.ok((dayStart as number) > 946684800000, 'dayStart should be a plausible epoch-ms value');
  });

  it('does not use to_timestamp() — epoch-ms compared directly', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const mockPool = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: params ?? [] });
        return { rows: [] };
      },
    };

    await computeDailySentiment(mockPool as any, '2025-04-01');

    const sql = calls[0].sql;
    assert.ok(
      !sql.includes('to_timestamp'),
      'Query must NOT use to_timestamp() — created_at is already epoch-ms, compare directly',
    );
  });
});
