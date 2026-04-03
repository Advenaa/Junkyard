/**
 * Cycle-95 structural regression tests for EN-001 sentiment retry fix.
 *
 * EN-001: `runDaily` wraps `runDailyCore` with retry-once logic.
 *         On first failure, waits 2s, then retries. Second failure propagates.
 *
 * These are source-level pattern tests — they read the TypeScript source
 * and assert structural invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sentimentSrc = readFileSync(
  new URL('../../src/knowledge/sentiment.ts', import.meta.url), 'utf-8',
);

describe('EN-001 — runDailyCore extracted as separate function', () => {
  it('runDailyCore is declared as a standalone async function', () => {
    assert.match(
      sentimentSrc,
      /async\s+function\s+runDailyCore\s*\(/,
      'runDailyCore must be declared as a separate async function',
    );
  });
});

describe('EN-001 — runDaily calls runDailyCore (first attempt)', () => {
  it('runDaily body contains an await runDailyCore call', () => {
    // Find the runDaily function body
    const runDailyIdx = sentimentSrc.indexOf('async function runDaily(');
    assert.ok(runDailyIdx > -1, 'should find async function runDaily declaration');

    const afterRunDaily = sentimentSrc.slice(runDailyIdx);
    const firstCallIdx = afterRunDaily.indexOf('await runDailyCore(');
    assert.ok(
      firstCallIdx > -1,
      'runDaily must call await runDailyCore() for the first attempt',
    );
  });
});

describe('EN-001 — runDaily has catch block with warning log', () => {
  it('runDaily has a catch block that calls log.warn', () => {
    const runDailyIdx = sentimentSrc.indexOf('async function runDaily(');
    assert.ok(runDailyIdx > -1, 'should find runDaily declaration');

    const afterRunDaily = sentimentSrc.slice(runDailyIdx);
    const catchIdx = afterRunDaily.indexOf('catch');
    assert.ok(catchIdx > -1, 'runDaily must have a catch block');

    const catchBlock = afterRunDaily.slice(catchIdx, catchIdx + 200);
    assert.ok(
      catchBlock.includes('log.warn'),
      'catch block must call log.warn to log the first failure',
    );
  });
});

describe('EN-001 — runDaily has 2s delay before retry', () => {
  it('runDaily contains a setTimeout with 2000ms delay', () => {
    const runDailyIdx = sentimentSrc.indexOf('async function runDaily(');
    assert.ok(runDailyIdx > -1, 'should find runDaily declaration');

    const afterRunDaily = sentimentSrc.slice(runDailyIdx);
    // Match either setTimeout(resolve, 2000) or setTimeout(..., 2000) pattern
    assert.ok(
      afterRunDaily.includes('setTimeout(resolve, 2000)') ||
      afterRunDaily.includes('setTimeout(resolve,2000)'),
      'runDaily must contain setTimeout(resolve, 2000) for the 2s retry delay',
    );
  });
});

describe('EN-001 — runDaily retries runDailyCore after delay', () => {
  it('runDailyCore is called a second time after the setTimeout', () => {
    const runDailyIdx = sentimentSrc.indexOf('async function runDaily(');
    assert.ok(runDailyIdx > -1, 'should find runDaily declaration');

    const afterRunDaily = sentimentSrc.slice(runDailyIdx);
    const setTimeoutIdx = afterRunDaily.indexOf('setTimeout(resolve');
    assert.ok(setTimeoutIdx > -1, 'should find setTimeout for delay');

    const afterDelay = afterRunDaily.slice(setTimeoutIdx);
    const retryCallIdx = afterDelay.indexOf('await runDailyCore(');
    assert.ok(
      retryCallIdx > -1,
      'runDailyCore must be called again after the setTimeout delay (retry)',
    );
  });
});

describe('EN-001 — runDailyCore preserves idempotency guard', () => {
  it('runDailyCore checks entity_sentiment_daily WHERE date for idempotency', () => {
    const coreIdx = sentimentSrc.indexOf('async function runDailyCore(');
    assert.ok(coreIdx > -1, 'should find runDailyCore declaration');

    const coreBody = sentimentSrc.slice(coreIdx);
    assert.ok(
      coreBody.includes('entity_sentiment_daily WHERE date'),
      'runDailyCore must contain idempotency guard: entity_sentiment_daily WHERE date',
    );
  });
});

describe('EN-001 — runDailyCore preserves transaction management', () => {
  it('runDailyCore has BEGIN, COMMIT, and ROLLBACK', () => {
    const coreIdx = sentimentSrc.indexOf('async function runDailyCore(');
    assert.ok(coreIdx > -1, 'should find runDailyCore declaration');

    // Scope to runDailyCore body only (up to next top-level function)
    const nextFnIdx = sentimentSrc.indexOf('async function runDaily(', coreIdx);
    const coreBody = sentimentSrc.slice(coreIdx, nextFnIdx > -1 ? nextFnIdx : undefined);

    assert.ok(
      coreBody.includes("'BEGIN'"),
      'runDailyCore must contain BEGIN transaction',
    );
    assert.ok(
      coreBody.includes("'COMMIT'"),
      'runDailyCore must contain COMMIT transaction',
    );
    assert.ok(
      coreBody.includes("'ROLLBACK'"),
      'runDailyCore must contain ROLLBACK on error',
    );
  });
});
