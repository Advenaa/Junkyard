/**
 * Cycle-99 behavior regression tests for the EM-023 fix in embed.ts.
 *
 * EM-023 follow-up: embedBatch must hard-fail when Gemini returns a batch
 * count or dimension mismatch so callers never receive silently misaligned
 * embeddings or record usage for a failed batch.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createEmbedder } from '../../src/embed.js';

function makeLogger() {
  const noop = () => {};
  return {
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    debug: noop,
    trace: noop,
    child: () => makeLogger(),
  };
}

function makePool() {
  let countQueryCalls = 0;
  let insertQueryCalls = 0;
  let totalQueryCalls = 0;

  return {
    pool: {
      query: async (sql: string) => {
        totalQueryCalls += 1;

        if (sql.includes('SELECT COUNT(*) as count FROM llm_usage')) {
          countQueryCalls += 1;
          return { rows: [{ count: '0' }], rowCount: 1 };
        }

        if (sql.includes('INSERT INTO llm_usage')) {
          insertQueryCalls += 1;
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`unexpected query: ${sql}`);
      },
    },
    getQueryCounts() {
      return {
        countQueryCalls,
        insertQueryCalls,
        totalQueryCalls,
      };
    },
  };
}

function makeValues(dimensions = 768, value = 0): number[] {
  return new Array<number>(dimensions).fill(value);
}

describe('EM-023 — embedBatch rejects length and dimension mismatches', () => {
  it('throws on length mismatch and does not record llm usage', async (t) => {
    let batchCalls = 0;

    t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
      embedContent: async () => ({ embedding: { values: makeValues() } }),
      batchEmbedContents: async () => {
        batchCalls += 1;
        return {
          embeddings: [{ values: makeValues() }, { values: makeValues() }],
        };
      },
    }));

    const { pool, getQueryCounts } = makePool();
    const embedder = createEmbedder(
      { geminiApiKey: 'test-gemini-key', googleApiKey: null } as never,
      pool as never,
      makeLogger() as never,
    );

    await assert.rejects(embedder.embedBatch(['a', 'b', 'c']), /expected 3 embeddings but got 2/);

    assert.equal(batchCalls, 1, 'embedBatch should make one Gemini batch request');
    assert.deepEqual(getQueryCounts(), {
      countQueryCalls: 1,
      insertQueryCalls: 0,
      totalQueryCalls: 1,
    });
  });

  it('throws on dimension mismatch', async (t) => {
    let batchCalls = 0;

    t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
      embedContent: async () => ({ embedding: { values: makeValues() } }),
      batchEmbedContents: async () => {
        batchCalls += 1;
        return {
          embeddings: [{ values: makeValues(512) }, { values: makeValues(512) }],
        };
      },
    }));

    const { pool, getQueryCounts } = makePool();
    const embedder = createEmbedder(
      { geminiApiKey: 'test-gemini-key', googleApiKey: null } as never,
      pool as never,
      makeLogger() as never,
    );

    await assert.rejects(embedder.embedBatch(['a', 'b']), /expected 768 dimensions but got 512/);

    assert.equal(batchCalls, 1, 'embedBatch should make one Gemini batch request');
    assert.deepEqual(getQueryCounts(), {
      countQueryCalls: 1,
      insertQueryCalls: 0,
      totalQueryCalls: 1,
    });
  });

  it('returns one embedding result per input on the happy path', async (t) => {
    let batchCalls = 0;
    let requestCount = 0;

    t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
      embedContent: async () => ({ embedding: { values: makeValues() } }),
      batchEmbedContents: async ({ requests }: { requests: unknown[] }) => {
        batchCalls += 1;
        requestCount = requests.length;
        return {
          embeddings: [{ values: makeValues(768, 1) }, { values: makeValues(768, 2) }, { values: makeValues(768, 3) }],
        };
      },
    }));

    const { pool, getQueryCounts } = makePool();
    const embedder = createEmbedder(
      { geminiApiKey: 'test-gemini-key', googleApiKey: null } as never,
      pool as never,
      makeLogger() as never,
    );

    const results = await embedder.embedBatch(['a', 'b', 'c']);

    assert.equal(batchCalls, 1, 'embedBatch should make one Gemini batch request');
    assert.equal(requestCount, 3, 'Gemini batch request should include every input');
    assert.equal(results.length, 3, 'embedBatch should return one result per input');
    for (const result of results) {
      assert.notEqual(result, null);
      assert.ok(result.vector instanceof Float32Array);
      assert.equal(result.vector.length, 768);
      assert.equal(result.dimensions, 768);
      assert.equal(result.model, 'text-embedding-004');
    }
    assert.deepEqual(getQueryCounts(), {
      countQueryCalls: 1,
      insertQueryCalls: 1,
      totalQueryCalls: 2,
    });
  });

  it('returns all nulls without calling Gemini or the DB when no API key is configured', async (t) => {
    let batchCalls = 0;

    t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
      embedContent: async () => ({ embedding: { values: makeValues() } }),
      batchEmbedContents: async () => {
        batchCalls += 1;
        return { embeddings: [] };
      },
    }));

    const { pool, getQueryCounts } = makePool();
    const embedder = createEmbedder(
      { geminiApiKey: null, googleApiKey: null } as never,
      pool as never,
      makeLogger() as never,
    );

    const results = await embedder.embedBatch(['a', 'b']);

    assert.deepEqual(results, [null, null]);
    assert.equal(batchCalls, 0, 'embedBatch should not call Gemini when no API key is configured');
    assert.deepEqual(getQueryCounts(), {
      countQueryCalls: 0,
      insertQueryCalls: 0,
      totalQueryCalls: 0,
    });
  });
});
