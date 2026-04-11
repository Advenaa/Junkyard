/**
 * Structural regression tests for Cross-Market Correlation 3.3 API/UI surface (Cycle 288).
 *
 * Verifies:
 * - server.ts wires the extracted insight routes module
 * - the insight route module exposes GET /api/v1/macro
 * - the route module uses getLatestMacroSnapshots + buildMacroContext
 * - the route returns overallBias/latestDate and 404s when empty
 * - Settings fetches /macro and renders a Macro Backdrop card
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readServerSource } from './helpers/server-source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

describe('Macro API route (insight route module)', () => {
  const serverSrc = readServerSource();
  const routesSrc = readSrc('src/server-insight-routes.ts');

  it('server wires registerInsightRoutes', () => {
    assert.ok(serverSrc.includes('registerInsightRoutes'));
  });

  it('defines GET /api/v1/macro', () => {
    assert.match(routesSrc, /['"]\/api\/v1\/macro['"]/);
  });

  it('imports getLatestMacroSnapshots from queries', () => {
    assert.ok(routesSrc.includes('getLatestMacroSnapshots'));
  });

  it('imports buildMacroContext from macro/context', () => {
    assert.ok(routesSrc.includes("from './macro/context.js'"));
    assert.ok(routesSrc.includes('buildMacroContext'));
  });

  it('returns 404 when no macro data is available', () => {
    assert.ok(routesSrc.includes('No macro data available yet'));
  });

  it('returns overallBias and latestDate fields', () => {
    assert.ok(routesSrc.includes('overallBias'));
    assert.ok(routesSrc.includes('latestDate'));
  });
});

describe('Macro dashboard surface (dashboard/src/pages/Settings.tsx)', () => {
  const src = readSrc('dashboard/src/pages/Settings.tsx');

  it('fetches macro overview data from /macro', () => {
    assert.ok(src.includes("apiFetch<MacroOverview>('/macro')"));
  });

  it('renders Macro Backdrop heading', () => {
    assert.ok(src.includes('Macro Backdrop'));
  });

  it('renders No macro snapshots yet empty state', () => {
    assert.ok(src.includes('No macro snapshots yet'));
  });
});
