import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../../src/server.js';
import type { Config } from '../../src/config.js';
import type { UserRow } from '../../src/server-route-helpers.js';

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

function createPool(existingUser?: Pick<UserRow, 'role' | 'username'>): StubPool {
  const calls: QueryCall[] = [];

  return {
    calls,
    async query<T>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
      calls.push({ text, values });

      if (text.includes('SELECT role, username FROM users WHERE discord_id = $1')) {
        return {
          rows: existingUser ? [existingUser as T] : [],
          rowCount: existingUser ? 1 : 0,
        };
      }

      if (text.includes('INSERT INTO users (discord_id, username, avatar, role, created_at, last_login_at)')) {
        const [discordId, username, role, createdAt] = values as [string, string, string, number];
        const row = {
          discord_id: discordId,
          username,
          avatar: null,
          role,
          created_at: createdAt,
          last_login_at: null,
        };
        return { rows: [row as T], rowCount: 1 };
      }

      if (text.includes('INSERT INTO user_audit_log')) {
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('SELECT username FROM users WHERE discord_id = $1')) {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

const silentLog = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return silentLog;
  },
} as never;

const healthMonitor = {
  async getStatus() {
    return { checks: {}, healthy: true };
  },
} as never;

function authHeaders(): Record<string, string> {
  return { authorization: 'Bearer test-api-key' };
}

describe('POST /api/v1/users/invite', () => {
  it('creates a new pending-invite user when discord_id is unused', async () => {
    const pool = createPool();
    const app = await createServer(createConfig(), pool as never, silentLog, healthMonitor);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/users/invite',
        headers: authHeaders(),
        payload: {
          discordId: '123456789012345678',
          role: 'viewer',
        },
      });

      assert.ok(response.statusCode === 200 || response.statusCode === 201);
      const body = JSON.parse(response.payload) as { discordId: string; role: string };
      assert.equal(body.discordId, '123456789012345678');
      assert.equal(body.role, 'viewer');
      assert.equal(
        pool.calls.some((call) =>
          call.text.includes('INSERT INTO users (discord_id, username, avatar, role, created_at, last_login_at)'),
        ),
        true,
      );
      assert.equal(
        pool.calls.some((call) => call.text.includes('INSERT INTO user_audit_log')),
        true,
      );
    } finally {
      await app.close();
    }
  });

  it('returns 409 and does not touch users when discord_id already exists', async () => {
    const pool = createPool({ role: 'admin', username: 'existing' });
    const app = await createServer(createConfig(), pool as never, silentLog, healthMonitor);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/users/invite',
        headers: authHeaders(),
        payload: {
          discordId: '123456789012345678',
          role: 'viewer',
        },
      });

      assert.equal(response.statusCode, 409);
      assert.deepStrictEqual(JSON.parse(response.payload), { error: 'User already exists' });
      assert.equal(
        pool.calls.some((call) =>
          call.text.includes('INSERT INTO users (discord_id, username, avatar, role, created_at, last_login_at)'),
        ),
        false,
      );
      assert.equal(
        pool.calls.some((call) => call.text.includes('INSERT INTO user_audit_log')),
        false,
      );
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    const pool = createPool();
    const app = await createServer(createConfig(), pool as never, silentLog, healthMonitor);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/users/invite',
        payload: {
          discordId: '123456789012345678',
          role: 'viewer',
        },
      });

      assert.equal(response.statusCode, 401);
      assert.equal(
        pool.calls.some((call) =>
          call.text.includes('INSERT INTO users (discord_id, username, avatar, role, created_at, last_login_at)'),
        ),
        false,
      );
    } finally {
      await app.close();
    }
  });
});
