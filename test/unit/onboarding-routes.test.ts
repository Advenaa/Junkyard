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

interface OnboardingPoolState {
  dismissedOnboarding: boolean;
  sourceCount: number;
  itemsReady: number;
  itemsProcessing: number;
  summariesToday: number;
}

interface StubPool {
  calls: QueryCall[];
  state: OnboardingPoolState;
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

function createOnboardingPool(initialState: Partial<OnboardingPoolState> = {}): StubPool {
  const state: OnboardingPoolState = {
    dismissedOnboarding: false,
    sourceCount: 0,
    itemsReady: 0,
    itemsProcessing: 0,
    summariesToday: 0,
    ...initialState,
  };
  const calls: QueryCall[] = [];

  return {
    calls,
    state,
    async query<T>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
      calls.push({ text, values });

      if (text.includes('FROM sessions s') && text.includes('JOIN users u ON u.discord_id = s.discord_id')) {
        return {
          rows: [
            {
              discord_id: '123456789012345678',
              role: 'viewer',
              expires_at: Date.now() + 60_000,
              last_refreshed_at: Date.now(),
              ip_address: null,
              user_agent: null,
            } as T,
          ],
          rowCount: 1,
        };
      }

      if (text.includes('SELECT username FROM users WHERE discord_id = $1')) {
        return {
          rows: [{ username: 'onboarding-user' } as T],
          rowCount: 1,
        };
      }

      if (text.includes('SELECT value FROM app_config WHERE key = $1')) {
        return {
          rows: [{ value: 'Asia/Jakarta' } as T],
          rowCount: 1,
        };
      }

      if (text.includes('AS dismissed_onboarding')) {
        return {
          rows: [
            {
              source_count: String(state.sourceCount),
              items_ready: String(state.itemsReady),
              items_processing: String(state.itemsProcessing),
              summaries_today: String(state.summariesToday),
              dismissed_onboarding: state.dismissedOnboarding,
            } as T,
          ],
          rowCount: 1,
        };
      }

      if (text.includes('UPDATE users SET dismissed_onboarding = TRUE WHERE discord_id = $1')) {
        state.dismissedOnboarding = true;
        return { rows: [], rowCount: 1 };
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
} as never;

const healthMonitor = {
  async getStatus() {
    return { checks: {}, healthy: true };
  },
} as never;

describe('onboarding routes', () => {
  it('returns showOnboarding=true when the current user has not dismissed onboarding and no sources exist', async () => {
    const pool = createOnboardingPool({
      dismissedOnboarding: false,
      sourceCount: 0,
      itemsReady: 2,
      itemsProcessing: 1,
      summariesToday: 0,
    });
    const app = await createServer(createConfig(), pool as never, log, healthMonitor);

    try {
      const signedSession = app.signCookie('session-1');
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/onboarding',
        headers: {
          cookie: `podders_session=${encodeURIComponent(signedSession)}`,
          'user-agent': 'Vitest',
        },
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.payload), {
        showOnboarding: true,
        sourceCount: 0,
        statusSummary: {
          itemsReady: 2,
          itemsProcessing: 1,
          summariesToday: 0,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('marks onboarding dismissed for the current user and hides it on subsequent reads', async () => {
    const pool = createOnboardingPool();
    const app = await createServer(createConfig(), pool as never, log, healthMonitor);

    try {
      const signedSession = app.signCookie('session-1');
      const headers = {
        cookie: `podders_session=${encodeURIComponent(signedSession)}`,
        'user-agent': 'Vitest',
      };

      const dismissResponse = await app.inject({
        method: 'PATCH',
        url: '/api/v1/onboarding/dismiss',
        headers,
        payload: {},
      });

      assert.equal(dismissResponse.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(dismissResponse.payload), { ok: true });
      assert.equal(pool.state.dismissedOnboarding, true);

      const readResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/onboarding',
        headers,
      });

      assert.equal(readResponse.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(readResponse.payload), {
        showOnboarding: false,
        sourceCount: 0,
        statusSummary: {
          itemsReady: 0,
          itemsProcessing: 0,
          summariesToday: 0,
        },
      });
      assert.equal(
        pool.calls.some((call) =>
          call.text.includes('UPDATE users SET dismissed_onboarding = TRUE WHERE discord_id = $1'),
        ),
        true,
      );
    } finally {
      await app.close();
    }
  });
});
