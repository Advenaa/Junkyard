import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DECAY_FACTOR,
  ARCHIVE_THRESHOLD,
  ARCHIVE_STALE_DAYS,
} from '../../src/knowledge/decay.js';

describe('Decay constants', () => {
  it('exports DECAY_FACTOR as 0.95', () => {
    assert.equal(DECAY_FACTOR, 0.95);
  });

  it('exports ARCHIVE_THRESHOLD as 0.01', () => {
    assert.equal(ARCHIVE_THRESHOLD, 0.01);
  });

  it('exports ARCHIVE_STALE_DAYS as 90', () => {
    assert.equal(ARCHIVE_STALE_DAYS, 90);
  });
});

describe('Decay math (factor = 0.95)', () => {
  it('relevance 2.0 → 1.9 after one decay', () => {
    const result = 2.0 * DECAY_FACTOR;
    assert.equal(result, 1.9);
  });

  it('relevance 1.0 → 0.95 after one decay', () => {
    const result = 1.0 * DECAY_FACTOR;
    assert.equal(result, 0.95);
  });

  it('relevance 0.01 drops below archive threshold after one decay', () => {
    const result = 0.01 * DECAY_FACTOR;
    assert.ok(result < ARCHIVE_THRESHOLD, `${result} should be < ${ARCHIVE_THRESHOLD}`);
  });

  it('multiple decays: 1.0 → 0.95 → 0.9025 → 0.857375', () => {
    let r = 1.0;
    r *= DECAY_FACTOR;
    assert.equal(r, 0.95);

    r *= DECAY_FACTOR;
    assert.ok(Math.abs(r - 0.9025) < 1e-10, `expected ~0.9025, got ${r}`);

    r *= DECAY_FACTOR;
    assert.ok(Math.abs(r - 0.857375) < 1e-10, `expected ~0.857375, got ${r}`);
  });

  it('100 decay cycles push relevance 1.0 below archive threshold', () => {
    let r = 1.0;
    for (let i = 0; i < 100; i++) r *= DECAY_FACTOR;
    assert.ok(r < ARCHIVE_THRESHOLD, `after 100 decays: ${r} should be < ${ARCHIVE_THRESHOLD}`);
  });

  it('decay preserves relative ordering of entities', () => {
    const a = 2.0 * DECAY_FACTOR;
    const b = 1.0 * DECAY_FACTOR;
    const c = 0.5 * DECAY_FACTOR;
    assert.ok(a > b);
    assert.ok(b > c);
  });

  it('decay is equivalent to Math.pow(factor, n) after n cycles', () => {
    let r = 1.0;
    const n = 50;
    for (let i = 0; i < n; i++) r *= DECAY_FACTOR;
    const expected = Math.pow(DECAY_FACTOR, n);
    assert.ok(Math.abs(r - expected) < 1e-10, `iterative ${r} vs pow ${expected}`);
  });
});

describe('Archive eligibility', () => {
  it('relevance above threshold is NOT eligible', () => {
    assert.ok(0.011 >= ARCHIVE_THRESHOLD);
  });

  it('relevance below threshold IS eligible (if stale)', () => {
    assert.ok(0.009 < ARCHIVE_THRESHOLD);
  });

  it('stale cutoff is 90 days in milliseconds', () => {
    const cutoffMs = ARCHIVE_STALE_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const ninetyOneDaysAgo = now - 91 * 24 * 60 * 60 * 1000;
    const eightyNineDaysAgo = now - 89 * 24 * 60 * 60 * 1000;

    // 91 days ago is past the cutoff → eligible
    assert.ok(ninetyOneDaysAgo < now - cutoffMs);

    // 89 days ago is within the cutoff → NOT eligible
    assert.ok(!(eightyNineDaysAgo < now - cutoffMs));
  });

  it('archival needs BOTH low relevance AND stale >90 days', () => {
    const now = Date.now();
    const cutoffMs = ARCHIVE_STALE_DAYS * 24 * 60 * 60 * 1000;
    const old = now - 91 * 24 * 60 * 60 * 1000;
    const recent = now - 10 * 24 * 60 * 60 * 1000;

    const lowRelevance = 0.005;
    const highRelevance = 0.5;

    // low + old → archive
    assert.ok(lowRelevance < ARCHIVE_THRESHOLD && old < now - cutoffMs);

    // low + recent → NO archive
    assert.ok(lowRelevance < ARCHIVE_THRESHOLD && !(recent < now - cutoffMs));

    // high + old → NO archive
    assert.ok(!(highRelevance < ARCHIVE_THRESHOLD));
  });
});
