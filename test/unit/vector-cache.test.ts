import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cosineSimilarity,
  evict,
  MAX_VECTORS,
  createVectorCache,
} from '../../src/vector-cache.js';
import type { VectorCache } from '../../src/vector-cache.js';

// ── Helpers ─────────────────────────────────────────────────────────────

/** Build a Float32Array from plain numbers. */
function vec(...values: number[]): Float32Array {
  return new Float32Array(values);
}

/** Stub logger that does nothing. */
const noopLog = {
  info() {},
  debug() {},
  warn() {},
  error() {},
  child() { return noopLog; },
} as any;

/** Stub pool — only needed for load() which we skip in unit tests. */
const stubPool = {} as any;

/** Create a VectorCache for testing (skipping load). */
function makeCache(): VectorCache {
  return createVectorCache(stubPool, noopLog);
}

// ── cosineSimilarity ────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('parallel vectors → 1.0', () => {
    const a = vec(1, 0, 0);
    const b = vec(1, 0, 0);
    assert.ok(Math.abs(cosineSimilarity(a, b) - 1.0) < 1e-6);
  });

  it('scaled parallel vectors → 1.0', () => {
    const a = vec(1, 2, 3);
    const b = vec(2, 4, 6);
    assert.ok(Math.abs(cosineSimilarity(a, b) - 1.0) < 1e-6);
  });

  it('orthogonal vectors → 0.0', () => {
    const a = vec(1, 0, 0);
    const b = vec(0, 1, 0);
    assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-6);
  });

  it('opposite vectors → -1.0', () => {
    const a = vec(1, 0, 0);
    const b = vec(-1, 0, 0);
    assert.ok(Math.abs(cosineSimilarity(a, b) - (-1.0)) < 1e-6);
  });

  it('zero vector → 0.0 (no division by zero)', () => {
    const a = vec(1, 2, 3);
    const b = vec(0, 0, 0);
    assert.equal(cosineSimilarity(a, b), 0);
  });

  it('both zero vectors → 0.0', () => {
    const a = vec(0, 0, 0);
    const b = vec(0, 0, 0);
    assert.equal(cosineSimilarity(a, b), 0);
  });

  it('known angle: 45° vectors → ~0.707', () => {
    const a = vec(1, 0);
    const b = vec(1, 1);
    const expected = 1 / Math.sqrt(2); // cos(45°)
    assert.ok(Math.abs(cosineSimilarity(a, b) - expected) < 1e-6);
  });
});

// ── evict ───────────────────────────────────────────────────────────────

describe('evict', () => {
  it('does nothing when map is within capacity', () => {
    const map = new Map<string, Float32Array>();
    map.set('a', vec(1));
    map.set('b', vec(2));
    const removed = evict(map, 5);
    assert.equal(removed, 0);
    assert.equal(map.size, 2);
  });

  it('removes oldest entries when over capacity', () => {
    const map = new Map<string, Float32Array>();
    map.set('a', vec(1));
    map.set('b', vec(2));
    map.set('c', vec(3));
    map.set('d', vec(4));

    const removed = evict(map, 2);
    assert.equal(removed, 2);
    assert.equal(map.size, 2);
    // a and b were inserted first → evicted
    assert.ok(!map.has('a'));
    assert.ok(!map.has('b'));
    assert.ok(map.has('c'));
    assert.ok(map.has('d'));
  });

  it('removes exactly the excess count', () => {
    const map = new Map<string, Float32Array>();
    for (let i = 0; i < 10; i++) map.set(`id-${i}`, vec(i));
    const removed = evict(map, 7);
    assert.equal(removed, 3);
    assert.equal(map.size, 7);
  });

  it('MAX_VECTORS is 20_000', () => {
    assert.equal(MAX_VECTORS, 20_000);
  });
});

// ── VectorCache integration (no DB) ────────────────────────────────────

describe('VectorCache (unit, no pool)', () => {
  it('starts empty', () => {
    const cache = makeCache();
    const size = cache.getSize();
    assert.equal(size.summaries, 0);
    assert.equal(size.reports, 0);
  });

  it('update adds vectors and getSize reflects them', () => {
    const cache = makeCache();
    cache.update('summary', 's1', vec(1, 0, 0));
    cache.update('summary', 's2', vec(0, 1, 0));
    cache.update('report', 'r1', vec(0, 0, 1));

    const size = cache.getSize();
    assert.equal(size.summaries, 2);
    assert.equal(size.reports, 1);
  });

  it('update with same ID replaces (no duplicates)', () => {
    const cache = makeCache();
    cache.update('summary', 's1', vec(1, 0));
    cache.update('summary', 's1', vec(0, 1));

    assert.equal(cache.getSize().summaries, 1);
  });

  it('search returns results sorted by descending score', () => {
    const cache = makeCache();
    // Insert vectors at known angles from query
    cache.update('summary', 'exact', vec(1, 0, 0));
    cache.update('summary', 'ortho', vec(0, 1, 0));
    cache.update('summary', 'close', vec(0.9, 0.1, 0));

    const results = cache.search(vec(1, 0, 0), 'summary');
    // orthogonal vector (score ~0) is below MIN_SIMILARITY threshold, filtered out
    assert.equal(results.length, 2);
    // exact match first
    assert.equal(results[0].targetId, 'exact');
    assert.ok(Math.abs(results[0].score - 1.0) < 1e-6);
    // close second
    assert.equal(results[1].targetId, 'close');
  });

  it('search respects limit', () => {
    const cache = makeCache();
    for (let i = 0; i < 20; i++) {
      const v = new Float32Array(3);
      v[0] = Math.cos(i);
      v[1] = Math.sin(i);
      cache.update('summary', `s-${i}`, v);
    }

    const results = cache.search(vec(1, 0, 0), 'summary', 5);
    assert.equal(results.length, 5);
  });

  it('search on empty type returns empty array', () => {
    const cache = makeCache();
    const results = cache.search(vec(1, 0), 'report');
    assert.equal(results.length, 0);
  });

  it('prune removes specified IDs across all types', () => {
    const cache = makeCache();
    cache.update('summary', 'shared-id', vec(1));
    cache.update('report', 'shared-id', vec(2));
    cache.update('report', 'other', vec(4));

    const removed = cache.prune(['shared-id']);
    assert.equal(removed, 2);
    assert.equal(cache.getSize().summaries, 0);
    assert.equal(cache.getSize().reports, 1);
  });

  it('prune returns 0 for unknown IDs', () => {
    const cache = makeCache();
    cache.update('summary', 's1', vec(1));
    const removed = cache.prune(['nonexistent']);
    assert.equal(removed, 0);
    assert.equal(cache.getSize().summaries, 1);
  });

  it('update ignores unknown target types', () => {
    const cache = makeCache();
    cache.update('unknown_type', 'x', vec(1));
    const size = cache.getSize();
    assert.equal(size.summaries + size.reports, 0);
  });

  it('eviction kicks in after MAX_VECTORS inserts', () => {
    // Use a small-scale test with the evict function directly
    // (inserting 20K vectors in a unit test is too slow)
    const cache = makeCache();
    const map = new Map<string, Float32Array>();

    // Simulate: fill to MAX_VECTORS + 5
    for (let i = 0; i < MAX_VECTORS + 5; i++) {
      map.set(`id-${i}`, vec(i % 100));
    }
    const removed = evict(map, MAX_VECTORS);
    assert.equal(removed, 5);
    assert.equal(map.size, MAX_VECTORS);

    // The first 5 entries should have been evicted
    assert.ok(!map.has('id-0'));
    assert.ok(!map.has('id-4'));
    assert.ok(map.has('id-5'));
    assert.ok(map.has(`id-${MAX_VECTORS + 4}`));
  });
});
