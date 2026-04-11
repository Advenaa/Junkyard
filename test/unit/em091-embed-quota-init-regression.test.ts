import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createEmbedder, DAILY_QUOTA_LIMIT } from '../../src/embed.js';

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

describe('EM-091 — embedding quota restore fail-closed', () => {
  it('uses a single quota restore query for concurrent embed calls', async (t) => {
    let embedCalls = 0;
    t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
      embedContent: async () => {
        embedCalls += 1;
        return { embedding: { values: new Array<number>(768).fill(0) } };
      },
      batchEmbedContents: async () => ({ embeddings: [] }),
    }));

    let countQueryCalls = 0;
    let insertQueryCalls = 0;
    let resolveCountQuery!: (value: { rows: { count: string }[] }) => void;
    const countQuery = new Promise<{ rows: { count: string }[] }>((resolve) => {
      resolveCountQuery = resolve;
    });

    const pool = {
      query: async (sql: string) => {
        if (sql.includes('SELECT COUNT(*) as count FROM llm_usage')) {
          countQueryCalls += 1;
          return countQuery;
        }
        if (sql.includes('INSERT INTO llm_usage')) {
          insertQueryCalls += 1;
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };

    const embedder = createEmbedder(
      { geminiApiKey: 'test-gemini-key', googleApiKey: null } as never,
      pool as never,
      makeLogger() as never,
    );

    const calls = [embedder.embed('first'), embedder.embed('second'), embedder.embed('third')];

    await Promise.resolve();

    assert.equal(countQueryCalls, 1, 'concurrent embeds should share one restore query');

    resolveCountQuery({ rows: [{ count: '500' }] });

    const results = await Promise.all(calls);

    assert.equal(countQueryCalls, 1, 'quota restore should only hit the DB once');
    assert.equal(insertQueryCalls, 3, 'each successful embed should still record usage');
    assert.equal(embedCalls, 3, 'all embed calls should proceed after the shared restore completes');
    for (const result of results) {
      assert.notEqual(result, null, 'shared restore should unblock each waiting embed');
    }
    assert.deepEqual(embedder.getQuotaState(), {
      dailyCount: 503,
      initialized: true,
    });
  });

  it('keeps init retryable and saturates dailyCount when the restore query throws', async (t) => {
    let embedCalls = 0;
    t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
      embedContent: async () => {
        embedCalls += 1;
        return { embedding: { values: new Array<number>(768).fill(0) } };
      },
      batchEmbedContents: async () => ({ embeddings: [] }),
    }));

    let queryCalls = 0;
    const pool = {
      query: async () => {
        queryCalls += 1;
        throw new Error('db temporarily unavailable');
      },
    };

    const embedder = createEmbedder(
      { geminiApiKey: 'test-gemini-key', googleApiKey: null } as never,
      pool as never,
      makeLogger() as never,
    );

    const first = await embedder.embed('first');
    const second = await embedder.embed('second');

    assert.equal(first, null, 'first embed call should fail closed when quota restore fails');
    assert.equal(second, null, 'second embed call should retry restore and still fail closed');
    assert.equal(queryCalls, 2, 'quota restore should retry on the next embed call');
    assert.equal(embedCalls, 0, 'quota exhaustion should block real Gemini requests');
    assert.deepEqual(embedder.getQuotaState(), {
      dailyCount: DAILY_QUOTA_LIMIT,
      initialized: false,
    });
  });
});
