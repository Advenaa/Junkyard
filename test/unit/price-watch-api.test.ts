/**
 * Structural regression tests for the main-dashboard price watch surface (Cycle 331).
 *
 * Verifies:
 * - queries.ts exports the price watch overview helper
 * - server.ts exposes GET /api/v1/price-watch
 * - ReportView fetches /price-watch and renders a Price Watch card
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

describe('Price watch queries (src/db/queries.ts)', () => {
  const src = readSrc('src/db/queries.ts');

  it('exports getPriceWatchOverview', () => {
    assert.match(src, /export\s+async\s+function\s+getPriceWatchOverview\s*\(/);
  });

  it('derives contrarian signals from price change and sentiment', () => {
    assert.ok(src.includes('derivePriceContrarianSignal'));
    assert.ok(src.includes('price-up-sentiment-down'));
    assert.ok(src.includes('price-down-sentiment-up'));
    assert.ok(src.includes('entity_sentiment_daily'));
  });
});

describe('Price watch API route (src/server.ts)', () => {
  const src = readSrc('src/server.ts');

  it('defines GET /api/v1/price-watch', () => {
    assert.match(src, /['"]\/api\/v1\/price-watch['"]/);
  });

  it('uses getPriceWatchOverview from queries', () => {
    assert.ok(src.includes('getPriceWatchOverview'));
  });
});

describe('Price watch dashboard surface (dashboard/src/pages/ReportView.tsx)', () => {
  const src = readSrc('dashboard/src/pages/ReportView.tsx');

  it('fetches the price watch overview from /price-watch', () => {
    assert.match(src, /apiFetch<PriceWatchOverview>\(\s*['"]\/price-watch['"]\s*\)/);
  });

  it('renders the Price Watch card and Settings handoff copy', () => {
    assert.ok(src.includes('Price Watch'));
    assert.match(src, /Detailed per-entity history remains in Settings[\s\S]*&gt;[\s\S]*Entities\./);
  });

  it('renders the contrarian badge and price-format helpers', () => {
    assert.ok(src.includes('Contrarian'));
    assert.ok(src.includes('formatPriceValue'));
    assert.ok(src.includes('formatPriceContrarianNarrative'));
  });
});
