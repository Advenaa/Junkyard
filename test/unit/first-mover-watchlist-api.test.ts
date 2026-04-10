/**
 * Structural regression tests for the first-mover watchlist surface (Cycle 324).
 *
 * Verifies:
 * - queries.ts exports the recent first-mover watchlist helper
 * - server.ts wires the extracted insight routes module
 * - the insight route module exposes GET /api/v1/first-movers
 * - ReportView fetches /first-movers and renders a First Mover Watch card
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

describe('First-mover watchlist queries (src/db/queries.ts)', () => {
  const src = readSrc('src/db/queries.ts');

  it('exports getRecentFirstMoverWatchlist', () => {
    assert.match(src, /export\s+async\s+function\s+getRecentFirstMoverWatchlist\s*\(/);
  });

  it('reads from author_calls and selects reviewed-outcome counts for the watchlist', () => {
    assert.ok(src.includes('FROM author_calls'));
    assert.ok(src.includes('credibility_score'));
    assert.ok(src.includes('total_calls'));
    assert.ok(src.includes('correct_calls'));
    assert.ok(src.includes('entity_rank = 1'));
  });
});

describe('First-mover watchlist API route (insight route module)', () => {
  const serverSrc = readSrc('src/server.ts');
  const routesSrc = readSrc('src/server-insight-routes.ts');

  it('server wires registerInsightRoutes', () => {
    assert.ok(serverSrc.includes('registerInsightRoutes'));
  });

  it('defines GET /api/v1/first-movers', () => {
    assert.match(routesSrc, /['"]\/api\/v1\/first-movers['"]/);
  });

  it('uses getRecentFirstMoverWatchlist from queries', () => {
    assert.ok(routesSrc.includes('getRecentFirstMoverWatchlist'));
  });
});

describe('First-mover watchlist dashboard surface', () => {
  const reportViewSrc = readSrc('dashboard/src/pages/ReportView.tsx');
  const sectionSrc = readSrc('dashboard/src/pages/ReportView/sections/FirstMoverSection.tsx');
  const formattersSrc = readSrc('dashboard/src/pages/ReportView/formatters.tsx');

  it('ReportView fetches the first-mover watchlist from /first-movers', () => {
    assert.ok(reportViewSrc.includes("apiFetch<FirstMoverWatchlistOverview>('/first-movers')"));
  });

  it('ReportView renders FirstMoverSection', () => {
    assert.match(reportViewSrc, /<FirstMoverSection[\s\S]*?firstMoverEntries/);
  });

  it('FirstMoverSection renders the First Mover Watch card and Settings handoff copy', () => {
    assert.ok(sectionSrc.includes('First Mover Watch'));
    assert.ok(sectionSrc.includes('Detailed author timing and review history remain in'));
  });

  it('formatters.tsx exposes lead-window and reviewed-outcome helpers', () => {
    assert.ok(formattersSrc.includes('solo tracked call'));
    assert.ok(formattersSrc.includes('reviewed correct'));
  });
});
