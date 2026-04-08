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
    const postSourcesPattern =
      /app\.post\(\s*['"]\/api\/v1\/sources['"]\s*,\s*\{[^}]*preHandler\s*:\s*\[[^\]]*requireAdmin[^\]]*\]/s;
    assert.match(src, postSourcesPattern, 'POST /api/v1/sources must have requireAdmin in preHandler array');
  });

  it('requireAdmin is imported from auth/middleware', () => {
    assert.match(
      src,
      /import\s*\{[^}]*requireAdmin[^}]*\}\s*from\s*['"]\.\/auth\/middleware/,
      'requireAdmin must be imported from auth/middleware',
    );
  });

  it('GET /api/v1/sources does NOT require admin (viewer access)', () => {
    // The GET route should have authPreHandler but NOT requireAdmin
    const getSourcesMatch = src.match(
      /app\.get\(\s*['"]\/api\/v1\/sources['"]\s*,\s*\{[^}]*preHandler\s*:\s*\[([^\]]*)\]/s,
    );
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
    assert.doesNotMatch(
      src,
      /let\s+halted\b/,
      'must not have in-memory "let halted" variable — halt state must be persisted to DB',
    );
  });

  it('haltAllTwitterSources updates source_state table', () => {
    assert.match(
      src,
      /UPDATE\s+source_state\s+SET\s+status\s*=\s*'halted'/s,
      'haltAllTwitterSources must UPDATE source_state to halted',
    );
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
// FE-012: 401 handler redirects and throws after notifying auth expiry
// ===========================================================================

describe('FE-012: 401 handler redirects and throws after notifying auth expiry', () => {
  const src = readSrc('dashboard/src/lib/api.ts');

  it('exports the auth-expired event constant', () => {
    assert.match(src, /export\s+const\s+AUTH_EXPIRED_EVENT\s*=\s*['"][^'"]+['"]/);
  });

  it('401 branch throws after firing the redirect flow', () => {
    assert.match(src, /if\s*\(\s*res\.status\s*===\s*401\s*\)/);
    assert.match(src, /window\.dispatchEvent\(new PopStateEvent\('popstate'\)\)/);
    assert.match(src, /window\.dispatchEvent\(new CustomEvent\(AUTH_EXPIRED_EVENT\)\)/);
    assert.match(src, /authRedirect\.toLogin\(\)/);
    assert.match(src, /throw\s+new\s+Error/);
  });

  it('redirects to /login on 401', () => {
    assert.ok(src.includes("window.history.replaceState({}, '', '/login');"));
    assert.ok(src.includes("window.location.assign('/login');"));
  });

  it('non-401 errors still throw', () => {
    assert.match(src, /if\s*\(\s*!res\.ok\s*\)\s*throw\s+new\s+Error/, 'non-401 errors must still throw');
  });
});
