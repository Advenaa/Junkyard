import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ===========================================================================
// AU-021: POST /api/v1/sources requires admin
// ===========================================================================

describe('AU-021: POST /sources requires admin', () => {
  const src = readSrc('src/server.ts');

  it('POST /api/v1/sources route includes requireAdmin in preHandler', () => {
    // Match the route definition: app.post('/api/v1/sources', { preHandler: [..., requireAdmin], ...
    const postSourcesPattern = /app\.post\(\s*['"]\/api\/v1\/sources['"]\s*,\s*\{[^}]*preHandler\s*:\s*\[[^\]]*requireAdmin[^\]]*\]/s;
    assert.match(src, postSourcesPattern, 'POST /api/v1/sources must have requireAdmin in preHandler array');
  });

  it('requireAdmin is imported from auth/middleware', () => {
    assert.match(src, /import\s*\{[^}]*requireAdmin[^}]*\}\s*from\s*['"]\.\/auth\/middleware/, 'requireAdmin must be imported from auth/middleware');
  });

  it('GET /api/v1/sources does NOT require admin (viewer access)', () => {
    // The GET route should have authPreHandler but NOT requireAdmin
    const getSourcesMatch = src.match(/app\.get\(\s*['"]\/api\/v1\/sources['"]\s*,\s*\{[^}]*preHandler\s*:\s*\[([^\]]*)\]/s);
    assert.ok(getSourcesMatch, 'GET /api/v1/sources route must exist');
    const preHandlerContent = getSourcesMatch![1];
    assert.ok(!preHandlerContent.includes('requireAdmin'), 'GET /api/v1/sources should NOT require admin');
  });
});

// ===========================================================================
// TW-006: Twitter halt persistence via source_state DB table
// ===========================================================================

describe('TW-006: Twitter halt persistence', () => {
  const src = readSrc('src/ingest/twitter.ts');

  it('does not use in-memory "let halted" variable', () => {
    // Ensure there is no `let halted` pattern — halt state must be DB-backed
    assert.doesNotMatch(src, /let\s+halted\b/, 'must not have in-memory "let halted" variable — halt state must be persisted to DB');
  });

  it('haltAllTwitterSources updates source_state table', () => {
    assert.match(src, /UPDATE\s+source_state\s+SET\s+status\s*=\s*'halted'/s, 'haltAllTwitterSources must UPDATE source_state to halted');
  });

  it('haltAllTwitterSources writes to source = twitter rows', () => {
    assert.match(src, /WHERE\s+source\s*=\s*'twitter'/s, 'haltAllTwitterSources must target twitter sources');
  });

  it('isSourceHalted queries source_state table', () => {
    assert.match(src, /SELECT\s+status\s+FROM\s+source_state/s, 'isSourceHalted must SELECT from source_state');
  });

  it('isSourceHalted checks for halted status', () => {
    assert.match(src, /===\s*'halted'/, 'isSourceHalted must compare status to "halted"');
  });

  it('poll calls isSourceHalted before fetching', () => {
    // isSourceHalted must appear in the poll function BEFORE fetchPage
    const pollBody = src.match(/async\s+function\s+poll\b[\s\S]*?return\s*\{[^}]*\}\s*;?\s*\}/);
    assert.ok(pollBody, 'poll function must exist');
    const haltedIdx = pollBody![0].indexOf('isSourceHalted');
    const fetchIdx = pollBody![0].indexOf('fetchPage');
    assert.ok(haltedIdx > -1, 'poll must call isSourceHalted');
    assert.ok(fetchIdx > -1, 'poll must call fetchPage');
    assert.ok(haltedIdx < fetchIdx, 'isSourceHalted check must come before fetchPage call');
  });
});

// ===========================================================================
// FE-012: 401 handler returns never-resolving promise (no throw)
// ===========================================================================

describe('FE-012: 401 handler returns never-resolving promise', () => {
  const src = readSrc('dashboard/src/lib/api.ts');

  it('returns new Promise(() => {}) on 401', () => {
    assert.match(src, /new\s+Promise\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/, 'must return a never-resolving promise on 401');
  });

  it('401 branch does NOT throw an error', () => {
    // Extract the 401 handling block: from the 401 check to the next `if` or `return`
    const lines = src.split('\n');
    const start401 = lines.findIndex(l => l.includes('401'));
    assert.ok(start401 >= 0, '401 check must exist');

    // Collect lines from the 401 check until the next top-level if/return (the non-ok check)
    const block401Lines: string[] = [];
    for (let i = start401; i < lines.length; i++) {
      block401Lines.push(lines[i]);
      // Stop when we hit the next condition (res.ok check or end of function)
      if (i > start401 && (lines[i].includes('if (') || lines[i].trimStart().startsWith('return'))) break;
    }
    const block401 = block401Lines.join('\n');

    assert.doesNotMatch(block401, /throw\s+new\s+Error/, '401 handler must NOT throw — it should return a never-resolving promise to prevent cascading errors');
  });

  it('redirects to /login on 401', () => {
    assert.match(src, /window\.location\.href\s*=\s*['"]\/login['"]/, 'must redirect to /login on 401');
  });

  it('non-401 errors still throw', () => {
    assert.match(src, /if\s*\(\s*!res\.ok\s*\)\s*throw\s+new\s+Error/, 'non-401 errors must still throw');
  });
});
