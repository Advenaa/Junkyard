/**
 * Structural regression tests for the main-dashboard price watch surface (Cycle 331).
 *
 * Verifies:
 * - queries.ts exports the price watch overview helper
 * - server.ts wires the extracted insight routes module
 * - the insight route module exposes GET /api/v1/price-watch
 * - ReportView fetches /price-watch and renders a Price Watch card
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readServerSource } from './helpers/server-source.js';
import { readQueriesSource } from './helpers/queries-source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

describe('Price watch queries (src/db/queries.ts)', () => {
  const src = readQueriesSource();

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

describe('Price watch API route (insight route module)', () => {
  const serverSrc = readServerSource();
  const routesSrc = readSrc('src/server-insight-routes.ts');

  it('server wires registerInsightRoutes', () => {
    assert.ok(serverSrc.includes('registerInsightRoutes'));
  });

  it('defines GET /api/v1/price-watch', () => {
    assert.match(routesSrc, /['"]\/api\/v1\/price-watch['"]/);
  });

  it('uses getPriceWatchOverview from queries', () => {
    assert.ok(routesSrc.includes('getPriceWatchOverview'));
  });
});

describe('Price watch dashboard surface', () => {
  const reportViewSrc = readSrc('dashboard/src/pages/ReportView.tsx');
  const sectionSrc = readSrc('dashboard/src/pages/ReportView/sections/PriceWatchSection.tsx');
  const formattersSrc = readSrc('dashboard/src/pages/ReportView/formatters.tsx');

  it('ReportView fetches the price watch overview from /price-watch', () => {
    assert.match(reportViewSrc, /apiFetch<PriceWatchOverview>\(\s*['"]\/price-watch['"]\s*\)/);
  });

  it('ReportView renders PriceWatchSection', () => {
    assert.match(reportViewSrc, /<PriceWatchSection[\s\S]*?priceEntries/);
  });

  it('PriceWatchSection renders the Price Watch card and Settings handoff copy', () => {
    assert.ok(sectionSrc.includes('Price Watch'));
    assert.match(sectionSrc, /Detailed per-entity history remains in Settings[\s\S]*&gt;[\s\S]*Entities\./);
  });

  it('PriceWatchSection renders the contrarian badge using formatter helpers', () => {
    assert.ok(sectionSrc.includes('Contrarian'));
    assert.ok(sectionSrc.includes('formatPriceValue'));
    assert.ok(sectionSrc.includes('formatPriceContrarianNarrative'));
  });

  it('formatters.tsx exports the price-format helpers', () => {
    assert.match(formattersSrc, /export\s+function\s+formatPriceValue/);
    assert.match(formattersSrc, /export\s+function\s+formatPriceContrarianNarrative/);
  });
});
