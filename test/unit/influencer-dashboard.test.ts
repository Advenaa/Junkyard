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

describe('Influencer dashboard queries (src/db/queries.ts)', () => {
  const src = readQueriesSource();

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

  it('AuthorRow omits manual grading aggregates', () => {
    const rowStart = src.indexOf('export interface AuthorRow');
    assert.ok(rowStart !== -1, 'AuthorRow must exist');
    const rowSlice = src.slice(rowStart, rowStart + 400);

    assert.ok(!rowSlice.includes('credibilityScore'), 'AuthorRow must not expose credibilityScore');
    assert.ok(!rowSlice.includes('correctCalls'), 'AuthorRow must not expose correctCalls');
  });

  it('AuthorCallRow omits manual grading fields', () => {
    const rowStart = src.indexOf('export interface AuthorCallRow');
    assert.ok(rowStart !== -1, 'AuthorCallRow must exist');
    const rowSlice = src.slice(rowStart, rowStart + 400);

    assert.ok(!rowSlice.includes('resolved:'), 'AuthorCallRow must not expose resolved');
    assert.ok(!rowSlice.includes('outcome:'), 'AuthorCallRow must not expose outcome');
    assert.ok(!rowSlice.includes('resolvedAt:'), 'AuthorCallRow must not expose resolvedAt');
  });
});

describe('Influencer dashboard routes (src/server.ts)', () => {
  const src = readServerSource();

  it('does not import resolveAuthorCall from db/queries', () => {
    assert.doesNotMatch(src, /resolveAuthorCall/, 'server.ts must not import resolveAuthorCall');
  });

  it('does not define PATCH /api/v1/author-calls/:callId route', () => {
    assert.ok(
      !src.includes("'/api/v1/author-calls/:callId'"),
      'server.ts must not define the author-call resolution route',
    );
  });
});
