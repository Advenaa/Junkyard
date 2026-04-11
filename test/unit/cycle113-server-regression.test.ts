/**
 * Cycle 113 — Server structural regression tests
 *
 * DA-001: Search endpoint uses epoch-ms cutoff (not ISO string, not Date wrapper)
 * DA-010: PATCH /config has body schema with additionalProperties: false
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readServerSource } from './helpers/server-source.js';

const src = readServerSource();

// ---------------------------------------------------------------------------
// Helpers — extract handler blocks by route pattern
// ---------------------------------------------------------------------------

/** Extract the search handler block (from the /search route to the next app. route). */
function extractSearchHandler(): string {
  const searchStart = src.indexOf("'/api/v1/search'");
  assert.notEqual(searchStart, -1, 'Could not locate search route in server.ts');
  const nextRoute = src.indexOf('\n  app.', searchStart + 1);
  return src.slice(searchStart, nextRoute === -1 ? undefined : nextRoute);
}

/** Extract the PATCH /config handler block. */
function extractConfigPatchHandler(): string {
  const match = src.match(/app\.patch\(\s*\n?\s*'\/api\/v1\/config'/);
  assert.ok(match && match.index !== undefined, 'Could not locate PATCH /config route in server.ts');
  const patchStart = match.index;
  const nextRoute = src.indexOf('\n  app.', patchStart + 1);
  return src.slice(patchStart, nextRoute === -1 ? undefined : nextRoute);
}

// ---------------------------------------------------------------------------
// DA-001 — Search endpoint uses epoch-ms cutoff
// ---------------------------------------------------------------------------
describe('DA-001 — Search endpoint uses epoch-ms cutoff', () => {
  const handler = extractSearchHandler();

  it('cutoff does NOT use .toISOString()', () => {
    assert.ok(!handler.includes('.toISOString()'), 'Search handler must not wrap cutoff with .toISOString()');
  });

  it('cutoff uses Date.now() - days pattern (epoch-ms arithmetic)', () => {
    assert.match(
      handler,
      /Date\.now\(\)\s*-\s*days\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
      'Search handler must compute cutoff as Date.now() - days * 24 * 60 * 60 * 1000',
    );
  });

  it('query parameter is NOT wrapped in new Date()', () => {
    // After the cutoff assignment, the value passed to pool.query should be
    // the plain `cutoff` number, never `new Date(cutoff)`.
    const afterCutoff = handler.slice(handler.indexOf('const cutoff'));
    assert.ok(
      !afterCutoff.includes('new Date(cutoff)'),
      'Search handler must not wrap cutoff in new Date() before passing to query',
    );
  });
});

// ---------------------------------------------------------------------------
// DA-010 — PATCH /config has body schema
// ---------------------------------------------------------------------------
describe('DA-010 — PATCH /config has body schema', () => {
  const handler = extractConfigPatchHandler();

  it('route has a schema property with body', () => {
    assert.match(handler, /schema:\s*\{[^}]*body:/s, 'PATCH /config must declare a schema with a body property');
  });

  it('body schema includes additionalProperties: false', () => {
    // Extract the schema block
    const schemaStart = handler.indexOf('schema:');
    const bodyStart = handler.indexOf('body:', schemaStart);
    // Find the matching closing brace for the body object
    let depth = 0;
    let bodyObjStart = -1;
    let bodyObjEnd = -1;
    for (let i = bodyStart; i < handler.length; i++) {
      if (handler[i] === '{') {
        if (bodyObjStart === -1) bodyObjStart = i;
        depth++;
      } else if (handler[i] === '}') {
        depth--;
        if (depth === 0) {
          bodyObjEnd = i + 1;
          break;
        }
      }
    }
    const bodySchema = handler.slice(bodyObjStart, bodyObjEnd);
    assert.ok(
      bodySchema.includes('additionalProperties: false'),
      'Body schema must include additionalProperties: false',
    );
  });

  it('body schema lists digest_time, timezone, webhook_url as properties', () => {
    const schemaStart = handler.indexOf('schema:');
    const bodyStart = handler.indexOf('body:', schemaStart);
    let depth = 0;
    let bodyObjStart = -1;
    let bodyObjEnd = -1;
    for (let i = bodyStart; i < handler.length; i++) {
      if (handler[i] === '{') {
        if (bodyObjStart === -1) bodyObjStart = i;
        depth++;
      } else if (handler[i] === '}') {
        depth--;
        if (depth === 0) {
          bodyObjEnd = i + 1;
          break;
        }
      }
    }
    const bodySchema = handler.slice(bodyObjStart, bodyObjEnd);

    for (const prop of ['digest_time', 'timezone', 'webhook_url']) {
      assert.ok(bodySchema.includes(prop), `Body schema must list '${prop}' as a property`);
    }
  });
});
