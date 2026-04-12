/**
 * Cycle-102 regression tests for vector cache fixes.
 *
 * VE-002: Eviction order fixed (ORDER BY ASC) — already covered by
 *         cycle95-vector-cache-regression.test.ts (line 43-53). No new test here.
 *
 * VE-003: search() is now async and falls back to querying the DB when
 *         in-memory results are fewer than `limit`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Pool } from '../../src/db/connection.js';
import type { Logger } from '../../src/logger.js';

const vectorCacheSrc = readFileSync(new URL('../../src/vector-cache.ts', import.meta.url), 'utf-8');

// ── Extract the search function body once ──────────────────────────────

const searchIdx = vectorCacheSrc.indexOf('async function search(');
assert.ok(searchIdx > -1, 'precondition: should find async function search');
// Find the closing brace at the correct indentation (2-space indent function end)
const searchEnd = vectorCacheSrc.indexOf('\n  }', searchIdx);
const searchBody = vectorCacheSrc.slice(searchIdx, searchEnd);

describe('VE-003 — async DB fallback for search', () => {
  // ── Structural tests ──────────────────────────────────────────────

  it('search function is declared as async', () => {
    // The function must start with `async function search(`
    assert.match(searchBody, /^async function search\(/, 'search must be declared as async');
  });

  it('VectorCache interface declares search returning Promise<SearchResult[]>', () => {
    assert.match(
      vectorCacheSrc,
      /search\([^)]*\):\s*Promise<SearchResult\[\]>/,
      'VectorCache interface must declare search returning Promise<SearchResult[]>',
    );
  });

  it('search function contains a DB query fallback with SELECT target_id, vector FROM embeddings', () => {
    assert.ok(
      searchBody.includes('SELECT target_id, vector FROM embeddings'),
      'search must contain a DB fallback query selecting target_id and vector from embeddings',
    );
  });

  it('DB fallback excludes already-cached IDs', () => {
    assert.ok(searchBody.includes('!= ALL('), 'DB fallback query must exclude cached IDs using != ALL()');
  });

  it('DB fallback is wrapped in try/catch for graceful failure', () => {
    assert.ok(
      searchBody.includes('try {') && searchBody.includes('catch'),
      'DB fallback must be wrapped in try/catch so in-memory results are returned on failure',
    );
  });

  // ── Functional test ───────────────────────────────────────────────

  it('returns in-memory results when DB fallback fails gracefully', async () => {
    // Dynamically import the module to test functional behavior
    const { createVectorCache, cosineSimilarity } = await import('../../src/vector-cache.js');

    // Mock pool that fails on query (simulating DB unavailable)
    const mockPool = {
      query: async () => {
        throw new Error('DB unavailable');
      },
    };

    // Silent logger
    const mockLog = {
      info: () => {},
      warn: () => {},
      debug: () => {},
      error: () => {},
      child: () => mockLog,
    };

    const cache = createVectorCache(mockPool as unknown as Pool, mockLog as unknown as Logger);

    // Insert a vector that will match our query
    const dims = 768;
    const vec = new Float32Array(dims);
    vec[0] = 1.0; // unit vector along first axis
    cache.update('summary', 'test-id-1', vec);

    // Query with the same vector (cosine similarity = 1.0)
    const query = new Float32Array(dims);
    query[0] = 1.0;

    // search with limit > number of in-memory results triggers DB fallback
    // DB fallback fails, but we should still get the in-memory result
    const results = await cache.search(query, 'summary', 10);

    assert.ok(results.length >= 1, 'should return at least 1 in-memory result');
    assert.equal(results[0].targetId, 'test-id-1');
    assert.ok(results[0].score > 0.99, 'identical vectors should have similarity ~1.0');
  });
});
