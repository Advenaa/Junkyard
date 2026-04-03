/**
 * Cycle-95 structural regression tests for vector cache fixes.
 *
 * CH-002: Removed 30-day time window from loadType — now loads all vectors
 *         up to MAX_VECTORS ordered by created_at DESC without date filter.
 * CH-003: MIN_SIMILARITY lowered from 0.5 to 0.3.
 *
 * These are source-level pattern tests — they read the TypeScript source
 * and assert structural invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vectorCacheSrc = readFileSync(
  new URL('../../src/vector-cache.ts', import.meta.url), 'utf-8',
);

describe('CH-002 — loadType loads all vectors without date filter', () => {
  it('loadType query does NOT contain a date filter', () => {
    // Extract the loadType function body
    const loadTypeIdx = vectorCacheSrc.indexOf('async function loadType');
    assert.ok(loadTypeIdx > -1, 'should find loadType function');

    const loadTypeEnd = vectorCacheSrc.indexOf('\n  }', loadTypeIdx);
    const loadTypeBody = vectorCacheSrc.slice(loadTypeIdx, loadTypeEnd);

    assert.ok(
      !loadTypeBody.includes('created_at >= $2'),
      'loadType query must NOT contain created_at >= $2 date filter',
    );
    assert.ok(
      !loadTypeBody.includes('Date.now()'),
      'loadType must NOT reference Date.now() for a time window',
    );
    assert.ok(
      !loadTypeBody.includes('created_at >'),
      'loadType query must NOT contain any created_at > comparison',
    );
  });

  it('loadType query has ORDER BY created_at DESC LIMIT to respect MAX_VECTORS cap', () => {
    const loadTypeIdx = vectorCacheSrc.indexOf('async function loadType');
    const loadTypeEnd = vectorCacheSrc.indexOf('\n  }', loadTypeIdx);
    const loadTypeBody = vectorCacheSrc.slice(loadTypeIdx, loadTypeEnd);

    assert.match(
      loadTypeBody,
      /ORDER BY created_at DESC LIMIT/,
      'loadType query must contain ORDER BY created_at DESC LIMIT',
    );
  });

  it('no thirtyDaysAgo or similar time window variable exists in loadType', () => {
    const loadTypeIdx = vectorCacheSrc.indexOf('async function loadType');
    const loadTypeEnd = vectorCacheSrc.indexOf('\n  }', loadTypeIdx);
    const loadTypeBody = vectorCacheSrc.slice(loadTypeIdx, loadTypeEnd);

    assert.ok(
      !loadTypeBody.includes('thirtyDaysAgo'),
      'loadType must NOT contain thirtyDaysAgo variable',
    );
    assert.ok(
      !/\d+\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(loadTypeBody),
      'loadType must NOT contain days-to-milliseconds calculation (N * 24 * 60 * 60 * 1000)',
    );
  });
});

describe('CH-003 — MIN_SIMILARITY lowered to 0.3', () => {
  it('MIN_SIMILARITY is defined as 0.3', () => {
    assert.match(
      vectorCacheSrc,
      /const\s+MIN_SIMILARITY\s*=\s*0\.3\b/,
      'MIN_SIMILARITY must be defined as 0.3 (not 0.5 or any other value)',
    );
  });

  it('search function filters by score >= MIN_SIMILARITY', () => {
    const searchIdx = vectorCacheSrc.indexOf('function search(');
    assert.ok(searchIdx > -1, 'should find search function');

    const searchEnd = vectorCacheSrc.indexOf('\n  }', searchIdx);
    const searchBody = vectorCacheSrc.slice(searchIdx, searchEnd);

    assert.match(
      searchBody,
      /score\s*>=\s*MIN_SIMILARITY/,
      'search function must filter with score >= MIN_SIMILARITY',
    );
  });
});
