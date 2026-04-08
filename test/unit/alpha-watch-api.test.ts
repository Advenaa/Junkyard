/**
 * Structural regression tests for the alpha watch surface (Cycle 357).
 *
 * Verifies:
 * - queries.ts exports the alpha watch overview helper
 * - server.ts exposes GET /api/v1/alpha-watch
 * - ReportView fetches /alpha-watch and renders an Alpha Watch card
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

describe('Alpha watch queries (src/db/queries.ts)', () => {
  const src = readSrc('src/db/queries.ts');

  it('exports getRecentAlphaWatchlist', () => {
    assert.match(src, /export\s+async\s+function\s+getRecentAlphaWatchlist\s*\(/);
  });

  it('reads from alpha_propagation and filters higher-tier source signals', () => {
    assert.ok(src.includes('FROM alpha_propagation ap'));
    assert.ok(src.includes("tier IN ('alpha', 'influencer')"));
    assert.ok(src.includes('first_signal_tier'));
  });
});

describe('Alpha watch API route (src/server.ts)', () => {
  const src = readSrc('src/server.ts');

  it('defines GET /api/v1/alpha-watch', () => {
    assert.match(src, /['"]\/api\/v1\/alpha-watch['"]/);
  });

  it('uses getRecentAlphaWatchlist from queries', () => {
    assert.ok(src.includes('getRecentAlphaWatchlist'));
  });
});

describe('Alpha watch dashboard surface (dashboard/src/pages/ReportView.tsx)', () => {
  const src = readSrc('dashboard/src/pages/ReportView.tsx');

  it('fetches the alpha watch overview from /alpha-watch', () => {
    assert.ok(src.includes("apiFetch<AlphaWatchOverview>('/alpha-watch')"));
  });

  it('renders the Alpha Watch card and Settings handoff copy', () => {
    assert.ok(src.includes('Alpha Watch'));
    assert.match(src, /Detailed per-entity tier timelines remain in[\s\S]*Settings[\s\S]*&gt;[\s\S]*Entities\./);
  });

  it('renders tier badges and propagation-speed copy for alpha-watch entries', () => {
    assert.ok(src.includes('first {formatSourceTierLabel(entry.firstSignalTier)}'));
    assert.ok(src.includes('spread {formatCompactDuration(entry.propagationLagMs)}'));
  });
});
