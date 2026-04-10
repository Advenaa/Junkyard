import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../../src/server.js';
import type { Config } from '../../src/config.js';
import type { ItemRow } from '../../src/db/queries.js';

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
      embeddings: { disabled: true, missingEnv: 'GEMINI_API_KEY', disables: [] },
      prices: { disabled: true, missingEnv: 'COINGECKO_API_KEY', disables: [] },
      macro: { disabled: true, missingEnv: 'FRED_API_KEY', disables: [] },
    },
    secrets: [],
    ...overrides,
  };
}

function createItem(overrides: Partial<ItemRow>): ItemRow {
  return {
    id: 'item-default',
    source: 'discord',
    source_id: 'default-source-id',
    author: 'alice',
    content: 'raw item',
    timestamp: Date.UTC(2026, 3, 10, 10, 0, 0),
    url: null,
    engagement: 0,
    attachments: null,
    content_hash: 'hash-default',
    content_anchor: null,
    original_language: 'eng',
    translated: false,
    filter_reason: null,
    status: 'processed',
    batch_id: null,
    created_at: Date.UTC(2026, 3, 10, 10, 0, 1),
    ...overrides,
  };
}

function createFeedPool(seedItems: readonly ItemRow[]): StubPool {
  const calls: QueryCall[] = [];

  return {
    calls,
    async query<T>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
      calls.push({ text, values });

      if (!text.includes('SELECT * FROM items')) {
        return { rows: [], rowCount: 0 };
      }

      let rows = [...seedItems];

      if (text.includes('WHERE source = $1 AND source_id = $2')) {
        const [source, sourceId] = values as [string, string];
        rows = rows.filter((row) => row.source === source && row.source_id === sourceId);
      } else if (text.includes('WHERE source_id = $1')) {
        const [sourceId] = values as [string];
        rows = rows.filter((row) => row.source_id === sourceId);
      }

      const afterMatch = text.match(/timestamp > \$(\d+)/);
      if (afterMatch) {
        const after = values[Number(afterMatch[1]) - 1];
        if (typeof after === 'number') {
          rows = rows.filter((row) => row.timestamp > after);
        }
      }

      rows.sort((left, right) => right.timestamp - left.timestamp);

      const limitMatch = text.match(/LIMIT \$(\d+)/);
      if (limitMatch) {
        const limit = values[Number(limitMatch[1]) - 1];
        if (typeof limit === 'number') {
          rows = rows.slice(0, limit);
        }
      }

      const offsetMatch = text.match(/OFFSET \$(\d+)/);
      if (offsetMatch) {
        const offset = values[Number(offsetMatch[1]) - 1];
        if (typeof offset === 'number') {
          rows = rows.slice(offset);
        }
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

describe('GET /api/v1/feed/:sourceId source filtering', () => {
  it('keeps the legacy source_id-only filter when source query param is omitted', async () => {
    const pool = createFeedPool([createItem({ id: 'discord-item', source_id: 'collision-id' })]);
    const app = await createServer(createConfig(), pool as never, log as never, healthMonitor as never);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/feed/collision-id',
        headers: authHeaders(),
      });

      assert.equal(response.statusCode, 200);
      const call = pool.calls.at(-1);
      assert.ok(call, 'feed query should be executed');
      assert.ok(call.text.includes('WHERE source_id = $1'));
      assert.deepStrictEqual(call.values, ['collision-id', 50]);
    } finally {
      await app.close();
    }
  });

  it('filters by source and source_id when source query param is provided', async () => {
    const pool = createFeedPool([createItem({ id: 'discord-item', source: 'discord', source_id: 'collision-id' })]);
    const app = await createServer(createConfig(), pool as never, log as never, healthMonitor as never);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/feed/collision-id?source=discord',
        headers: authHeaders(),
      });

      assert.equal(response.statusCode, 200);
      const call = pool.calls.at(-1);
      assert.ok(call, 'feed query should be executed');
      assert.ok(call.text.includes('source = $1'));
      assert.ok(call.text.includes('source_id = $2'));
      assert.match(call.text, /\bAND\b/);
      assert.deepStrictEqual(call.values, ['discord', 'collision-id', 50]);
    } finally {
      await app.close();
    }
  });

  it('prevents source collisions when source is specified and preserves back-compat when omitted', async () => {
    const pool = createFeedPool([
      createItem({
        id: 'discord-item',
        source: 'discord',
        source_id: 'collision-id',
        content: 'discord content',
        timestamp: Date.UTC(2026, 3, 10, 10, 0, 0),
      }),
      createItem({
        id: 'twitter-item',
        source: 'twitter',
        source_id: 'collision-id',
        content: 'twitter content',
        timestamp: Date.UTC(2026, 3, 10, 11, 0, 0),
      }),
    ]);
    const app = await createServer(createConfig(), pool as never, log as never, healthMonitor as never);

    try {
      const twitterResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/feed/collision-id?source=twitter',
        headers: authHeaders(),
      });
      assert.equal(twitterResponse.statusCode, 200);
      const twitterBody = parsePayload<{ items: Array<{ id: string; source: string; sourceId: string }> }>(
        twitterResponse.payload,
      );
      assert.deepStrictEqual(
        twitterBody.items.map((item) => item.id),
        ['twitter-item'],
      );
      assert.deepStrictEqual(
        twitterBody.items.map((item) => item.source),
        ['twitter'],
      );
      assert.deepStrictEqual(
        twitterBody.items.map((item) => item.sourceId),
        ['collision-id'],
      );

      const discordResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/feed/collision-id?source=discord',
        headers: authHeaders(),
      });
      assert.equal(discordResponse.statusCode, 200);
      const discordBody = parsePayload<{ items: Array<{ id: string; source: string; sourceId: string }> }>(
        discordResponse.payload,
      );
      assert.deepStrictEqual(
        discordBody.items.map((item) => item.id),
        ['discord-item'],
      );
      assert.deepStrictEqual(
        discordBody.items.map((item) => item.source),
        ['discord'],
      );
      assert.deepStrictEqual(
        discordBody.items.map((item) => item.sourceId),
        ['collision-id'],
      );

      const legacyResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/feed/collision-id',
        headers: authHeaders(),
      });
      assert.equal(legacyResponse.statusCode, 200);
      const legacyBody = parsePayload<{ items: Array<{ id: string; source: string; sourceId: string }> }>(
        legacyResponse.payload,
      );
      assert.deepStrictEqual(
        legacyBody.items.map((item) => item.id),
        ['twitter-item', 'discord-item'],
      );
      assert.deepStrictEqual(
        legacyBody.items.map((item) => item.source),
        ['twitter', 'discord'],
      );
    } finally {
      await app.close();
    }
  });
});
