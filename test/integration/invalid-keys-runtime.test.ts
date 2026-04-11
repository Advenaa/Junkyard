/**
 * Runtime regression for the "valid-shape key that upstream rejects" scenario.
 *
 * Boots each optional fetcher (CoinGecko prices, FRED macro, Gemini embeddings)
 * with a `badkey` string under a fetch stub that answers 401/403. Asserts that
 * the `onAuthFailure` hook fires and, when wired to `markFeatureKeyRejected`,
 * flips the in-memory `DisabledFeatures` flag to `keyRejected: true` so that
 * subsequent `featureDisabledResponse` payloads surface `reason: 'auth_failed'`.
 *
 * This covers the gap between the unit-level features tests
 * (`test/unit/features.test.ts`, which only exercise pure functions) and the
 * wiring tests (`test/unit/feature-guards-api.test.ts`, which only scan source
 * strings). Nothing else in the suite actually drives the trackers through a
 * failing auth response.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeDisabledFeatures,
  featureDisabledResponse,
  markFeatureKeyRejected,
  type DisabledFeatures,
} from '../../src/features.js';
import type { Config } from '../../src/config.js';
import type { Pool } from '../../src/db/connection.js';
import type { Logger } from '../../src/logger.js';
import { createPriceFetcher } from '../../src/prices/coingecko.js';
import { createFredMacroFetcher } from '../../src/macro/fred.js';
import { createEmbedder } from '../../src/embed.js';

interface LoggedWarning {
  obj: unknown;
  msg: string;
}

interface StubLogger extends Logger {
  warnings: LoggedWarning[];
}

function makeLogger(): StubLogger {
  const warnings: LoggedWarning[] = [];
  const noop = () => {};
  const logger: Partial<StubLogger> = {
    info: noop as Logger['info'],
    debug: noop as Logger['debug'],
    error: noop as Logger['error'],
    fatal: noop as Logger['fatal'],
    trace: noop as Logger['trace'],
    warn: ((obj: unknown, msg?: string) => {
      warnings.push({ obj, msg: msg ?? '' });
    }) as Logger['warn'],
    level: 'info',
    warnings,
  };
  logger.child = (() => logger) as Logger['child'];
  return logger as StubLogger;
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  const base: Omit<Config, 'disabledFeatures'> = {
    anthropicApiKey: null,
    openaiApiKey: null,
    googleApiKey: null,
    geminiApiKey: 'badkey',
    databaseUrl: 'postgresql://localhost/test',
    discordClientId: null,
    discordClientSecret: null,
    adminUserIds: [],
    discordTokens: [],
    twitterApiKey: null,
    coingeckoApiKey: 'badkey',
    fredApiKey: 'badkey',
    apiKey: 'pk_test',
    sessionSecret: 'session',
    port: 3000,
    dataDir: './data',
    publicUrl: null,
    alertWebhookUrl: null,
    models: {
      normalizer: 'openai-codex:gpt-5.4-mini',
      chunk: 'openai-codex:gpt-5.4-mini',
      thinkalot: 'openai-codex:gpt-5.4',
      normalizerFallback: null,
      chunkFallback: null,
      thinkalotFallback: null,
    },
    secrets: [],
    ...overrides,
  };
  const disabledFeatures = computeDisabledFeatures({
    ...base,
    disabledFeatures: {} as DisabledFeatures,
  });
  return { ...base, disabledFeatures };
}

// Minimal Pool stub that satisfies `initQuota()` in `createEmbedder` without
// touching a real database.
function makePoolStub(): Pool {
  const pool = {
    query: async () => ({
      rows: [{ count: '0' }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    }),
    connect: async () => {
      throw new Error('pool.connect() not expected in this test');
    },
    end: async () => {},
    on: () => pool,
  };
  return pool as unknown as Pool;
}

type StubFetch = (status: number, body?: unknown) => typeof globalThis.fetch;

const stubFetch: StubFetch = (status, body = {}) =>
  (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch;

describe('integration / invalid keys at runtime', () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('CoinGecko 401 flips prices.keyRejected and surfaces reason=auth_failed', async () => {
    const log = makeLogger();
    const config = makeConfig();
    const flags = config.disabledFeatures;

    assert.equal(flags.prices.disabled, false, 'sanity: prices start enabled when a key is present');
    assert.equal(flags.prices.keyRejected, false);

    globalThis.fetch = stubFetch(401, { error: 'Unauthorized' });

    const fetcher = createPriceFetcher(log, 'badkey', () => markFeatureKeyRejected(flags, 'prices', log));

    // `fetchPrices` catches per-chunk errors and returns partial results,
    // so we observe the side effect on `flags` rather than a thrown error.
    const result = await fetcher.fetchPrices(['bitcoin']);
    assert.equal(result.size, 0, 'no prices returned when upstream rejects the key');

    assert.equal(flags.prices.keyRejected, true);
    assert.equal(flags.prices.disabled, true);
    assert.equal(featureDisabledResponse(flags, 'prices').reason, 'auth_failed');
    assert.ok(
      log.warnings.some((w) => {
        const obj = w.obj as { feature?: string } | undefined;
        return obj?.feature === 'prices';
      }),
      'markFeatureKeyRejected logs a structured warning against the prices feature',
    );
  });

  it('CoinGecko 403 also flips prices.keyRejected', async () => {
    const log = makeLogger();
    const flags = makeConfig().disabledFeatures;

    globalThis.fetch = stubFetch(403, '');

    const fetcher = createPriceFetcher(log, 'badkey', () => markFeatureKeyRejected(flags, 'prices', log));
    await fetcher.fetchPrices(['ethereum']);

    assert.equal(flags.prices.keyRejected, true);
  });

  it('CoinGecko transient 500 does NOT flip keyRejected', async () => {
    const log = makeLogger();
    const flags = makeConfig().disabledFeatures;

    globalThis.fetch = stubFetch(500, { error: 'upstream down' });

    const fetcher = createPriceFetcher(log, 'badkey', () => markFeatureKeyRejected(flags, 'prices', log));
    await fetcher.fetchPrices(['bitcoin']);

    assert.equal(flags.prices.keyRejected, false, 'a 5xx must not poison the feature flag');
    assert.equal(flags.prices.disabled, false);
    assert.equal(featureDisabledResponse(flags, 'prices').reason, 'missing_env');
  });

  it('FRED 401 flips macro.keyRejected and surfaces reason=auth_failed', async () => {
    const log = makeLogger();
    const flags = makeConfig().disabledFeatures;

    assert.equal(flags.macro.disabled, false);

    globalThis.fetch = stubFetch(401, { error: 'Invalid API key' });

    const fetcher = createFredMacroFetcher(log, 'badkey', () => markFeatureKeyRejected(flags, 'macro', log));

    // `fetchLatest` swallows per-series errors and returns whatever succeeded,
    // so every series hits the stub and `onAuthFailure` should fire at least once.
    const snapshots = await fetcher.fetchLatest();
    assert.equal(snapshots.length, 0);

    assert.equal(flags.macro.keyRejected, true);
    assert.equal(flags.macro.disabled, true);
    assert.equal(featureDisabledResponse(flags, 'macro').reason, 'auth_failed');
  });

  it('Gemini 401 flips embeddings.keyRejected and surfaces reason=auth_failed', async () => {
    const log = makeLogger();
    const config = makeConfig();
    const flags = config.disabledFeatures;

    assert.equal(flags.embeddings.disabled, false);

    globalThis.fetch = stubFetch(401, {
      error: { code: 401, message: 'API key not valid. Please pass a valid API key.', status: 'UNAUTHENTICATED' },
    });

    const embedder = createEmbedder(config, makePoolStub(), log, () =>
      markFeatureKeyRejected(flags, 'embeddings', log),
    );

    // `embed()` refunds the quota counter and re-throws 401, so assert the throw.
    let threw = false;
    try {
      await embedder.embed('hello world');
    } catch {
      threw = true;
    }
    assert.ok(threw, 'embed() must bubble up the 401 to the caller');

    assert.equal(flags.embeddings.keyRejected, true);
    assert.equal(flags.embeddings.disabled, true);
    assert.equal(featureDisabledResponse(flags, 'embeddings').reason, 'auth_failed');
  });

  it('keyRejected flip is independent per feature', () => {
    const log = makeLogger();
    const flags = makeConfig().disabledFeatures;

    markFeatureKeyRejected(flags, 'macro', log);

    assert.equal(flags.macro.keyRejected, true);
    assert.equal(flags.macro.disabled, true);
    assert.equal(flags.prices.keyRejected, false);
    assert.equal(flags.embeddings.keyRejected, false);
    assert.equal(featureDisabledResponse(flags, 'macro').reason, 'auth_failed');
    assert.equal(featureDisabledResponse(flags, 'prices').reason, 'missing_env');
    assert.equal(featureDisabledResponse(flags, 'embeddings').reason, 'missing_env');
  });

  it('markFeatureKeyRejected is idempotent — second call is a no-op', () => {
    const log = makeLogger();
    const flags = makeConfig().disabledFeatures;

    markFeatureKeyRejected(flags, 'prices', log);
    const firstWarnCount = log.warnings.length;

    markFeatureKeyRejected(flags, 'prices', log);
    assert.equal(
      log.warnings.length,
      firstWarnCount,
      'second call must not emit another warning once the flag is already flipped',
    );
    assert.equal(flags.prices.keyRejected, true);
  });
});
