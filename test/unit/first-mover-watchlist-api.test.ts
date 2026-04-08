/**
 * Structural regression tests for the first-mover watchlist surface (Cycle 324).
 *
 * Verifies:
 * - queries.ts exports the recent first-mover watchlist helper
 * - server.ts exposes GET /api/v1/first-movers
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

describe('First-mover watchlist API route (src/server.ts)', () => {
  const src = readSrc('src/server.ts');

  it('defines GET /api/v1/first-movers', () => {
    assert.match(src, /['"]\/api\/v1\/first-movers['"]/);
  });

  it('uses getRecentFirstMoverWatchlist from queries', () => {
    assert.ok(src.includes('getRecentFirstMoverWatchlist'));
  });
});

describe('First-mover watchlist dashboard surface (dashboard/src/pages/ReportView.tsx)', () => {
  const src = readSrc('dashboard/src/pages/ReportView.tsx');

  it('fetches the first-mover watchlist from /first-movers', () => {
    assert.ok(src.includes("apiFetch<FirstMoverWatchlistOverview>('/first-movers')"));
  });

  it('renders the First Mover Watch card and Settings handoff copy', () => {
    assert.ok(src.includes('First Mover Watch'));
    assert.ok(src.includes('Detailed author timing and review history remain in'));
  });

  it('renders lead-window and reviewed-outcome helpers for first-mover entries', () => {
    assert.ok(src.includes('solo tracked call'));
    assert.ok(src.includes('reviewed correct'));
  });
});
