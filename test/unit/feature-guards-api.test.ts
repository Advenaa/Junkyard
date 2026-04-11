/**
 * Structural regression tests for the optional-API-key 503 guards (Cycle 384).
 *
 * Verifies:
 * - server.ts and server-insight-routes.ts import featureDisabledResponse
 * - /api/v1/macro returns 503 when config.disabledFeatures.macro.disabled
 * - /api/v1/price-watch and /api/v1/entities/:entityId/price return 503 when prices disabled
 * - /api/v1/narratives and /api/v1/narratives/:id return 503 when embeddings disabled
 * - /api/v1/search?mode=semantic returns 503 when embeddings disabled
 * - /api/v1/status exposes a disabledFeatures array
 * - The feature-disabled response shape includes error/feature/missingEnv/disables
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readServerSource } from './helpers/server-source.js';

import { computeDisabledFeatures, featureDisabledResponse, type DisabledFeatures } from '../../src/features.js';
import type { Config } from '../../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

function makeFlags(overrides: Partial<Config> = {}): DisabledFeatures {
  return computeDisabledFeatures({
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
  });
}

describe('feature-guard helper — featureDisabledResponse', () => {
  it('returns the canonical feature_disabled envelope for macro', () => {
    const flags = makeFlags();
    const response = featureDisabledResponse(flags, 'macro');
    assert.equal(response.error, 'feature_disabled');
    assert.equal(response.feature, 'macro');
    assert.equal(response.missingEnv, 'FRED_API_KEY');
    assert.ok(response.disables.includes('macro snapshots'));
  });

  it('returns the canonical feature_disabled envelope for prices', () => {
    const response = featureDisabledResponse(makeFlags(), 'prices');
    assert.equal(response.feature, 'prices');
    assert.equal(response.missingEnv, 'COINGECKO_API_KEY');
    assert.ok(response.disables.includes('price feeds'));
  });

  it('returns the canonical feature_disabled envelope for embeddings', () => {
    const response = featureDisabledResponse(makeFlags(), 'embeddings');
    assert.equal(response.feature, 'embeddings');
    assert.equal(response.missingEnv, 'GEMINI_API_KEY');
    assert.ok(response.disables.includes('RAG chat'));
    assert.ok(response.disables.includes('semantic search'));
  });
});

describe('server-insight-routes — 503 guards', () => {
  const routesSrc = readSrc('src/server-insight-routes.ts');

  it('imports featureDisabledResponse from features.js', () => {
    assert.ok(routesSrc.includes("from './features.js'"));
    assert.ok(routesSrc.includes('featureDisabledResponse'));
  });

  it('/api/v1/macro returns 503 when macro feature is disabled', () => {
    const macroIdx = routesSrc.indexOf("'/api/v1/macro'");
    assert.ok(macroIdx !== -1);
    const slice = routesSrc.slice(macroIdx, macroIdx + 500);
    assert.match(slice, /config\.disabledFeatures\.macro\.disabled/);
    assert.match(slice, /code\(503\)/);
    assert.match(slice, /featureDisabledResponse\(config\.disabledFeatures, ['"]macro['"]\)/);
  });

  it('/api/v1/price-watch returns 503 when prices feature is disabled', () => {
    const idx = routesSrc.indexOf("'/api/v1/price-watch'");
    assert.ok(idx !== -1);
    const slice = routesSrc.slice(idx, idx + 500);
    assert.match(slice, /config\.disabledFeatures\.prices\.disabled/);
    assert.match(slice, /code\(503\)/);
    assert.match(slice, /featureDisabledResponse\(config\.disabledFeatures, ['"]prices['"]\)/);
  });

  it('/api/v1/narratives list route returns 503 when embeddings disabled', () => {
    const idx = routesSrc.indexOf("'/api/v1/narratives'");
    assert.ok(idx !== -1);
    const slice = routesSrc.slice(idx, idx + 500);
    assert.match(slice, /config\.disabledFeatures\.embeddings\.disabled/);
    assert.match(slice, /code\(503\)/);
  });

  it('/api/v1/narratives/:id drilldown route returns 503 when embeddings disabled', () => {
    const idx = routesSrc.indexOf("'/api/v1/narratives/:id'");
    assert.ok(idx !== -1);
    const slice = routesSrc.slice(idx, idx + 500);
    assert.match(slice, /config\.disabledFeatures\.embeddings\.disabled/);
    assert.match(slice, /code\(503\)/);
  });
});

describe('server.ts — 503 guards and status extension', () => {
  const serverSrc = readServerSource();

  it('imports featureDisabledResponse from features.js', () => {
    assert.ok(serverSrc.includes("from './features.js'"));
    assert.ok(serverSrc.includes('featureDisabledResponse'));
  });

  it('passes config into registerInsightRoutes', () => {
    const callIdx = serverSrc.indexOf('registerInsightRoutes({');
    assert.ok(callIdx !== -1);
    const slice = serverSrc.slice(callIdx, callIdx + 400);
    assert.match(slice, /\bconfig,/);
  });

  it('/api/v1/search?mode=semantic returns 503 when embeddings disabled', () => {
    const searchIdx = serverSrc.indexOf("'/api/v1/search'");
    assert.ok(searchIdx !== -1);
    const slice = serverSrc.slice(searchIdx, searchIdx + 2000);
    assert.match(slice, /mode === ['"]semantic['"]/);
    assert.match(slice, /config\.disabledFeatures\.embeddings\.disabled/);
    assert.match(slice, /code\(503\)/);
  });

  it('/api/v1/entities/:entityId/price returns 503 when prices disabled', () => {
    const idx = serverSrc.indexOf("'/api/v1/entities/:entityId/price'");
    assert.ok(idx !== -1);
    const slice = serverSrc.slice(idx, idx + 1500);
    assert.match(slice, /config\.disabledFeatures\.prices\.disabled/);
    assert.match(slice, /code\(503\)/);
  });

  it('/api/v1/status exposes a disabledFeatures array', () => {
    const idx = serverSrc.indexOf("'/api/v1/status'");
    assert.ok(idx !== -1);
    const slice = serverSrc.slice(idx, idx + 2000);
    assert.match(slice, /disabledFeatures/);
    assert.match(slice, /config\.disabledFeatures/);
    assert.match(slice, /missingEnv/);
  });
});
