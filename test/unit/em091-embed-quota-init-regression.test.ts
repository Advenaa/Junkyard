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
