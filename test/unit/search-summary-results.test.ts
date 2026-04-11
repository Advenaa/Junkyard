import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../../src/server.js';
import type { Config } from '../../src/config.js';
import type { SummaryRow } from '../../src/db/queries.js';

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

function createSummary(overrides: Partial<SummaryRow> = {}): SummaryRow {
  const now = Date.now();
  return {
    id: 'summary-default',
    source: 'discord',
    source_id: 'guild:default',
    window_start: now - 60_000,
    window_end: now - 30_000,
    body: JSON.stringify({ summary: 'Default search summary' }),
    sentiment: 0,
    urgency: 'routine',
    item_count: 1,
    created_at: now - 1_000,
    ...overrides,
  };
}

function decodeLikeNeedle(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replaceAll('%', '').replaceAll('_', '').toLowerCase();
}

function createSearchPool(seedSummaries: readonly SummaryRow[]): StubPool {
  const calls: QueryCall[] = [];

  return {
    calls,
    async query<T>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
      calls.push({ text, values });

      if (!text.includes('FROM summaries')) {
        return { rows: [], rowCount: 0 };
      }

      const [likeQuery, cutoff, limit] = values as [string, number, number];
      const needle = decodeLikeNeedle(likeQuery);
      let rows = seedSummaries.filter((row) => row.created_at > cutoff && row.body.toLowerCase().includes(needle));

      rows = [...rows].sort((left, right) => right.created_at - left.created_at);

      if (typeof limit === 'number') {
        rows = rows.slice(0, limit);
      }

      return {
        rows: rows as T[],
        rowCount: rows.length,
      };
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
} as never;

const healthMonitor = {
  async check() {},
  async getStatus() {
    return { checks: [], healthy: true };
  },
} as never;

function authHeaders(): Record<string, string> {
  return { authorization: 'Bearer test-api-key' };
}

function parsePayload<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

describe('GET /api/v1/search summary results', () => {
  it('drops JSON-key-only matches and returns the human-readable summary text', async () => {
    const now = Date.now();
    const pool = createSearchPool([
      createSummary({
        id: 'summary-json-key-only',
        created_at: now - 2_000,
        body: JSON.stringify({
          summary: 'Bitcoin surged past $75k on ETF inflows',
          confidence: 0.85,
          urgency: 'breaking',
          keyEvents: ['BTC cleared resistance'],
          entities: ['bitcoin'],
        }),
      }),
      createSummary({
        id: 'summary-natural-match',
        created_at: now - 1_000,
        body: JSON.stringify({
          summary: 'Macro entities rotated sharply after payrolls',
          confidence: 0.77,
          urgency: 'routine',
          keyEvents: ['Rotation broadened'],
          entities: ['macro'],
        }),
      }),
    ]);
    const app = await createServer(createConfig(), pool as never, log, healthMonitor);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search?q=entities&scope=summary',
        headers: authHeaders(),
      });

      assert.equal(response.statusCode, 200);
      const payload = parsePayload<{
        results: Array<{ id: string; body: string; resultType: string }>;
      }>(response.payload);

      assert.deepStrictEqual(
        payload.results.map((result) => result.id),
        ['summary-natural-match'],
      );
      assert.equal(payload.results[0]?.body, 'Macro entities rotated sharply after payrolls');
      assert.equal(payload.results[0]?.resultType, 'summary');

      const call = pool.calls.at(-1);
      assert.ok(call, 'summary search should query the summaries table');
      assert.equal(call.values[2], 60);
    } finally {
      await app.close();
    }
  });

  it('falls back to raw text when a summary body is malformed JSON', async () => {
    const malformedBody = 'Malformed summary body mentioning entities without JSON';
    const pool = createSearchPool([
      createSummary({
        id: 'summary-malformed-body',
        body: malformedBody,
      }),
    ]);
    const app = await createServer(createConfig(), pool as never, log, healthMonitor);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search?q=entities&scope=summary',
        headers: authHeaders(),
      });

      assert.equal(response.statusCode, 200);
      const payload = parsePayload<{
        results: Array<{ id: string; body: string; resultType: string }>;
      }>(response.payload);

      assert.equal(payload.results.length, 1);
      assert.equal(payload.results[0]?.id, 'summary-malformed-body');
      assert.equal(payload.results[0]?.body, malformedBody);
      assert.equal(payload.results[0]?.resultType, 'summary');
    } finally {
      await app.close();
    }
  });
});
