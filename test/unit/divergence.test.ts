import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDivergenceTracker } from '../../src/knowledge/divergence.js';
import type { DivergenceEntry, Direction } from '../../src/knowledge/divergence.js';
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
 * Build a mock pool whose query() returns rows via queryHandler.
 * All queries are recorded in `calls`.
 */
function makeMockPool(queryHandler: (sql: string, params?: unknown[]) => MockQueryResult): {
  pool: Pool;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];

  const pool = {
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: params ?? [] });
        return queryHandler(sql, params);
      },
      release: () => {},
    }),
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return queryHandler(sql, params);
    },
  };

  return { pool: pool as unknown as Pool, calls };
}

// ── 1. getDivergence ────────────────────────────────────────────────────

describe('getDivergence', () => {
  it('returns empty array when no mentions exist', async () => {
    const { pool } = makeMockPool(() => ({ rows: [] }));
    const tracker = createDivergenceTracker(pool, logger);
    const result = await tracker.getDivergence(0, Date.now());
    assert.deepEqual(result, []);
  });

  it('returns entries with correct divergence calculation (|eng_avg - ind_avg|)', async () => {
    const { pool } = makeMockPool(() => ({
      rows: [
        {
          entity_id: 'ent-btc',
          entity_name: 'Bitcoin',
          eng_sentiment: 0.8,
          eng_mentions: 10,
          ind_sentiment: 0.2,
          ind_mentions: 8,
          divergence: 0.6, // |0.8 - 0.2|
        },
      ],
    }));

    const tracker = createDivergenceTracker(pool, logger);
    const result = await tracker.getDivergence(0, Date.now());

    assert.equal(result.length, 1);
    assert.equal(result[0].entityId, 'ent-btc');
    assert.equal(result[0].entityName, 'Bitcoin');
    assert.ok(Math.abs(result[0].divergence - 0.6) < 0.01, `Expected divergence ~0.6, got ${result[0].divergence}`);
    assert.equal(result[0].engSentiment, 0.8);
    assert.equal(result[0].indSentiment, 0.2);
  });

  it('filters out entities with < minMentions per language', async () => {
    // The SQL HAVING clause does this filtering, so we verify the query
    // passes minMentions to getRegionalDivergence correctly.
    const { pool, calls } = makeMockPool(() => ({ rows: [] }));
    const tracker = createDivergenceTracker(pool, logger);

    await tracker.getDivergence(1000, 2000, 5);

    // getRegionalDivergence passes minMentions as $3 parameter
    const queryCall = calls.find((c) => c.sql.includes('HAVING'));
    assert.ok(queryCall, 'Should issue a query with HAVING clause');
    assert.ok(
      queryCall.params.includes(5),
      `Params should include minMentions=5, got ${JSON.stringify(queryCall.params)}`,
    );
  });

  it('only returns entities with divergence > 0.3 (via SQL WHERE clause)', async () => {
    const { pool, calls } = makeMockPool(() => ({ rows: [] }));
    const tracker = createDivergenceTracker(pool, logger);

    await tracker.getDivergence(1000, 2000);

    const queryCall = calls.find((c) => c.sql.includes('ABS'));
    assert.ok(queryCall, 'Should issue a query using ABS()');
    assert.ok(queryCall.sql.includes('> 0.3'), 'Query must filter divergence > 0.3');
  });

  it('correctly classifies direction: eng-bullish when eng > ind', async () => {
    const { pool } = makeMockPool(() => ({
      rows: [
        {
          entity_id: 'ent-1',
          entity_name: 'TokenA',
          eng_sentiment: 0.7,
          eng_mentions: 5,
          ind_sentiment: 0.2,
          ind_mentions: 5,
          divergence: 0.5,
        },
      ],
    }));

    const tracker = createDivergenceTracker(pool, logger);
    const result = await tracker.getDivergence(0, Date.now());

    assert.equal(result[0].direction, 'eng-bullish');
  });

  it('correctly classifies direction: ind-bullish when ind > eng', async () => {
    const { pool } = makeMockPool(() => ({
      rows: [
        {
          entity_id: 'ent-2',
          entity_name: 'TokenB',
          eng_sentiment: 0.2,
          eng_mentions: 5,
          ind_sentiment: 0.7,
          ind_mentions: 5,
          divergence: 0.5,
        },
      ],
    }));

    const tracker = createDivergenceTracker(pool, logger);
    const result = await tracker.getDivergence(0, Date.now());

    assert.equal(result[0].direction, 'ind-bullish');
  });
});

// ── 2. Direction classification ─────────────────────────────────────────

describe('Direction classification', () => {
  // Re-implement classifyDirection locally for unit-level testing since the
  // source does not export it. This validates our understanding of the logic.
  function classifyDirection(engSentiment: number, indSentiment: number): Direction {
    const diff = engSentiment - indSentiment;
    if (diff >= 0.3) return 'eng-bullish';
    if (diff <= -0.3) return 'ind-bullish';
    return 'aligned';
  }

  it('eng=0.7, ind=0.2 → eng-bullish', () => {
    assert.equal(classifyDirection(0.7, 0.2), 'eng-bullish');
  });

  it('eng=0.2, ind=0.7 → ind-bullish', () => {
    assert.equal(classifyDirection(0.2, 0.7), 'ind-bullish');
  });

  it('eng=0.5, ind=0.5 → aligned (divergence < 0.3, should not appear in results)', () => {
    // When sentiments are equal, divergence = 0 which is < 0.3,
    // so this entity would be filtered out by the SQL WHERE clause.
    // The direction classifier returns 'aligned' for completeness.
    assert.equal(classifyDirection(0.5, 0.5), 'aligned');
  });

  it('boundary: eng=0.6, ind=0.3 → eng-bullish (diff exactly 0.3)', () => {
    assert.equal(classifyDirection(0.6, 0.3), 'eng-bullish');
  });

  it('boundary: eng=0.3, ind=0.6 → ind-bullish (diff exactly -0.3)', () => {
    assert.equal(classifyDirection(0.3, 0.6), 'ind-bullish');
  });

  it('boundary: eng=0.5, ind=0.21 → aligned (diff=0.29 < 0.3)', () => {
    assert.equal(classifyDirection(0.5, 0.21), 'aligned');
  });

  it('extreme: eng=1.0, ind=-1.0 → eng-bullish', () => {
    assert.equal(classifyDirection(1.0, -1.0), 'eng-bullish');
  });

  it('extreme: eng=-1.0, ind=1.0 → ind-bullish', () => {
    assert.equal(classifyDirection(-1.0, 1.0), 'ind-bullish');
  });
});

// ── 3. Integration with entity_mentions language column ─────────────────

describe('Integration with entity_mentions language column', () => {
  it('query includes language grouping (GROUP BY language)', async () => {
    const { pool, calls } = makeMockPool(() => ({ rows: [] }));
    const tracker = createDivergenceTracker(pool, logger);

    await tracker.getDivergence(0, Date.now());

    const queryCall = calls.find((c) => c.sql.includes('entity_mentions'));
    assert.ok(queryCall, 'Should query entity_mentions');
    assert.ok(queryCall.sql.includes('em.language'), 'Query should reference em.language for grouping');
    assert.ok(queryCall.sql.includes('GROUP BY'), 'Query should GROUP BY to aggregate per language');
  });

  it('query excludes NULL language rows via IN clause', async () => {
    const { pool, calls } = makeMockPool(() => ({ rows: [] }));
    const tracker = createDivergenceTracker(pool, logger);

    await tracker.getDivergence(0, Date.now());

    const queryCall = calls.find((c) => c.sql.includes('entity_mentions'));
    assert.ok(queryCall, 'Should query entity_mentions');
    assert.ok(
      queryCall.sql.includes("IN ('eng', 'ind')"),
      'Query should filter language IN (eng, ind), implicitly excluding NULL',
    );
  });

  it('query filters NULL sentiment rows', async () => {
    const { pool, calls } = makeMockPool(() => ({ rows: [] }));
    const tracker = createDivergenceTracker(pool, logger);

    await tracker.getDivergence(0, Date.now());

    const queryCall = calls.find((c) => c.sql.includes('entity_mentions'));
    assert.ok(queryCall, 'Should query entity_mentions');
    assert.ok(queryCall.sql.includes('sentiment IS NOT NULL'), 'Query must exclude NULL sentiment rows');
  });

  it('passes startTime and endTime as query parameters', async () => {
    const { pool, calls } = makeMockPool(() => ({ rows: [] }));
    const tracker = createDivergenceTracker(pool, logger);

    const start = 1000;
    const end = 2000;
    await tracker.getDivergence(start, end);

    const queryCall = calls.find((c) => c.sql.includes('entity_mentions'));
    assert.ok(queryCall, 'Should query entity_mentions');
    assert.ok(queryCall.params.includes(start), `Params should include startTime=${start}`);
    assert.ok(queryCall.params.includes(end), `Params should include endTime=${end}`);
  });
});
