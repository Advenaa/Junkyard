import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createEmbedder } from '../../src/embed.js';

function makeLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    fatal: mock.fn(),
    debug: mock.fn(),
    trace: mock.fn(),
    child: mock.fn(),
  };
}

describe('createEmbedder quota restore', () => {
  it('fails closed on a restore error and retries restore on the next call', async (t) => {
    let restoreAttempts = 0;
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT COUNT(*) as count FROM llm_usage')) {
          restoreAttempts += 1;
          if (restoreAttempts === 1) {
            throw new Error('db unavailable');
          }
          return { rows: [{ count: '0' }], rowCount: 1 };
        }

        if (sql.includes('INSERT INTO llm_usage')) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    };
    const log = makeLogger();
    const embedContent = mock.fn(async () => ({
      embedding: { values: Array.from({ length: 768 }, () => 1) },
    }));

    t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
      embedContent,
      batchEmbedContents: mock.fn(),
    }));

    const embedder = createEmbedder({ geminiApiKey: 'test-key' } as never, pool as never, log as never);

    const first = await embedder.embed('first call should fail closed');
    assert.equal(first, null);
    assert.equal(embedContent.mock.callCount(), 0);
    assert.equal(restoreAttempts, 1);
    assert.match(String(log.warn.mock.calls[0]?.arguments[1] ?? ''), /locking quota until restore succeeds/);

    const second = await embedder.embed('second call should retry restore');
    assert.ok(second);
    assert.equal(second?.dimensions, 768);
    assert.equal(embedContent.mock.callCount(), 1);
    assert.equal(restoreAttempts, 2);
    assert.equal(queries.filter((sql) => sql.includes('SELECT COUNT(*) as count FROM llm_usage')).length, 2);
  });
});
