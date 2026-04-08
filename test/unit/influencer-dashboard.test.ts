import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

describe('Influencer dashboard queries (src/db/queries.ts)', () => {
  const src = readSrc('src/db/queries.ts');

  it('EntityAuthorRow includes first-mover timing fields for dashboard rendering', () => {
    assert.match(
      src,
      /interface\s+EntityAuthorRow[\s\S]*firstEntityCallTime:\s*number\s*\|\s*null[\s\S]*firstMover:\s*boolean[\s\S]*firstMoverLagMs:\s*number\s*\|\s*null/,
      'EntityAuthorRow must expose first-mover timing fields',
    );
  });

  it('getTopAuthorsByEntity computes first tracked call timing from author_calls', () => {
    const fnStart = src.indexOf('function getTopAuthorsByEntity');
    assert.ok(fnStart !== -1, 'getTopAuthorsByEntity must exist');
    const fnSlice = src.slice(fnStart, fnStart + 2200);

    assert.ok(fnSlice.includes('WITH mention_counts AS'), 'getTopAuthorsByEntity must keep mention counts in a CTE');
    assert.ok(fnSlice.includes('FROM author_calls ac'), 'getTopAuthorsByEntity must read author_calls timing data');
    assert.ok(
      fnSlice.includes('MIN(ac.timestamp) AS first_entity_call_time'),
      'getTopAuthorsByEntity must compute first_entity_call_time',
    );
    assert.ok(fnSlice.includes('AS first_mover'), 'getTopAuthorsByEntity must expose first_mover');
    assert.ok(fnSlice.includes('AS first_mover_lag_ms'), 'getTopAuthorsByEntity must expose first_mover_lag_ms');
  });

  it('AuthorCallRow includes entityName for dashboard rendering', () => {
    assert.match(
      src,
      /interface\s+AuthorCallRow[\s\S]*entityName:\s*string\s*\|\s*null/,
      'AuthorCallRow must expose entityName',
    );
  });

  it('getAuthorCalls joins entities and selects entity_name', () => {
    const fnStart = src.indexOf('function getAuthorCalls');
    assert.ok(fnStart !== -1, 'getAuthorCalls must exist');
    const fnSlice = src.slice(fnStart, fnStart + 800);

    assert.ok(fnSlice.includes('JOIN entities e ON e.id = ac.entity_id'), 'getAuthorCalls must join entities');
    assert.ok(fnSlice.includes('e.name AS entity_name'), 'getAuthorCalls must select entity_name');
  });

  it('resolveAuthorCall returns a boolean success signal', () => {
    const fnStart = src.indexOf('function resolveAuthorCall');
    assert.ok(fnStart !== -1, 'resolveAuthorCall must exist');
    const fnSlice = src.slice(fnStart, fnStart + 1000);

    assert.ok(fnSlice.includes('Promise<boolean>'), 'resolveAuthorCall must return Promise<boolean>');
    assert.ok(fnSlice.includes('return false'), 'resolveAuthorCall must return false when no row is updated');
    assert.ok(fnSlice.includes('return true'), 'resolveAuthorCall must return true when the update succeeds');
  });
});

describe('Influencer dashboard routes (src/server.ts)', () => {
  const src = readSrc('src/server.ts');

  it('imports resolveAuthorCall from db/queries', () => {
    assert.match(
      src,
      /import\s*\{[\s\S]*resolveAuthorCall[\s\S]*\}\s*from\s*'\.\/db\/queries\.js'/,
      'server.ts must import resolveAuthorCall',
    );
  });

  it('defines PATCH /api/v1/author-calls/:callId route', () => {
    assert.ok(src.includes("'/api/v1/author-calls/:callId'"), 'server.ts must define the author-call resolution route');
  });

  it('author-call resolution route requires admin auth', () => {
    const routeIdx = src.indexOf("'/api/v1/author-calls/:callId'");
    assert.ok(routeIdx !== -1, 'author-call resolution route must exist');
    const routeSlice = src.slice(Math.max(0, routeIdx - 250), routeIdx + 900);

    assert.ok(
      routeSlice.includes('authPreHandler') && routeSlice.includes('requireAdmin'),
      'author-call resolution route must use authPreHandler and requireAdmin',
    );
  });

  it('author-call resolution route validates outcome enum values', () => {
    const routeIdx = src.indexOf("'/api/v1/author-calls/:callId'");
    assert.ok(routeIdx !== -1, 'author-call resolution route must exist');
    const routeSlice = src.slice(routeIdx, routeIdx + 1200);

    assert.ok(
      routeSlice.includes("enum: ['correct', 'incorrect', 'unresolved']"),
      'author-call resolution route must validate correct/incorrect/unresolved outcomes',
    );
  });

  it('author-call resolution route calls resolveAuthorCall with callId and outcome', () => {
    const routeIdx = src.indexOf("'/api/v1/author-calls/:callId'");
    assert.ok(routeIdx !== -1, 'author-call resolution route must exist');
    const routeSlice = src.slice(routeIdx, routeIdx + 1500);

    assert.ok(
      routeSlice.includes('resolveAuthorCall(pool, request.params.callId, request.body.outcome)'),
      'author-call resolution route must delegate to resolveAuthorCall',
    );
  });
});
