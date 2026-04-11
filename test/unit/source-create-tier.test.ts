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

interface StoredSource {
  source: string;
  source_id: string;
  label: string | null;
  trust_weight: number;
  initial_trust_weight: number;
  added_at: number;
  poll_interval: number;
  tier: string;
}

interface StubPool {
  calls: QueryCall[];
  getSource(source: string, sourceId: string): StoredSource | undefined;
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

function createSourcePool(): StubPool {
  const calls: QueryCall[] = [];
  const sources = new Map<string, StoredSource>();

  function keyFor(source: string, sourceId: string): string {
    return `${source}:${sourceId}`;
  }

  return {
    calls,
    getSource(source: string, sourceId: string): StoredSource | undefined {
      return sources.get(keyFor(source, sourceId));
    },
    async query<T>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
      calls.push({ text, values });

      if (
        text.includes('INSERT INTO sources (source, source_id, label, trust_weight, initial_trust_weight, added_at)')
      ) {
        const [source, sourceId, label, trustWeight, addedAt] = values as [
          string,
          string,
          string | null,
          number,
          number,
        ];
        const row: StoredSource = {
          source,
          source_id: sourceId,
          label,
          trust_weight: trustWeight,
          initial_trust_weight: trustWeight,
          added_at: addedAt,
          poll_interval: 300,
          tier: 'general',
        };
        sources.set(keyFor(source, sourceId), row);
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('UPDATE sources SET poll_interval = $1 WHERE source = $2 AND source_id = $3')) {
        const [pollInterval, source, sourceId] = values as [number, string, string];
        const row = sources.get(keyFor(source, sourceId));
        assert.ok(row, 'source should exist before poll_interval update');
        row.poll_interval = pollInterval;
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('UPDATE sources SET tier = $3 WHERE source = $1 AND source_id = $2')) {
        const [source, sourceId, tier] = values as [string, string, string];
        const row = sources.get(keyFor(source, sourceId));
        assert.ok(row, 'source should exist before tier update');
        row.tier = tier;
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('INSERT INTO source_state')) {
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('SELECT * FROM sources WHERE source = $1 AND source_id = $2')) {
        const [source, sourceId] = values as [string, string];
        const row = sources.get(keyFor(source, sourceId));
        return {
          rows: row ? [row as T] : [],
          rowCount: row ? 1 : 0,
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

describe('POST /api/v1/sources tier persistence', () => {
  it('persists the requested tier when creating a source', async () => {
    const pool = createSourcePool();
    const app = await createServer(createConfig(), pool as never, log as never, healthMonitor as never);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sources',
        headers: authHeaders(),
        payload: {
          source: 'twitter',
          sourceId: '@alpha_feed',
          tier: 'alpha',
        },
      });

      assert.equal(response.statusCode, 201);
      const body = JSON.parse(response.payload) as { source: string; sourceId: string; tier: string };
      assert.equal(body.source, 'twitter');
      assert.equal(body.sourceId, '@alpha_feed');
      assert.equal(body.tier, 'alpha');

      const stored = pool.getSource('twitter', '@alpha_feed');
      assert.ok(stored, 'created source should be stored in the backing pool');
      assert.equal(stored.tier, 'alpha');
      assert.equal(
        pool.calls.some((call) =>
          call.text.includes('UPDATE sources SET tier = $3 WHERE source = $1 AND source_id = $2'),
        ),
        true,
        'create path should reuse updateSourceTier for the persisted tier write',
      );
    } finally {
      await app.close();
    }
  });
});
