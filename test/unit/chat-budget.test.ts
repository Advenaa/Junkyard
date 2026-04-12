import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChatHandler } from '../../src/chat/handler.js';
import { refundChatDailyTokens, reserveChatDailyTokens } from '../../src/db/queries.js';
import type { Embedder } from '../../src/chat/tools.js';
import type { SearchResult, VectorCache } from '../../src/vector-cache.js';
import type { Config } from '../../src/config.js';
import type { Logger } from '../../src/logger.js';
import type { MockLogger } from '../helpers/mock-types.js';

function createBudgetPool() {
  const usage = new Map<string, number>();
  const calls: Array<{ text: string; values: unknown[] }> = [];

  return {
    calls,
    async query(text: string, values?: unknown[]) {
      const params = values ?? [];
      calls.push({ text, values: params });

      if (text.includes('INSERT INTO chat_daily_usage')) {
        const [userId, usageDay, tokens, _now, maxTokens] = params as [string, string, number, number, number];
        const key = `${userId}:${usageDay}`;
        const current = usage.get(key) ?? 0;
        if (current + tokens <= maxTokens) {
          const next = current + tokens;
          usage.set(key, next);
          return { rows: [{ token_count: next }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      if (text.includes('SELECT token_count FROM chat_daily_usage')) {
        const [userId, usageDay] = params as [string, string];
        const key = `${userId}:${usageDay}`;
        const current = usage.get(key);
        return { rows: current == null ? [] : [{ token_count: current }], rowCount: current == null ? 0 : 1 };
      }

      if (text.includes('UPDATE chat_daily_usage')) {
        const [userId, usageDay, tokens] = params as [string, string, number];
        const key = `${userId}:${usageDay}`;
        const current = usage.get(key) ?? 0;
        usage.set(key, Math.max(current - tokens, 0));
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

function createDeniedBudgetPool() {
  const calls: Array<{ text: string; values: unknown[] }> = [];

  return {
    calls,
    async query(text: string, values?: unknown[]) {
      const params = values ?? [];
      calls.push({ text, values: params });

      if (text.includes('INSERT INTO chat_daily_usage')) {
        return { rows: [], rowCount: 0 };
      }

      if (text.includes('SELECT token_count FROM chat_daily_usage')) {
        return { rows: [{ token_count: 100_000 }], rowCount: 1 };
      }

      if (text.includes('UPDATE chat_daily_usage')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

const noopLog = {
  info() {},
  debug() {},
  warn() {},
  error() {},
  fatal() {},
  child() {
    return noopLog;
  },
} as MockLogger;
const logger = noopLog as unknown as Logger;
const testConfig = {
  models: { normalizer: 'haiku', chunk: 'haiku', thinkalot: 'sonnet' },
} as unknown as Config;

function stubVectorCache(results: SearchResult[] = []): VectorCache {
  return {
    async load() {},
    async search() {
      return results;
    },
    update() {},
    prune() {
      return 0;
    },
    getSize() {
      return { summaries: 0, reports: 0 };
    },
  };
}

const stubEmbedder: Embedder = {
  async embed() {
    return { vector: new Float32Array([1, 0, 0]) };
  },
  prepareText(text: string, type: 'item' | 'summary' | 'entity' | 'report') {
    return `${type}: ${text}`;
  },
};

describe('chat daily token budget queries', () => {
  it('atomically reserves and refunds daily usage against a max budget', async () => {
    const pool = createBudgetPool();
    const day = '2026-04-08';

    const first = await reserveChatDailyTokens(pool as never, 'user-1', day, 60, 100, 1);
    assert.deepStrictEqual(first, { allowed: true, tokenCount: 60 });

    const second = await reserveChatDailyTokens(pool as never, 'user-1', day, 50, 100, 2);
    assert.deepStrictEqual(second, { allowed: false, tokenCount: 60 });

    await refundChatDailyTokens(pool as never, 'user-1', day, 20, 3);

    const third = await reserveChatDailyTokens(pool as never, 'user-1', day, 40, 100, 4);
    assert.deepStrictEqual(third, { allowed: true, tokenCount: 80 });
  });
});

describe('createChatHandler budget enforcement', () => {
  it('returns the daily budget message before calling the LLM when DB reservation is denied', async () => {
    const pool = createDeniedBudgetPool();
    let llmCalls = 0;
    const llm = {
      async call() {
        llmCalls++;
        return { content: 'should not be called' };
      },
      wrapWithNonce(content: string) {
        return { wrapped: `<wrapped>${content}</wrapped>`, nonce: 'nonce' };
      },
    };

    const handler = createChatHandler(pool as never, logger, testConfig, llm, stubVectorCache(), stubEmbedder);

    const result = await handler.handle('Hello', 'conv-budget', 'user-budget');

    assert.equal(llmCalls, 0);
    assert.match(result.response, /daily query limit/i);
    assert.match(result.response, /midnight UTC/);
    assert.deepStrictEqual(result.toolsUsed, []);
    assert.deepStrictEqual(result.sources, []);
  });
});
