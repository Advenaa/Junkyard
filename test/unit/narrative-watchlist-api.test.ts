/**
 * Structural regression tests for the narrative watchlist surface (Cycle 314).
 *
 * Verifies:
 * - queries.ts exports the narrative watchlist helper and reads from narratives
 * - server.ts wires the extracted insight routes module
 * - the insight route module exposes GET /api/v1/narratives and GET /api/v1/narratives/:id
 * - Settings fetches /narratives and can drill into /narratives/:id
 * - Settings renders a Narrative Watchlist card with inline summary evidence
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

describe('Narrative watchlist queries (src/db/queries.ts)', () => {
  const src = readQueriesSource();

  it('exports getNarrativeWatchlist', () => {
    assert.match(src, /export\s+async\s+function\s+getNarrativeWatchlist\s*\(/);
  });

  it('reads from the narratives table ordered by signal_strength and member_count', () => {
    assert.ok(src.includes('FROM narratives'));
    assert.ok(src.includes('signal_strength'));
    assert.ok(src.includes('member_count'));
  });

  it('exports getNarrativeDrilldownById and reads summary_ids', () => {
    assert.match(src, /export\s+async\s+function\s+getNarrativeDrilldownById\s*\(/);
    assert.ok(src.includes('summary_ids'));
    assert.ok(src.includes('WHERE id = ANY($1::text[])'));
  });
});

describe('Narrative watchlist API route (insight route module)', () => {
  const serverSrc = readServerSource();
  const routesSrc = readSrc('src/server-insight-routes.ts');

  it('server wires registerInsightRoutes', () => {
    assert.ok(serverSrc.includes('registerInsightRoutes'));
  });

  it('defines GET /api/v1/narratives', () => {
    assert.match(routesSrc, /['"]\/api\/v1\/narratives['"]/);
  });

  it('uses getNarrativeWatchlist from queries', () => {
    assert.ok(routesSrc.includes('getNarrativeWatchlist'));
  });

  it('defines GET /api/v1/narratives/:id', () => {
    assert.match(routesSrc, /['"]\/api\/v1\/narratives\/:id['"]/);
  });

  it('uses getNarrativeDrilldownById from queries', () => {
    assert.ok(routesSrc.includes('getNarrativeDrilldownById'));
    assert.ok(routesSrc.includes('Narrative not found'));
  });
});

describe('Narrative watchlist dashboard surface (dashboard/src/pages/Settings.tsx)', () => {
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

  it('fetches the narrative watchlist from /narratives', () => {
    assert.ok(src.includes("apiFetch<NarrativeWatchlistOverview>('/narratives')"));
  });

  it('renders the Narrative Watchlist card and empty state', () => {
    assert.ok(src.includes('Narrative Watchlist'));
    assert.ok(src.includes('No narrative clusters yet'));
  });

  it('explains that the labels are descriptive rather than predictions', () => {
    assert.ok(src.includes('not forward predictions'));
  });

  it('fetches narrative drilldowns from /narratives/:id', () => {
    assert.ok(src.includes('apiFetch<{ narrative: NarrativeDrilldown }>(`/narratives/${narrativeId}`)'));
  });

  it('renders inline summary evidence controls', () => {
    assert.ok(src.includes('Show summaries'));
    assert.ok(src.includes('Most recent clustered summaries'));
    assert.ok(src.includes('Open summary'));
  });
});
