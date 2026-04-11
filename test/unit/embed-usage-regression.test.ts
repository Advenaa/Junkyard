import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmbedder, type EmbedModel } from '../../src/embed.js';

const DIMENSIONS = 768;

function makeVectorValues(dimensions = DIMENSIONS): number[] {
  return Array.from({ length: dimensions }, (_, index) => index);
}

function makeLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    debug: () => {},
    trace: () => {},
    child() {
      return this;
    },
  };
}

describe('EM-033 — embedBatch usage logging', () => {
  it('records usage for completed requests when a later chunk fails after the API call returns', async () => {
    const queryCalls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
    const pool = {
      query: async (text: string, values?: readonly unknown[]) => {
        queryCalls.push({ text, values });
        if (text.includes('SELECT COUNT(*) as count FROM llm_usage')) {
          return { rows: [{ count: '0' }], rowCount: 1 };
        }

        if (text.includes('INSERT INTO llm_usage')) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    };

    let batchCallCount = 0;
    const model = {
      embedContent: async () => ({ embedding: { values: makeVectorValues() } }),
      batchEmbedContents: async ({
        requests,
      }: {
        requests: Array<{ content: { parts: Array<{ text: string }>; role: string } }>;
      }) => {
        batchCallCount += 1;
        if (batchCallCount === 1) {
          return { embeddings: requests.map(() => ({ values: makeVectorValues() })) };
        }

        return { embeddings: [{ values: [1, 2, 3] }] };
      },
    } as unknown as EmbedModel;

    const embedder = createEmbedder({ geminiApiKey: 'test-key' } as never, pool as never, makeLogger() as never, {
      model,
    });

    const texts = Array.from({ length: 101 }, (_, index) => `message ${index}`);
    const expectedTokens = texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);

    await assert.rejects(embedder.embedBatch(texts), /embedBatch: expected 768 dimensions but got 3/);

    const usageInserts = queryCalls.filter(({ text }) => text.includes('INSERT INTO llm_usage'));
    assert.equal(usageInserts.length, 1);
    assert.equal(batchCallCount, 2);

    const usageValues = usageInserts[0]?.values;
    assert.ok(usageValues, 'llm_usage insert should include query values');
    assert.equal(usageValues[1], 'embedding');
    assert.equal(usageValues[2], 'text-embedding-004');
    assert.equal(usageValues[3], expectedTokens);
  });
});
