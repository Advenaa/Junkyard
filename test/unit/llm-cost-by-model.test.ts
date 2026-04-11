import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../../src/server.js';
import type { Config } from '../../src/config.js';

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

interface StubPool {
  calls: QueryCall[];
  query<T>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    anthropicApiKey: null,
    openaiApiKey: 'test-openai-key',
    googleApiKey: null,
    geminiApiKey: null,
    databaseUrl: 'postgresql://podders:test@localhost:5432/podders',
    discordClientId: null,
    discordClientSecret: null,
    adminUserIds: [],
    discordTokens: [],
    twitterApiKey: null,
    coingeckoApiKey: null,
    fredApiKey: null,
    apiKey: 'test-api-key',
    sessionSecret: 'test-session-secret',
    port: 3000,
    dataDir: './data',
    publicUrl: 'https://podders.test',
    alertWebhookUrl: null,
    models: {
      normalizer: 'openai-codex:gpt-5.4-mini',
      chunk: 'openai-codex:gpt-5.4-mini',
      thinkalot: 'openai-codex:gpt-5.4',
      normalizerFallback: null,
      chunkFallback: null,
      thinkalotFallback: null,
    },
    disabledFeatures: {
      embeddings: { disabled: true, missingEnv: 'GEMINI_API_KEY', disables: [], keyRejected: false },
      prices: { disabled: true, missingEnv: 'COINGECKO_API_KEY', disables: [], keyRejected: false },
      macro: { disabled: true, missingEnv: 'FRED_API_KEY', disables: [], keyRejected: false },
    },
    secrets: [],
    ...overrides,
  };
}

function createPool(): StubPool {
  const calls: QueryCall[] = [];

  return {
    calls,
    async query<T>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
      calls.push({ text, values });

      if (text.includes('SELECT value FROM app_config WHERE key = $1')) {
        return { rows: [], rowCount: 0 };
      }

      if (text.includes(`SELECT EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000 AS start_of_day`)) {
        return {
          rows: [{ start_of_day: '1776211200000' } as T],
          rowCount: 1,
        };
      }

      if (
        text.includes('FROM llm_usage') &&
        text.includes('COALESCE(SUM(cost_usd), 0) AS total_cost') &&
        text.includes('GROUP BY model')
      ) {
        return {
          rows: [
            {
              model: 'claude-haiku-4-5',
              total_cost: '0.125',
              total_input_tokens: '50000',
              total_output_tokens: '2000',
              call_count: '10',
            },
            {
              model: 'claude-sonnet-4-6',
              total_cost: '0.870',
              total_input_tokens: '12000',
              total_output_tokens: '5000',
              call_count: '3',
            },
          ] as T[],
          rowCount: 2,
        };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

const log = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return log;
  },
};

const healthMonitor = {
  async check() {},
  async getStatus() {
    return { checks: [], healthy: true };
  },
};

function authHeaders(): Record<string, string> {
  return { authorization: 'Bearer test-api-key' };
}

function parsePayload<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

describe('GET /api/v1/llm/cost-by-model', () => {
  it('returns per-model cost entries for the current day', async () => {
    const pool = createPool();
    const app = await createServer(createConfig(), pool as never, log as never, healthMonitor as never);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/llm/cost-by-model',
        headers: authHeaders(),
      });

      assert.equal(response.statusCode, 200);
      const body = parsePayload<{
        timezone: string;
        sinceMs: number;
        entries: Array<{
          model: string;
          totalCost: number;
          totalInputTokens: number;
          totalOutputTokens: number;
          callCount: number;
        }>;
      }>(response.payload);

      assert.deepStrictEqual(body, {
        timezone: 'Asia/Jakarta',
        sinceMs: 1776211200000,
        entries: [
          {
            model: 'claude-haiku-4-5',
            totalCost: 0.125,
            totalInputTokens: 50000,
            totalOutputTokens: 2000,
            callCount: 10,
          },
          {
            model: 'claude-sonnet-4-6',
            totalCost: 0.87,
            totalInputTokens: 12000,
            totalOutputTokens: 5000,
            callCount: 3,
          },
        ],
      });
      assert.equal(typeof body.sinceMs, 'number');
      assert.equal(typeof body.entries[0]?.totalCost, 'number');
      assert.equal(typeof body.entries[0]?.totalInputTokens, 'number');
      assert.equal(typeof body.entries[0]?.totalOutputTokens, 'number');
      assert.equal(typeof body.entries[0]?.callCount, 'number');
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    const pool = createPool();
    const app = await createServer(createConfig(), pool as never, log as never, healthMonitor as never);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/llm/cost-by-model',
      });

      assert.equal(response.statusCode, 401);
      assert.deepStrictEqual(parsePayload(response.payload), { error: 'Unauthorized' });
      assert.equal(
        pool.calls.some(
          (call) =>
            call.text.includes('FROM llm_usage') &&
            call.text.includes('COALESCE(SUM(cost_usd), 0) AS total_cost') &&
            call.text.includes('GROUP BY model'),
        ),
        false,
        'unauthenticated requests must fail before the cost aggregation query runs',
      );
    } finally {
      await app.close();
    }
  });
});
