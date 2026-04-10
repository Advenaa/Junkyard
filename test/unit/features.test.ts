import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Config } from '../../src/config.js';
import { computeDisabledFeatures, formatStartupWarning, isFeatureDisabled } from '../../src/features.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    anthropicApiKey: null,
    openaiApiKey: 'openai-key',
    googleApiKey: null,
    geminiApiKey: null,
    databaseUrl: 'postgresql://localhost/test',
    discordClientId: null,
    discordClientSecret: null,
    adminUserIds: [],
    discordTokens: [],
    twitterApiKey: null,
    coingeckoApiKey: null,
    fredApiKey: null,
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
    disabledFeatures: {
      embeddings: { disabled: true, missingEnv: 'GEMINI_API_KEY', disables: [] },
      prices: { disabled: true, missingEnv: 'COINGECKO_API_KEY', disables: [] },
      macro: { disabled: true, missingEnv: 'FRED_API_KEY', disables: [] },
    },
    secrets: [],
    ...overrides,
  };
}

describe('features / computeDisabledFeatures', () => {
  it('marks all three features disabled when no optional keys are set', () => {
    const flags = computeDisabledFeatures(makeConfig());
    assert.equal(flags.embeddings.disabled, true);
    assert.equal(flags.prices.disabled, true);
    assert.equal(flags.macro.disabled, true);
    assert.equal(flags.embeddings.missingEnv, 'GEMINI_API_KEY');
    assert.equal(flags.prices.missingEnv, 'COINGECKO_API_KEY');
    assert.equal(flags.macro.missingEnv, 'FRED_API_KEY');
  });

  it('accepts GEMINI_API_KEY as the primary key for embeddings', () => {
    const flags = computeDisabledFeatures(makeConfig({ geminiApiKey: 'gemini-key' }));
    assert.equal(flags.embeddings.disabled, false);
  });

  it('falls back to GOOGLE_API_KEY for embeddings when gemini is missing', () => {
    const flags = computeDisabledFeatures(makeConfig({ googleApiKey: 'google-key' }));
    assert.equal(flags.embeddings.disabled, false);
  });

  it('marks only prices disabled when coingecko is missing', () => {
    const flags = computeDisabledFeatures(
      makeConfig({
        geminiApiKey: 'gemini',
        fredApiKey: 'fred',
      }),
    );
    assert.equal(flags.embeddings.disabled, false);
    assert.equal(flags.prices.disabled, true);
    assert.equal(flags.macro.disabled, false);
  });

  it('marks only macro disabled when fred is missing', () => {
    const flags = computeDisabledFeatures(
      makeConfig({
        geminiApiKey: 'gemini',
        coingeckoApiKey: 'cg',
      }),
    );
    assert.equal(flags.macro.disabled, true);
    assert.equal(flags.prices.disabled, false);
    assert.equal(flags.embeddings.disabled, false);
  });

  it('marks no features disabled when all optional keys are present', () => {
    const flags = computeDisabledFeatures(
      makeConfig({
        geminiApiKey: 'gemini',
        coingeckoApiKey: 'cg',
        fredApiKey: 'fred',
      }),
    );
    assert.equal(flags.embeddings.disabled, false);
    assert.equal(flags.prices.disabled, false);
    assert.equal(flags.macro.disabled, false);
  });

  it('lists the concrete features disabled for each missing key', () => {
    const flags = computeDisabledFeatures(makeConfig());
    assert.ok(flags.embeddings.disables.includes('RAG chat'));
    assert.ok(flags.embeddings.disables.includes('narrative clustering'));
    assert.ok(flags.prices.disables.includes('price feeds'));
    assert.ok(flags.macro.disables.includes('macro snapshots'));
  });
});

describe('features / isFeatureDisabled', () => {
  it('returns the disabled flag for the requested key', () => {
    const flags = computeDisabledFeatures(makeConfig({ geminiApiKey: 'g' }));
    assert.equal(isFeatureDisabled(flags, 'embeddings'), false);
    assert.equal(isFeatureDisabled(flags, 'prices'), true);
  });
});

describe('features / formatStartupWarning', () => {
  it('returns null when all features are enabled', () => {
    const flags = computeDisabledFeatures(
      makeConfig({
        geminiApiKey: 'gemini',
        coingeckoApiKey: 'cg',
        fredApiKey: 'fred',
      }),
    );
    assert.equal(formatStartupWarning(flags), null);
  });

  it('lists each missing env var and what it disables', () => {
    const flags = computeDisabledFeatures(makeConfig());
    const warning = formatStartupWarning(flags);
    assert.ok(warning);
    assert.match(warning!, /Optional API keys missing/);
    assert.match(warning!, /GEMINI_API_KEY/);
    assert.match(warning!, /COINGECKO_API_KEY/);
    assert.match(warning!, /FRED_API_KEY/);
    assert.match(warning!, /price feeds/);
    assert.match(warning!, /macro snapshots/);
    assert.match(warning!, /RAG chat/);
  });

  it('only lists the missing env vars when some are set', () => {
    const flags = computeDisabledFeatures(
      makeConfig({
        geminiApiKey: 'gemini',
        coingeckoApiKey: 'cg',
      }),
    );
    const warning = formatStartupWarning(flags);
    assert.ok(warning);
    assert.match(warning!, /FRED_API_KEY/);
    assert.ok(!warning!.includes('GEMINI_API_KEY'));
    assert.ok(!warning!.includes('COINGECKO_API_KEY'));
  });
});
