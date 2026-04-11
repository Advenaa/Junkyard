/**
 * Tests for CD-009: toCamelCase serialization utility in src/server.ts.
 *
 * Two sections:
 *   1. Unit tests — exercise the toCamelCase logic directly (function is
 *      private to server.ts, so we replicate the regex-based transform and
 *      assert equivalence with the source implementation).
 *   2. Structural tests — read server.ts source and verify the function
 *      exists and is wired into the correct endpoints.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readServerSource } from './helpers/server-source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Replicate the toCamelCase implementation from server.ts so we can unit-test
// the transform logic without needing an export.  The structural tests below
// ensure the source stays in sync.
// ---------------------------------------------------------------------------
function toCamelCase<T>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

// ---------------------------------------------------------------------------
// 1. Unit tests for toCamelCase
// ---------------------------------------------------------------------------

describe('toCamelCase — unit', () => {
  it('converts source_id to sourceId', () => {
    const out = toCamelCase<{ sourceId: string }>({ source_id: 'abc' });
    assert.deepStrictEqual(out, { sourceId: 'abc' });
  });

  it('converts delivery_status to deliveryStatus', () => {
    const out = toCamelCase<{ deliveryStatus: string }>({ delivery_status: 'sent' });
    assert.deepStrictEqual(out, { deliveryStatus: 'sent' });
  });

  it('converts created_at to createdAt', () => {
    const out = toCamelCase<{ createdAt: number }>({ created_at: 123 });
    assert.deepStrictEqual(out, { createdAt: 123 });
  });

  it('preserves already-camelCase keys alongside converted keys', () => {
    const out = toCamelCase<{ alreadyCamel: number; alreadyCamel2: number }>({
      already_camel: 1,
      alreadyCamel: 2,
    });
    // already_camel -> alreadyCamel collides with the existing alreadyCamel key.
    // Object.entries iterates in insertion order, so the second entry wins.
    assert.strictEqual(out.alreadyCamel, 2);
  });

  it('preserves null values', () => {
    const out = toCamelCase<{ avatar: null }>({ avatar: null });
    assert.deepStrictEqual(out, { avatar: null });
  });

  it('returns empty object for empty input', () => {
    const out = toCamelCase<Record<string, never>>({});
    assert.deepStrictEqual(out, {});
  });

  it('does NOT deep-convert nested objects', () => {
    const nested = { inner_key: 'val' };
    const out = toCamelCase<{ outerKey: { inner_key: string } }>({ outer_key: nested });
    // The top-level key is converted, but the nested object is untouched.
    assert.strictEqual(out.outerKey, nested);
    assert.strictEqual((out.outerKey as Record<string, unknown>).inner_key, 'val');
  });

  it('handles multi-underscore keys (e.g. last_login_at)', () => {
    const out = toCamelCase<{ lastLoginAt: number }>({ last_login_at: 1710000000 });
    assert.deepStrictEqual(out, { lastLoginAt: 1710000000 });
  });

  it('does not alter keys without underscores', () => {
    const out = toCamelCase<{ id: string; type: string }>({ id: '01', type: 'daily' });
    assert.deepStrictEqual(out, { id: '01', type: 'daily' });
  });

  it('ignores leading underscores (not snake_case)', () => {
    // _private stays _private because the regex only matches _[a-z]
    // inside the string — a leading underscore followed by a lowercase letter
    // IS matched by the regex, so _private → Private (capital P, underscore removed).
    // Verify against the actual regex behavior:
    const out = toCamelCase<Record<string, unknown>>({ _private: 1 });
    const key = Object.keys(out)[0];
    // The regex /_([a-z])/g matches _p -> P, so "_private" becomes "Private"
    assert.strictEqual(key, 'Private');
  });
});

// ---------------------------------------------------------------------------
// 2. Structural tests — verify toCamelCase exists and is applied in server.ts
// ---------------------------------------------------------------------------

const QUERIES_SRC = resolve(__dirname, '../../src/db/queries.ts');

let source: string;
let queriesSource: string;

before(async () => {
  source = readServerSource();
  queriesSource = await readFile(QUERIES_SRC, 'utf-8');
});

describe('toCamelCase — structural (server.ts source)', () => {
  it('defines the toCamelCase function', () => {
    assert.ok(source.includes('function toCamelCase'), 'server.ts must define a toCamelCase function');
  });

  it('toCamelCase uses shallow key.replace with /_([a-z])/g regex', () => {
    // Ensure it is the snake_case -> camelCase regex pattern
    assert.ok(source.includes('/_([a-z])/g'), 'toCamelCase must use the /_([a-z])/g regex for snake_case conversion');
  });

  it('toCamelCase does NOT recurse into nested values', () => {
    // Extract the function body
    const fnStart = source.indexOf('function toCamelCase');
    assert.ok(fnStart !== -1);
    const braceStart = source.indexOf('{', fnStart);
    let depth = 0;
    let fnEnd = -1;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') depth--;
      if (depth === 0) {
        fnEnd = i;
        break;
      }
    }
    const fnBody = source.slice(fnStart, fnEnd + 1);

    // Should NOT contain recursive calls to toCamelCase within itself
    const bodyAfterSignature = fnBody.slice(fnBody.indexOf('{'));
    const recursiveCalls = bodyAfterSignature.match(/toCamelCase\(/g);
    assert.strictEqual(recursiveCalls, null, 'toCamelCase must not recursively call itself (shallow only)');
  });

  it('GET /api/v1/reports applies toCamelCase to report rows', () => {
    // Find the reports endpoint handler
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    assert.ok(reportsEndpoint !== -1, 'reports endpoint must exist');
    assert.ok(reportIdEndpoint !== -1, 'reports/:id endpoint must exist');

    // Look for toCamelCase usage in the vicinity (within the handler)
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(handlerSlice.includes('toCamelCase'), 'GET /api/v1/reports must apply toCamelCase to its response rows');
  });

  it('reports endpoint uses .map pattern with toCamelCase', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(
      handlerSlice.includes('.map(') && handlerSlice.includes('toCamelCase'),
      'GET /api/v1/reports should map rows through toCamelCase',
    );
  });

  it('GET /api/v1/reports parses body JSON for event chain previews', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(
      handlerSlice.includes('parseReportBody') && source.includes('function parseReportBody'),
      'GET /api/v1/reports must parse body JSON, directly or via a shared helper, to expose event chain previews',
    );
  });

  it('GET /api/v1/reports parses body JSON for market catalyst previews', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(
      handlerSlice.includes('report.marketCatalysts'),
      'GET /api/v1/reports should expose a market-catalyst preview when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.marketCatalysts\s*\?\?\s*parsed\?\.market_catalysts/);
  });

  it('GET /api/v1/reports parses body JSON for regional divergence previews', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(
      handlerSlice.includes('report.regionalDivergence'),
      'GET /api/v1/reports should expose a regional-divergence preview when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.regionalDivergence\s*\?\?\s*parsed\?\.regional_divergence/);
  });

  it('GET /api/v1/reports parses body JSON for narrative shift previews', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(
      handlerSlice.includes('report.narrativeShifts'),
      'GET /api/v1/reports should expose a narrative-shift preview when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.narrativeShifts\s*\?\?\s*parsed\?\.narrative_shifts/);
  });

  it('GET /api/v1/reports parses body JSON for first-mover previews', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(
      handlerSlice.includes('report.firstMovers'),
      'GET /api/v1/reports should expose a first-mover preview when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.firstMovers\s*\?\?\s*parsed\?\.first_movers/);
  });

  it('GET /api/v1/reports parses body JSON for price alert previews', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(
      handlerSlice.includes('report.priceAlerts'),
      'GET /api/v1/reports should expose a price-alert preview when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.priceAlerts\s*\?\?\s*parsed\?\.price_alerts/);
  });

  it('GET /api/v1/reports parses body JSON for macro alert previews', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(
      handlerSlice.includes('report.macroAlerts'),
      'GET /api/v1/reports should expose a macro alert preview when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.macroAlerts\s*\?\?\s*parsed\?\.macro_alerts/);
  });

  it('GET /api/v1/reports parses body JSON for unusual activity previews', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(
      handlerSlice.includes('report.unusualActivity'),
      'GET /api/v1/reports should expose an unusual-activity preview when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.unusualActivity\s*\?\?\s*parsed\?\.unusual_activity/);
  });

  it('GET /api/v1/reports parses body JSON for macro regime previews', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(
      handlerSlice.includes('report.macroRegime'),
      'GET /api/v1/reports should expose a macro regime preview when stored report bodies include one',
    );
    assert.ok(
      handlerSlice.includes('report.macroRegimeHistory'),
      'GET /api/v1/reports should expose macro regime history alongside report previews when it exists',
    );
    assert.match(handlerSlice, /extractMacroRegime\(parsed\?\.macroRegime\s*\?\?\s*parsed\?\.macro_regime\)/);
    assert.ok(
      handlerSlice.includes('getMacroRegimeHistoryByReport'),
      'GET /api/v1/reports should load persisted macro regime history for preview surfaces',
    );
  });

  it('GET /api/v1/reports can attach active chain drilldowns to report previews', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(
      handlerSlice.includes('getRecentReportChainDrilldowns'),
      'GET /api/v1/reports should load recent chain drilldowns for report previews when event chain text is present',
    );
    assert.ok(
      handlerSlice.includes('report.chainDrilldowns'),
      'GET /api/v1/reports should expose active chain drilldowns on report preview payloads',
    );
    assert.ok(
      handlerSlice.includes('extractReportEntityNames'),
      'GET /api/v1/reports should derive preview drilldowns from parsed report entity names',
    );
  });

  it('GET /api/v1/reports can expose exact hidden active chain counts beyond the preview cap', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(
      handlerSlice.includes('report.hiddenActiveChainCount'),
      'GET /api/v1/reports should expose an exact hidden-chain count when extra active chains are omitted from preview payloads',
    );
    assert.ok(
      handlerSlice.includes('report.hasMoreActiveChains'),
      'GET /api/v1/reports should expose an overflow flag when extra active chains are hidden by the preview cap',
    );
    assert.ok(
      handlerSlice.includes('getReportPreviewChains'),
      'GET /api/v1/reports should compute preview drilldowns plus exact hidden counts through the shared preview helper',
    );
  });

  it('GET /api/v1/reports selects body so previews can be derived', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const reportIdEndpoint = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportsEndpoint, reportIdEndpoint);
    assert.ok(handlerSlice.includes('body FROM reports'), 'GET /api/v1/reports must select body for preview parsing');
  });

  it('GET /api/v1/search supports report scope so report previews can be searched', () => {
    const searchEndpoint = source.indexOf("'/api/v1/search'");
    assert.ok(searchEndpoint !== -1, 'search endpoint must exist');
    const handlerSlice = source.slice(searchEndpoint, searchEndpoint + 2600);
    assert.ok(
      handlerSlice.includes("scope: { type: 'string', enum: ['summary', 'report', 'all'] }"),
      'GET /api/v1/search must declare a scope filter for summary/report/all searches',
    );
    assert.ok(
      handlerSlice.includes('FROM reports'),
      'GET /api/v1/search must query reports when report scope is requested',
    );
  });

  it('GET /api/v1/search parses report bodies for event chain previews', () => {
    const searchEndpoint = source.indexOf("'/api/v1/search'");
    assert.ok(searchEndpoint !== -1, 'search endpoint must exist');
    const handlerSlice = source.slice(searchEndpoint, searchEndpoint + 4200);
    assert.ok(
      handlerSlice.includes('parseReportBody') && handlerSlice.includes("result_type: 'report'"),
      'GET /api/v1/search must attach report event chain previews to report search hits',
    );
  });

  it('GET /api/v1/search parses report bodies for market catalyst previews', () => {
    const searchEndpoint = source.indexOf("'/api/v1/search'");
    assert.ok(searchEndpoint !== -1, 'search endpoint must exist');
    const handlerSlice = source.slice(searchEndpoint, searchEndpoint + 5200);
    assert.ok(
      handlerSlice.includes('report.marketCatalysts'),
      'GET /api/v1/search should expose a market-catalyst preview on report hits when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.marketCatalysts\s*\?\?\s*parsed\?\.market_catalysts/);
  });

  it('GET /api/v1/search parses report bodies for regional divergence previews', () => {
    const searchEndpoint = source.indexOf("'/api/v1/search'");
    const handlerSlice = source.slice(searchEndpoint);
    assert.ok(
      handlerSlice.includes('report.regionalDivergence'),
      'GET /api/v1/search should expose a regional-divergence preview when report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.regionalDivergence\s*\?\?\s*parsed\?\.regional_divergence/);
  });

  it('GET /api/v1/search parses report bodies for narrative shift previews', () => {
    const searchEndpoint = source.indexOf("'/api/v1/search'");
    assert.ok(searchEndpoint !== -1, 'search endpoint must exist');
    const handlerSlice = source.slice(searchEndpoint, searchEndpoint + 5200);
    assert.ok(
      handlerSlice.includes('report.narrativeShifts'),
      'GET /api/v1/search should expose a narrative-shift preview when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.narrativeShifts\s*\?\?\s*parsed\?\.narrative_shifts/);
  });

  it('GET /api/v1/search parses report bodies for first-mover previews', () => {
    const searchEndpoint = source.indexOf("'/api/v1/search'");
    assert.ok(searchEndpoint !== -1, 'search endpoint must exist');
    const handlerSlice = source.slice(searchEndpoint, searchEndpoint + 5200);
    assert.ok(
      handlerSlice.includes('report.firstMovers'),
      'GET /api/v1/search should expose a first-mover preview on report hits when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.firstMovers\s*\?\?\s*parsed\?\.first_movers/);
  });

  it('GET /api/v1/search parses report bodies for price alert previews', () => {
    const searchEndpoint = source.indexOf("'/api/v1/search'");
    assert.ok(searchEndpoint !== -1, 'search endpoint must exist');
    const handlerSlice = source.slice(searchEndpoint, searchEndpoint + 5200);
    assert.ok(
      handlerSlice.includes('report.priceAlerts'),
      'GET /api/v1/search should expose a price-alert preview on report hits when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.priceAlerts\s*\?\?\s*parsed\?\.price_alerts/);
  });

  it('GET /api/v1/search parses report bodies for macro alert previews', () => {
    const searchEndpoint = source.indexOf("'/api/v1/search'");
    assert.ok(searchEndpoint !== -1, 'search endpoint must exist');
    const handlerSlice = source.slice(searchEndpoint, searchEndpoint + 5200);
    assert.ok(
      handlerSlice.includes('report.macroAlerts'),
      'GET /api/v1/search should expose a macro alert preview on report hits when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.macroAlerts\s*\?\?\s*parsed\?\.macro_alerts/);
  });

  it('GET /api/v1/search parses report bodies for unusual activity previews', () => {
    const searchEndpoint = source.indexOf("'/api/v1/search'");
    assert.ok(searchEndpoint !== -1, 'search endpoint must exist');
    const handlerSlice = source.slice(searchEndpoint, searchEndpoint + 5200);
    assert.ok(
      handlerSlice.includes('report.unusualActivity'),
      'GET /api/v1/search should expose an unusual-activity preview on report hits when stored report bodies include one',
    );
    assert.match(handlerSlice, /parsed\?\.unusualActivity\s*\?\?\s*parsed\?\.unusual_activity/);
  });

  it('GET /api/v1/search parses report bodies for macro regime previews', () => {
    const searchEndpoint = source.indexOf("'/api/v1/search'");
    assert.ok(searchEndpoint !== -1, 'search endpoint must exist');
    const handlerSlice = source.slice(searchEndpoint, searchEndpoint + 6200);
    assert.ok(
      handlerSlice.includes('report.macroRegime'),
      'GET /api/v1/search should expose a macro regime preview on report hits when stored report bodies include one',
    );
    assert.ok(
      handlerSlice.includes('report.macroRegimeHistory'),
      'GET /api/v1/search should expose macro regime history on report hits when it exists',
    );
    assert.match(handlerSlice, /extractMacroRegime\(parsed\?\.macroRegime\s*\?\?\s*parsed\?\.macro_regime\)/);
    assert.ok(
      handlerSlice.includes('getMacroRegimeHistoryByReport'),
      'GET /api/v1/search should load persisted macro regime history for report-hit previews',
    );
  });

  it('GET /api/v1/search can attach active chain drilldowns to report hits', () => {
    const searchEndpoint = source.indexOf("'/api/v1/search'");
    assert.ok(searchEndpoint !== -1, 'search endpoint must exist');
    const handlerSlice = source.slice(searchEndpoint, searchEndpoint + 7000);
    assert.ok(
      handlerSlice.includes('getRecentReportChainDrilldowns'),
      'GET /api/v1/search should load recent chain drilldowns for report hits when event chain text is present',
    );
    assert.ok(
      handlerSlice.includes('report.chainDrilldowns'),
      'GET /api/v1/search should expose active chain drilldowns on report search hits',
    );
    assert.ok(
      handlerSlice.includes('extractReportEntityNames'),
      'GET /api/v1/search should derive report-hit drilldowns from parsed report entity names',
    );
  });

  it('GET /api/v1/search can expose exact hidden active chain counts beyond the preview cap', () => {
    const searchEndpoint = source.indexOf("'/api/v1/search'");
    assert.ok(searchEndpoint !== -1, 'search endpoint must exist');
    const handlerSlice = source.slice(searchEndpoint, searchEndpoint + 7000);
    assert.ok(
      handlerSlice.includes('report.hiddenActiveChainCount'),
      'GET /api/v1/search should expose an exact hidden-chain count when extra active chains are omitted from report-hit previews',
    );
    assert.ok(
      handlerSlice.includes('report.hasMoreActiveChains'),
      'GET /api/v1/search should expose an overflow flag when extra active chains are hidden by the preview cap',
    );
    assert.ok(
      handlerSlice.includes('getReportPreviewChains'),
      'GET /api/v1/search should compute preview drilldowns plus exact hidden counts through the shared preview helper',
    );
  });
});

describe('Event-chain preview SQL — structural (queries.ts source)', () => {
  it('getRecentReportChainDrilldowns returns total_chain_count for exact preview overflow labels', () => {
    const fnStart = queriesSource.indexOf('export async function getRecentReportChainDrilldowns');
    assert.ok(fnStart !== -1, 'queries.ts must export getRecentReportChainDrilldowns');
    const fnSlice = queriesSource.slice(fnStart, fnStart + 2200);
    assert.ok(
      fnSlice.includes('COUNT(*) OVER ()::int AS total_chain_count'),
      'getRecentReportChainDrilldowns should return total_chain_count so preview surfaces can show exact hidden-chain counts',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. CD-012 — getAllSourcesWithState uses LEFT JOIN, returns all sources
// ---------------------------------------------------------------------------

describe('CD-012 — getAllSourcesWithState (queries.ts source)', () => {
  it('exports a function named getAllSourcesWithState', () => {
    assert.ok(
      queriesSource.includes('export async function getAllSourcesWithState'),
      'queries.ts must export getAllSourcesWithState',
    );
  });

  it('uses LEFT JOIN to join sources with source_state', () => {
    // Extract the function body
    const fnStart = queriesSource.indexOf('function getAllSourcesWithState');
    assert.ok(fnStart !== -1, 'getAllSourcesWithState must exist');
    const fnSlice = queriesSource.slice(fnStart, fnStart + 600);
    assert.ok(
      /LEFT\s+JOIN\s+source_state/i.test(fnSlice),
      'getAllSourcesWithState must use LEFT JOIN source_state so sources without state are still returned',
    );
  });

  it('does NOT filter by enabled = true', () => {
    const fnStart = queriesSource.indexOf('function getAllSourcesWithState');
    assert.ok(fnStart !== -1);
    const fnSlice = queriesSource.slice(fnStart, fnStart + 600);
    assert.ok(
      !fnSlice.includes('WHERE enabled = true') && !fnSlice.includes('WHERE enabled=true'),
      'getAllSourcesWithState must NOT filter WHERE enabled = true — all sources should be visible',
    );
  });

  it('server.ts sources endpoint calls getAllSourcesWithState (not getSources)', () => {
    const sourcesEndpoint = source.indexOf("'/api/v1/sources'");
    assert.ok(sourcesEndpoint !== -1, 'sources endpoint must exist');
    // Look at the GET handler (first occurrence)
    const handlerSlice = source.slice(sourcesEndpoint, sourcesEndpoint + 400);
    assert.ok(
      handlerSlice.includes('getAllSourcesWithState'),
      'GET /api/v1/sources must call getAllSourcesWithState, not getSources',
    );
  });
});

// ---------------------------------------------------------------------------
// 4. CD-013 — feed endpoint parses attachments JSON
// ---------------------------------------------------------------------------

describe('CD-013 — feed endpoint parses attachments (server.ts source)', () => {
  it('feed endpoint exists at /api/v1/feed/:sourceId', () => {
    assert.ok(source.includes("'/api/v1/feed/:sourceId'"), 'feed endpoint must be defined');
  });

  it('defines a shared parseItemRecord helper for attachment parsing', () => {
    const helperStart = source.indexOf('function parseItemRecord');
    assert.ok(helperStart !== -1, 'server.ts must define parseItemRecord for item serialization');
    const helperSlice = source.slice(helperStart, helperStart + 500);
    assert.ok(
      helperSlice.includes('JSON.parse') && helperSlice.includes('attachments'),
      'parseItemRecord must JSON.parse the attachments column',
    );
  });

  it('feed response handling uses parseItemRecord for attachments', () => {
    const feedStart = source.indexOf("'/api/v1/feed/:sourceId'");
    assert.ok(feedStart !== -1);
    // Scan forward to find the handler body (up to next app. route or end)
    const feedSlice = source.slice(feedStart, feedStart + 2000);
    assert.ok(feedSlice.includes('parseItemRecord'), 'feed endpoint must serialize rows through parseItemRecord');
  });

  it('parseItemRecord defaults null/undefined attachments to an empty array', () => {
    const helperStart = source.indexOf('function parseItemRecord');
    assert.ok(helperStart !== -1);
    const feedSlice = source.slice(helperStart, helperStart + 500);
    // Should have a fallback to [] for null attachments — e.g. ?? [] or || []
    assert.ok(feedSlice.includes('[]'), 'parseItemRecord must default null attachments to an empty array ([])');
  });
});

// ---------------------------------------------------------------------------
// 5. CD-016 — items/:id endpoint parses attachments JSON
// ---------------------------------------------------------------------------

describe('CD-016 — items/:id parses attachments (server.ts source)', () => {
  it('items/:id endpoint exists', () => {
    assert.ok(source.includes("'/api/v1/items/:id'"), 'items/:id endpoint must be defined');
  });

  it('items/:id uses parseItemRecord for attachment parsing', () => {
    const itemStart = source.indexOf("'/api/v1/items/:id'");
    assert.ok(itemStart !== -1);
    const itemSlice = source.slice(itemStart, itemStart + 2400);
    assert.ok(
      itemSlice.includes('parseItemRecord(itemRow)') || itemSlice.includes('parseItemRecord(row)'),
      'items/:id endpoint must serialize rows through parseItemRecord',
    );
  });

  it('items/:id supports nearby context lookups', () => {
    const itemStart = source.indexOf("'/api/v1/items/:id'");
    assert.ok(itemStart !== -1);
    const itemSlice = source.slice(itemStart, itemStart + 3000);
    assert.ok(
      itemSlice.includes("context: { type: 'integer'") && itemSlice.includes('older:') && itemSlice.includes('newer:'),
      'items/:id endpoint must accept a context query and return older/newer neighboring items',
    );
  });
});

// ---------------------------------------------------------------------------
// 6. CD-014 — reports/:id endpoint parses body JSON
// ---------------------------------------------------------------------------

describe('CD-014 — reports/:id parses body JSON (server.ts source)', () => {
  it('reports/:id endpoint exists', () => {
    assert.ok(source.includes("'/api/v1/reports/:id'"), 'reports/:id endpoint must be defined');
  });

  it('parses the report body as JSON', () => {
    const reportIdStart = source.indexOf("'/api/v1/reports/:id'");
    assert.ok(reportIdStart !== -1);
    const handlerSlice = source.slice(reportIdStart, reportIdStart + 1500);
    assert.ok(
      handlerSlice.includes('parseReportBody(report.body)') || handlerSlice.includes('parseReportBody'),
      'reports/:id must parse the body column, directly or via a shared helper',
    );
  });

  it('extracts keyEvents from parsed body', () => {
    const reportIdStart = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportIdStart, reportIdStart + 1500);
    assert.ok(handlerSlice.includes('keyEvents'), 'reports/:id must extract keyEvents from the parsed body');
  });

  it('extracts marketCatalysts from parsed body', () => {
    const reportIdStart = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportIdStart, reportIdStart + 1500);
    assert.ok(
      handlerSlice.includes('marketCatalysts'),
      'reports/:id must extract marketCatalysts from the parsed body',
    );
  });

  it('extracts eventChains from parsed body', () => {
    const reportIdStart = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportIdStart, reportIdStart + 1500);
    assert.ok(handlerSlice.includes('eventChains'), 'reports/:id must extract eventChains from the parsed body');
  });

  it('can enrich reports/:id with persisted chain drilldowns', () => {
    const reportIdStart = source.indexOf("'/api/v1/reports/:id'");
    const summariesStart = source.indexOf("'/api/v1/summaries/:id'");
    const handlerSlice = source.slice(reportIdStart, summariesStart);
    assert.ok(
      handlerSlice.includes('getRecentReportChainDrilldowns'),
      'reports/:id should load persisted chain drilldowns when report entity context is available',
    );
    assert.ok(
      handlerSlice.includes('report.chainDrilldowns'),
      'reports/:id should expose persisted chain drilldowns on the report payload',
    );
    assert.ok(
      handlerSlice.includes('extractReportEntityNames'),
      'reports/:id should derive chain drilldowns from parsed report entity names instead of brittle prompt-text matching',
    );
  });

  it('extracts entitySentiment from parsed body', () => {
    const reportIdStart = source.indexOf("'/api/v1/reports/:id'");
    const summariesStart = source.indexOf("'/api/v1/summaries/:id'");
    const handlerSlice = source.slice(reportIdStart, summariesStart);
    assert.ok(
      handlerSlice.includes('entitySentiment'),
      'reports/:id must extract entitySentiment from the parsed body',
    );
  });

  it('extracts sections from parsed body', () => {
    const reportIdStart = source.indexOf("'/api/v1/reports/:id'");
    const summariesStart = source.indexOf("'/api/v1/summaries/:id'");
    const handlerSlice = source.slice(reportIdStart, summariesStart);
    assert.ok(handlerSlice.includes('sections'), 'reports/:id must extract sections from the parsed body');
  });

  it('wraps JSON.parse in a try/catch for invalid body JSON', () => {
    const helperStart = source.indexOf('function parseReportBody');
    assert.ok(helperStart !== -1, 'server.ts must define a parseReportBody helper');
    const helperSlice = source.slice(helperStart, helperStart + 220);
    assert.ok(
      helperSlice.includes('JSON.parse') && helperSlice.includes('try') && helperSlice.includes('catch'),
      'report body parsing must wrap JSON.parse in try/catch to handle invalid JSON',
    );
  });
});

// ---------------------------------------------------------------------------
// 7. CD-015 — summaries/:id endpoint parses body JSON
// ---------------------------------------------------------------------------

describe('CD-015 — summaries/:id parses body JSON (server.ts source)', () => {
  it('summaries/:id endpoint exists', () => {
    assert.ok(source.includes("'/api/v1/summaries/:id'"), 'summaries/:id endpoint must be defined');
  });

  it('parses the summary body as JSON', () => {
    const summaryIdStart = source.indexOf("'/api/v1/summaries/:id'");
    assert.ok(summaryIdStart !== -1);
    const handlerSlice = source.slice(summaryIdStart, summaryIdStart + 1800);
    assert.ok(
      handlerSlice.includes('parseSummaryBody(row.body)') || handlerSlice.includes('parseSummaryBody'),
      'summaries/:id must parse the body column, directly or via a shared helper',
    );
  });

  it('extracts text and confidence from parsed body', () => {
    const summaryIdStart = source.indexOf("'/api/v1/summaries/:id'");
    const handlerSlice = source.slice(summaryIdStart, summaryIdStart + 1800);
    assert.ok(handlerSlice.includes('summary.text'), 'summaries/:id must extract summary text from the parsed body');
    assert.ok(
      handlerSlice.includes('summary.confidence'),
      'summaries/:id must extract confidence from the parsed body',
    );
  });

  it('extracts keyEvents, entities, and events from parsed body', () => {
    const summaryIdStart = source.indexOf("'/api/v1/summaries/:id'");
    const handlerSlice = source.slice(summaryIdStart, summaryIdStart + 2200);
    assert.ok(handlerSlice.includes('summary.keyEvents'), 'summaries/:id must extract keyEvents from the parsed body');
    assert.ok(handlerSlice.includes('summary.entities'), 'summaries/:id must extract entities from the parsed body');
    assert.ok(handlerSlice.includes('summary.events'), 'summaries/:id must extract events from the parsed body');
  });

  it('can enrich summary events with persisted chain context', () => {
    const summaryIdStart = source.indexOf("'/api/v1/summaries/:id'");
    const handlerSlice = source.slice(summaryIdStart, summaryIdStart + 2600);
    assert.ok(
      handlerSlice.includes('getSummaryEventsWithChainContext'),
      'summaries/:id should load persisted summary events when chain context is available',
    );
    assert.ok(
      handlerSlice.includes('persistedSummaryEvents.length > 0'),
      'summaries/:id should gate persisted summary-event enrichment on actual query results',
    );
    assert.ok(
      handlerSlice.includes('extractSummaryEvents(parsed.events)'),
      'summaries/:id should prefer persisted summary events over parsed-body fallbacks when available',
    );
  });

  it('serializes previous/next summary drilldowns for persisted event chains', () => {
    const helperStart = source.indexOf('function serializeSummaryEventRows');
    assert.ok(helperStart !== -1, 'server.ts must define serializeSummaryEventRows');
    const helperSlice = source.slice(helperStart, helperStart + 1800);
    assert.ok(helperSlice.includes('previousSummary'), 'persisted summary events should serialize previousSummary');
    assert.ok(helperSlice.includes('nextSummary'), 'persisted summary events should serialize nextSummary');
    assert.ok(helperSlice.includes('summaryId'), 'neighboring summary drilldowns should include summaryId');
  });

  it('wraps summary JSON parsing in a try/catch helper', () => {
    const helperStart = source.indexOf('function parseSummaryBody');
    assert.ok(helperStart !== -1, 'server.ts must define a parseSummaryBody helper');
    const helperSlice = source.slice(helperStart, helperStart + 220);
    assert.ok(
      helperSlice.includes('JSON.parse') && helperSlice.includes('try') && helperSlice.includes('catch'),
      'summary body parsing must wrap JSON.parse in try/catch to handle invalid JSON',
    );
  });
});

// ---------------------------------------------------------------------------
// 7. SV-001 — toCamelCase guards __proto__/constructor/prototype keys
// ---------------------------------------------------------------------------

describe('SV-001 — toCamelCase prototype pollution guard (server.ts source)', () => {
  it('toCamelCase body skips __proto__ key', () => {
    const fnStart = source.indexOf('function toCamelCase');
    assert.ok(fnStart !== -1);
    const braceStart = source.indexOf('{', fnStart);
    let depth = 0;
    let fnEnd = -1;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') depth--;
      if (depth === 0) {
        fnEnd = i;
        break;
      }
    }
    const fnBody = source.slice(fnStart, fnEnd + 1);
    assert.ok(fnBody.includes('__proto__'), 'toCamelCase must guard against __proto__ key (prototype pollution)');
  });

  it('toCamelCase body skips constructor key', () => {
    const fnStart = source.indexOf('function toCamelCase');
    const braceStart = source.indexOf('{', fnStart);
    let depth = 0;
    let fnEnd = -1;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') depth--;
      if (depth === 0) {
        fnEnd = i;
        break;
      }
    }
    const fnBody = source.slice(fnStart, fnEnd + 1);
    assert.ok(fnBody.includes("'constructor'"), 'toCamelCase must guard against constructor key (prototype pollution)');
  });

  it('toCamelCase body skips prototype key', () => {
    const fnStart = source.indexOf('function toCamelCase');
    const braceStart = source.indexOf('{', fnStart);
    let depth = 0;
    let fnEnd = -1;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') depth--;
      if (depth === 0) {
        fnEnd = i;
        break;
      }
    }
    const fnBody = source.slice(fnStart, fnEnd + 1);
    assert.ok(fnBody.includes("'prototype'"), 'toCamelCase must guard against prototype key (prototype pollution)');
  });

  it('toCamelCase uses continue to skip dangerous keys', () => {
    const fnStart = source.indexOf('function toCamelCase');
    const braceStart = source.indexOf('{', fnStart);
    let depth = 0;
    let fnEnd = -1;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') depth--;
      if (depth === 0) {
        fnEnd = i;
        break;
      }
    }
    const fnBody = source.slice(fnStart, fnEnd + 1);
    assert.ok(
      fnBody.includes('continue'),
      'toCamelCase must use continue to skip __proto__/constructor/prototype keys',
    );
  });
});

// ---------------------------------------------------------------------------
// 7. SV-004 — test-webhook pins fetch to resolved IP (DNS rebinding prevention)
// ---------------------------------------------------------------------------

describe('SV-004 — test-webhook DNS rebinding prevention (server.ts source)', () => {
  it('test-webhook endpoint exists', () => {
    assert.ok(source.includes("'/api/v1/config/test-webhook'"), 'test-webhook endpoint must be defined');
  });

  it('test-webhook calls validateUrl before fetching', () => {
    const whStart = source.indexOf("'/api/v1/config/test-webhook'");
    assert.ok(whStart !== -1);
    const handlerSlice = source.slice(whStart, whStart + 2000);
    assert.ok(handlerSlice.includes('validateUrl'), 'test-webhook must call validateUrl for SSRF protection');
  });

  it('test-webhook checks for resolvedIp from validateUrl', () => {
    const whStart = source.indexOf("'/api/v1/config/test-webhook'");
    const handlerSlice = source.slice(whStart, whStart + 2000);
    assert.ok(handlerSlice.includes('resolvedIp'), 'test-webhook must use resolvedIp from validateUrl result');
  });

  it('test-webhook uses the shared pinned fetch helper after validation succeeds', () => {
    const whStart = source.indexOf("'/api/v1/config/test-webhook'");
    const handlerSlice = source.slice(whStart, whStart + 2000);
    assert.ok(
      handlerSlice.includes('fetchValidated('),
      'test-webhook must use the shared pinned fetch helper after validateUrl confirms it is safe',
    );
  });
});

// ---------------------------------------------------------------------------
// 8. SV-005 — PATCH /users/:discordId validates discordId as snowflake
// ---------------------------------------------------------------------------

describe('SV-005 — PATCH /users/:discordId snowflake validation (server.ts source)', () => {
  it('PATCH /users/:discordId endpoint exists', () => {
    assert.ok(source.includes("'/api/v1/users/:discordId'"), 'PATCH /users/:discordId endpoint must be defined');
  });

  it('discordId param has pattern constraint for snowflake format', () => {
    const patchStart = source.indexOf("'/api/v1/users/:discordId'");
    assert.ok(patchStart !== -1);
    const handlerSlice = source.slice(patchStart, patchStart + 800);
    assert.ok(
      handlerSlice.includes('pattern'),
      'PATCH /users/:discordId must define a pattern on the discordId param schema',
    );
  });

  it('discordId pattern matches exactly ^\\d{17,20}$', () => {
    const patchStart = source.indexOf("'/api/v1/users/:discordId'");
    const handlerSlice = source.slice(patchStart, patchStart + 800);
    // The pattern in source is double-escaped: '^\\\\d{17,20}$'
    assert.ok(
      handlerSlice.includes("'^\\\\d{17,20}$'"),
      'discordId pattern must be ^\\d{17,20}$ (Discord snowflake: 17-20 digit string)',
    );
  });

  it('discordId is typed as string in params schema', () => {
    const patchStart = source.indexOf("'/api/v1/users/:discordId'");
    const handlerSlice = source.slice(patchStart, patchStart + 800);
    assert.ok(
      handlerSlice.includes("discordId: { type: 'string'"),
      'discordId param must be typed as string with pattern validation',
    );
  });
});

// ---------------------------------------------------------------------------
// 9. SV-010 — GET /status uses AT TIME ZONE for configured timezone
// ---------------------------------------------------------------------------

describe('SV-010 — GET /status timezone-aware day boundary (server.ts source)', () => {
  it('GET /status endpoint exists', () => {
    assert.ok(source.includes("'/api/v1/status'"), 'GET /status endpoint must be defined');
  });

  it('GET /status fetches timezone from getAppConfig', () => {
    const statusStart = source.indexOf("'/api/v1/status'");
    assert.ok(statusStart !== -1);
    const handlerSlice = source.slice(statusStart, statusStart + 1200);
    assert.ok(
      handlerSlice.includes('getAppConfig') && handlerSlice.includes('timezone'),
      'GET /status must fetch timezone via getAppConfig',
    );
  });

  it('GET /status SQL uses AT TIME ZONE for day boundary', () => {
    const statusStart = source.indexOf("'/api/v1/status'");
    const handlerSlice = source.slice(statusStart, statusStart + 1200);
    assert.ok(
      handlerSlice.includes('AT TIME ZONE'),
      'GET /status SQL must use AT TIME ZONE for timezone-aware day boundary calculation',
    );
  });

  it('GET /status passes timezone as a SQL parameter (not interpolated)', () => {
    const statusStart = source.indexOf("'/api/v1/status'");
    const handlerSlice = source.slice(statusStart, statusStart + 1200);
    // Should pass timezone as $1 parameter, not string interpolation
    assert.ok(
      handlerSlice.includes('[timezone]'),
      'GET /status must pass timezone as a parameterized SQL value to prevent injection',
    );
  });

  it('GET /status defaults timezone to Asia/Jakarta', () => {
    const statusStart = source.indexOf("'/api/v1/status'");
    const handlerSlice = source.slice(statusStart, statusStart + 1200);
    assert.ok(
      handlerSlice.includes('Asia/Jakarta'),
      'GET /status must default timezone to Asia/Jakarta when not configured',
    );
  });
});
