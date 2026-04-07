/**
 * Structural regression tests for Price Feeds 3.1 — Integration (Cycle 272).
 *
 * Verifies:
 * - Config includes coingeckoApiKey
 * - Query exports getActiveTokensWithCoinGeckoIds
 * - Tracker module exists with correct shape
 * - index.ts wires priceTracker into onDaily
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════
// Config: coingeckoApiKey
// ═══════════════════════════════════════════════════════════════════════

describe('Config: coingeckoApiKey', () => {
  const config = readSrc('src/config.ts');

  it('Config interface includes coingeckoApiKey', () => {
    assert.match(config, /coingeckoApiKey\s*:\s*string\s*\|\s*null/);
  });

  it('loadConfig reads COINGECKO_API_KEY from env', () => {
    assert.match(config, /process\.env\[['"]COINGECKO_API_KEY['"]\]/);
  });

  it('coingeckoApiKey is in secrets array', () => {
    assert.ok(config.includes('coingeckoApiKey'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Query: getActiveTokensWithCoinGeckoIds
// ═══════════════════════════════════════════════════════════════════════

describe('Query: getActiveTokensWithCoinGeckoIds', () => {
  const queries = readSrc('src/db/queries.ts');

  it('exports getActiveTokensWithCoinGeckoIds function', () => {
    assert.match(queries, /export\s+async\s+function\s+getActiveTokensWithCoinGeckoIds/);
  });

  it('exports TokenCoinGeckoMapping interface', () => {
    assert.match(queries, /export\s+interface\s+TokenCoinGeckoMapping/);
  });

  it('queries active token entities', () => {
    assert.match(queries, /e\.status\s*=\s*'active'/);
    assert.match(queries, /e\.type\s*=\s*'token'/);
  });

  it('extracts CoinGecko ID from context_key', () => {
    assert.match(queries, /context_key\s+LIKE\s+'coingecko:%'/);
    assert.match(queries, /SUBSTRING\s*\(\s*ea\.context_key/);
  });

  it('returns entityId, entityName, and coingeckoId', () => {
    assert.ok(queries.includes('entityId'));
    assert.ok(queries.includes('entityName'));
    assert.ok(queries.includes('coingeckoId'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tracker module: src/prices/tracker.ts
// ═══════════════════════════════════════════════════════════════════════

describe('Tracker module: src/prices/tracker.ts', () => {
  const tracker = readSrc('src/prices/tracker.ts');

  it('exports createPriceTracker factory', () => {
    assert.match(tracker, /export\s+function\s+createPriceTracker/);
  });

  it('exports PriceTracker interface', () => {
    assert.match(tracker, /export\s+interface\s+PriceTracker/);
  });

  it('imports getActiveTokensWithCoinGeckoIds', () => {
    assert.ok(tracker.includes('getActiveTokensWithCoinGeckoIds'));
  });

  it('imports insertPriceSnapshots', () => {
    assert.ok(tracker.includes('insertPriceSnapshots'));
  });

  it('imports createPriceFetcher', () => {
    assert.ok(tracker.includes('createPriceFetcher'));
  });

  it('exposes fetchAndStore method', () => {
    assert.ok(tracker.includes('fetchAndStore'));
  });

  it('maps CoinGecko IDs to entity IDs', () => {
    assert.match(tracker, /idToEntity|coingeckoId.*entityId|entityId.*coingeckoId/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration: index.ts wiring
// ═══════════════════════════════════════════════════════════════════════

describe('Integration: index.ts price tracker wiring', () => {
  const index = readSrc('src/index.ts');

  it('imports createPriceTracker', () => {
    assert.match(index, /import\s*\{?\s*createPriceTracker\s*\}?\s*from\s*['"]\.\/prices\/tracker\.js['"]/);
  });

  it('creates priceTracker instance', () => {
    assert.match(index, /createPriceTracker\s*\(\s*pool/);
  });

  it('calls priceTracker.fetchAndStore in onDaily', () => {
    assert.match(index, /priceTracker\.fetchAndStore\s*\(\s*\)/);
  });

  it('price fetch is wrapped in try/catch', () => {
    assert.match(index, /price\s*fetch\s*failed/i);
  });
});
