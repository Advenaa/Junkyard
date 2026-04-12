/**
 * Structural regression tests for R.1 unusual-activity heuristics (Cycle 298).
 *
 * Verifies:
 * - queries.ts exports the overview helper and uses entity_sentiment_daily baselines
 * - server.ts wires the extracted insight routes module
 * - the insight route module exposes GET /api/v1/unusual-activity
 * - Settings fetches /unusual-activity and renders an Unusual Activity card
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

describe('Unusual activity queries (src/db/queries.ts)', () => {
  const src = readQueriesSource();

  it('exports getUnusualActivityOverview', () => {
    assert.match(src, /export\s+async\s+function\s+getUnusualActivityOverview\s*\(/);
  });

  it('computes baselines from entity_sentiment_daily', () => {
    assert.ok(src.includes('entity_sentiment_daily'));
    assert.ok(src.includes('AVG(mention_count)'));
    assert.ok(src.includes('baseline_mentions'));
    assert.ok(src.includes('spike_ratio'));
  });

  it('joins entity relevance for low-relevance breakout bias', () => {
    assert.ok(src.includes('e.relevance AS relevance_score'));
    assert.ok(src.includes('lowRelevance'));
  });
});

describe('Unusual activity API route (insight route module)', () => {
  const serverSrc = readServerSource();
  const routesSrc = readSrc('src/server-insight-routes.ts');

  it('server wires registerInsightRoutes', () => {
    assert.ok(serverSrc.includes('registerInsightRoutes'));
  });

  it('defines GET /api/v1/unusual-activity', () => {
    assert.match(routesSrc, /['"]\/api\/v1\/unusual-activity['"]/);
  });

  it('uses getUnusualActivityOverview from queries', () => {
    assert.ok(routesSrc.includes('getUnusualActivityOverview'));
  });
});

describe('Unusual activity dashboard surface (dashboard/src/pages/Settings.tsx)', () => {
  const src = [
    readSrc('dashboard/src/pages/Settings/index.tsx'),
    readSrc('dashboard/src/pages/Settings/SourcesTab.tsx'),
    readSrc('dashboard/src/pages/Settings/DeliveryTab.tsx'),
    readSrc('dashboard/src/pages/Settings/PipelineTab.tsx'),
    readSrc('dashboard/src/pages/Settings/EntitiesTab.tsx'),
    readSrc('dashboard/src/pages/Settings/UsersTab.tsx'),
    readSrc('dashboard/src/pages/Settings/types.ts'),
    readSrc('dashboard/src/pages/Settings/api.ts'),
    readSrc('dashboard/src/pages/Settings/formatters.ts'),
  ].join('\n');

  it('fetches unusual activity from /unusual-activity', () => {
    assert.ok(src.includes("apiFetch<UnusualActivityOverview>('/unusual-activity')"));
  });

  it('renders the Unusual Activity card and empty state', () => {
    assert.ok(src.includes('Unusual Activity'));
    assert.ok(src.includes('No unusual activity on the latest rollup'));
  });

  it('highlights lower-relevance breakouts in the watchlist copy', () => {
    assert.ok(src.includes('lower-relevance entities'));
    assert.ok(src.includes('low relevance'));
  });
});
