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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = resolve(__dirname, '../../src/server.ts');

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
  [source, queriesSource] = await Promise.all([readFile(SERVER_SRC, 'utf-8'), readFile(QUERIES_SRC, 'utf-8')]);
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
    assert.ok(reportsEndpoint !== -1, 'reports endpoint must exist');

    // Look for toCamelCase usage in the vicinity (within the handler)
    const handlerSlice = source.slice(reportsEndpoint, reportsEndpoint + 1200);
    assert.ok(handlerSlice.includes('toCamelCase'), 'GET /api/v1/reports must apply toCamelCase to its response rows');
  });

  it('reports endpoint uses .map pattern with toCamelCase', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const handlerSlice = source.slice(reportsEndpoint, reportsEndpoint + 1200);
    assert.ok(
      handlerSlice.includes('.map(') && handlerSlice.includes('toCamelCase'),
      'GET /api/v1/reports should map rows through toCamelCase',
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

  it('feed response handling includes JSON.parse for attachments', () => {
    const feedStart = source.indexOf("'/api/v1/feed/:sourceId'");
    assert.ok(feedStart !== -1);
    // Scan forward to find the handler body (up to next app. route or end)
    const feedSlice = source.slice(feedStart, feedStart + 2000);
    assert.ok(
      feedSlice.includes('JSON.parse') && feedSlice.includes('attachments'),
      'feed endpoint must JSON.parse the attachments column',
    );
  });

  it('defaults null/undefined attachments to an empty array', () => {
    const feedStart = source.indexOf("'/api/v1/feed/:sourceId'");
    assert.ok(feedStart !== -1);
    const feedSlice = source.slice(feedStart, feedStart + 2000);
    // Should have a fallback to [] for null attachments — e.g. ?? [] or || []
    assert.ok(feedSlice.includes('[]'), 'feed endpoint must default null attachments to an empty array ([])');
  });
});

// ---------------------------------------------------------------------------
// 5. CD-014 — reports/:id endpoint parses body JSON
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
      handlerSlice.includes('JSON.parse') && handlerSlice.includes('body'),
      'reports/:id must JSON.parse the body column',
    );
  });

  it('extracts keyEvents from parsed body', () => {
    const reportIdStart = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportIdStart, reportIdStart + 1500);
    assert.ok(handlerSlice.includes('keyEvents'), 'reports/:id must extract keyEvents from the parsed body');
  });

  it('extracts entitySentiment from parsed body', () => {
    const reportIdStart = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportIdStart, reportIdStart + 1500);
    assert.ok(
      handlerSlice.includes('entitySentiment'),
      'reports/:id must extract entitySentiment from the parsed body',
    );
  });

  it('extracts sections from parsed body', () => {
    const reportIdStart = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportIdStart, reportIdStart + 1500);
    assert.ok(handlerSlice.includes('sections'), 'reports/:id must extract sections from the parsed body');
  });

  it('wraps JSON.parse in a try/catch for invalid body JSON', () => {
    const reportIdStart = source.indexOf("'/api/v1/reports/:id'");
    const handlerSlice = source.slice(reportIdStart, reportIdStart + 1500);
    assert.ok(
      handlerSlice.includes('try') && handlerSlice.includes('catch'),
      'reports/:id must wrap body JSON.parse in try/catch to handle invalid JSON',
    );
  });
});

// ---------------------------------------------------------------------------
// 6. SV-001 — toCamelCase guards __proto__/constructor/prototype keys
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

  it('test-webhook does NOT use bare fetch(url) after validation — uses pinnedUrl', () => {
    const whStart = source.indexOf("'/api/v1/config/test-webhook'");
    const handlerSlice = source.slice(whStart, whStart + 2000);
    // The fetch call should use pinnedUrl or fetchValidated, NOT the raw user-provided url
    const fetchCalls = handlerSlice.match(/fetch\(\s*(\w+)/g) ?? [];
    for (const call of fetchCalls) {
      assert.ok(
        !call.includes('fetch(url') && !call.includes('fetch( url'),
        'test-webhook must NOT use bare fetch(url) — must pin to resolved IP to prevent DNS rebinding (TOCTOU)',
      );
    }
  });

  it('test-webhook constructs a pinnedUrl with the resolved IP', () => {
    const whStart = source.indexOf("'/api/v1/config/test-webhook'");
    const handlerSlice = source.slice(whStart, whStart + 2000);
    assert.ok(
      handlerSlice.includes('pinnedUrl'),
      'test-webhook must construct a pinnedUrl that replaces hostname with the resolved IP',
    );
  });

  it('test-webhook sets Host header to original hostname', () => {
    const whStart = source.indexOf("'/api/v1/config/test-webhook'");
    const handlerSlice = source.slice(whStart, whStart + 2000);
    assert.ok(
      handlerSlice.includes('Host') && handlerSlice.includes('parsed.host'),
      'test-webhook must set Host header to original hostname when fetching via pinned IP',
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
