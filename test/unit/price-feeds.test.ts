/**
 * Structural regression tests for Price Feeds foundation (feature 3.1).
 *
 * Reads source files as strings and verifies:
 * - Migration 27 creates price_snapshots table with correct schema
 * - CoinGecko module exports createPriceFetcher, uses correct API, handles errors
 * - Price snapshot query functions exist and are exported in queries.ts
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
// migrations.ts — Migration 27: price_snapshots table
// ═══════════════════════════════════════════════════════════════════════

describe('Price Feeds migration (src/db/migrations.ts)', () => {
  const src = readSrc('src/db/migrations.ts');

  it('migration creates price_snapshots table', () => {
    assert.match(
      src,
      /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?price_snapshots\s*\(/i,
      'Migration must CREATE TABLE price_snapshots',
    );
  });

  it('price_snapshots has entity_id column with REFERENCES to entities', () => {
    // Extract the CREATE TABLE block for price_snapshots
    const tableStart = src.indexOf('price_snapshots');
    assert.ok(tableStart !== -1, 'price_snapshots table must exist');
    const tableSlice = src.slice(tableStart, tableStart + 800);

    assert.ok(
      /entity_id\s+TEXT\s+.*REFERENCES\s+entities/i.test(tableSlice),
      'price_snapshots must have entity_id TEXT column with REFERENCES entities',
    );
  });

  it('price_snapshots has price_usd REAL column', () => {
    const tableStart = src.indexOf('price_snapshots');
    assert.ok(tableStart !== -1, 'price_snapshots table must exist');
    const tableSlice = src.slice(tableStart, tableStart + 800);

    assert.match(tableSlice, /price_usd\s+REAL/i, 'price_snapshots must have price_usd REAL column');
  });

  it('price_snapshots has timestamp BIGINT column', () => {
    const tableStart = src.indexOf('price_snapshots');
    assert.ok(tableStart !== -1, 'price_snapshots table must exist');
    const tableSlice = src.slice(tableStart, tableStart + 800);

    assert.match(tableSlice, /timestamp\s+BIGINT/i, 'price_snapshots must have timestamp BIGINT column');
  });

  it('indexes exist on (entity_id, timestamp) and (timestamp)', () => {
    // Look for composite index on entity_id + timestamp
    assert.match(
      src,
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+price_snapshots\s*\(\s*entity_id\s*,\s*timestamp/i,
      'Must have an index on price_snapshots(entity_id, timestamp)',
    );

    // Look for standalone timestamp index
    assert.match(
      src,
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+price_snapshots\s*\(\s*timestamp/i,
      'Must have an index on price_snapshots(timestamp)',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// coingecko.ts — CoinGecko price fetcher module
// ═══════════════════════════════════════════════════════════════════════

describe('CoinGecko module (src/prices/coingecko.ts)', () => {
  const src = readSrc('src/prices/coingecko.ts');

  it('exports createPriceFetcher', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+createPriceFetcher|export\s+(const|let)\s+createPriceFetcher/,
      'coingecko.ts must export createPriceFetcher',
    );
  });

  it('exports PriceData type', () => {
    assert.match(
      src,
      /export\s+(interface|type)\s+PriceData\b/,
      'coingecko.ts must export PriceData type or interface',
    );
  });

  it('uses CoinGecko API URL (api.coingecko.com)', () => {
    assert.ok(src.includes('api.coingecko.com'), 'coingecko.ts must reference api.coingecko.com');
  });

  it('requests include vs_currencies=usd', () => {
    assert.ok(
      src.includes('vs_currencies=usd') || src.includes('vs_currencies'),
      'coingecko.ts must include vs_currencies=usd in API requests',
    );
  });

  it('handles errors gracefully (try/catch or .catch pattern)', () => {
    assert.ok(
      src.includes('catch') || src.includes('.catch'),
      'coingecko.ts must handle errors with try/catch or .catch',
    );
  });

  it('returns a Map (Map<string, PriceData>)', () => {
    assert.ok(
      /Map\s*<\s*string\s*,\s*PriceData\s*>/.test(src) || src.includes('new Map'),
      'coingecko.ts must return a Map<string, PriceData>',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// queries.ts — price snapshot query functions
// ═══════════════════════════════════════════════════════════════════════

describe('Price snapshot queries (src/db/queries.ts)', () => {
  const src = readSrc('src/db/queries.ts');

  it('PriceSnapshotRow type is exported', () => {
    assert.match(
      src,
      /export\s+(interface|type)\s+PriceSnapshotRow\b/,
      'PriceSnapshotRow must be an exported type or interface',
    );
  });

  it('insertPriceSnapshot function exists and is exported', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+insertPriceSnapshot\s*\(/,
      'insertPriceSnapshot must be an exported function',
    );
  });

  it('insertPriceSnapshots function exists (batch insert)', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+insertPriceSnapshots\s*\(/,
      'insertPriceSnapshots must be an exported function (batch insert)',
    );
  });

  it('getLatestPriceSnapshot function exists', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+getLatestPriceSnapshot\s*\(/,
      'getLatestPriceSnapshot must be an exported function',
    );
  });

  it('getPriceHistory function exists with ORDER BY timestamp DESC', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+getPriceHistory\s*\(/,
      'getPriceHistory must be an exported function',
    );

    const fnStart = src.indexOf('function getPriceHistory');
    assert.ok(fnStart !== -1, 'getPriceHistory must exist');
    const fnSlice = src.slice(fnStart, fnStart + 1500);

    assert.match(fnSlice, /ORDER\s+BY\s+timestamp\s+DESC/i, 'getPriceHistory must ORDER BY timestamp DESC');
  });

  it('getLatestPricesForEntities uses DISTINCT ON or equivalent dedup', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+getLatestPricesForEntities\s*\(/,
      'getLatestPricesForEntities must be an exported function',
    );

    const fnStart = src.indexOf('function getLatestPricesForEntities');
    assert.ok(fnStart !== -1, 'getLatestPricesForEntities must exist');
    const fnSlice = src.slice(fnStart, fnStart + 1500);

    assert.ok(
      /DISTINCT\s+ON/i.test(fnSlice) || /ROW_NUMBER|RANK/i.test(fnSlice) || /GROUP\s+BY/i.test(fnSlice),
      'getLatestPricesForEntities must use DISTINCT ON (or equivalent) for per-entity dedup',
    );
  });
});
