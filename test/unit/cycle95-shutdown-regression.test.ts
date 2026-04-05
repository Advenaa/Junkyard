/**
 * Cycle-95 structural regression tests for shutdown fix.
 *
 * SL-012: Force-exit timeout changed from 30s to 60s, paired with .unref(),
 *         scheduler stop deadline (25s) must be less than force-exit timeout,
 *         and process.exit(1) lives inside the setTimeout callback.
 *
 * These are source-level pattern tests — they read the TypeScript source
 * and assert structural invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSrc = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf-8');
const schedulerSrc = readFileSync(new URL('../../src/scheduler.ts', import.meta.url), 'utf-8');

describe('SL-012 — force-exit timeout upgraded to 60s with .unref()', () => {
  it('shutdown section contains 60_000 (not 30_000)', () => {
    const shutdownIdx = indexSrc.indexOf('Graceful shutdown');
    assert.ok(shutdownIdx > -1, 'should find "Graceful shutdown" section comment');

    const shutdownSection = indexSrc.slice(shutdownIdx);
    assert.ok(shutdownSection.includes('60_000'), 'force-exit timeout must be 60_000');
    assert.ok(!shutdownSection.includes('30_000'), 'old 30_000 timeout must not be present in shutdown section');
  });

  it('setTimeout call is paired with .unref()', () => {
    const match = indexSrc.match(/setTimeout\(\s*\(\)\s*=>\s*process\.exit\(\s*1\s*\)\s*,\s*60_000\s*\)\.unref\(\)/);
    assert.ok(match, 'setTimeout(() => process.exit(1), 60_000).unref() must appear as a single chained expression');
  });

  it('scheduler stop deadline (25_000) is less than force-exit timeout (60_000)', () => {
    const deadlineMatch = schedulerSrc.match(/Date\.now\(\)\s*\+\s*(\d[\d_]*)/);
    assert.ok(deadlineMatch, 'should find Date.now() + <deadline> in scheduler.ts');
    const schedulerDeadline = Number(deadlineMatch[1].replace(/_/g, ''));

    const timeoutMatch = indexSrc.match(/setTimeout\([^,]+,\s*(\d[\d_]*)\s*\)/);
    assert.ok(timeoutMatch, 'should find setTimeout(…, <timeout>) in index.ts');
    const forceExitTimeout = Number(timeoutMatch[1].replace(/_/g, ''));

    assert.ok(
      schedulerDeadline < forceExitTimeout,
      `scheduler stop deadline (${schedulerDeadline}) must be less than force-exit timeout (${forceExitTimeout})`,
    );
  });

  it('process.exit(1) is inside the setTimeout callback (hard kill)', () => {
    const setTimeoutIdx = indexSrc.indexOf('setTimeout(');
    assert.ok(setTimeoutIdx > -1, 'should find setTimeout call');

    // Extract the callback: everything between setTimeout( and the matching timeout value
    const snippet = indexSrc.slice(setTimeoutIdx, setTimeoutIdx + 80);
    assert.ok(snippet.includes('process.exit(1)'), 'process.exit(1) must be inside the setTimeout callback expression');
  });
});
