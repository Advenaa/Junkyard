/**
 * Cycle-99 structural regression tests for pre-summarize fixes.
 *
 * PS-020: Atomic claim (UPDATE + FOR UPDATE SKIP LOCKED + RETURNING)
 * PS-021: Livelock guard (retry_count < 3, increment on failure, reset to ready)
 * PS-022: ORDER BY created_at ASC for deterministic processing
 * PS-023: Token budget uses 500 * batch.length
 *
 * Source-level pattern tests — read TypeScript source and assert structural
 * invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(
  new URL('../../src/pre-summarize/index.ts', import.meta.url), 'utf-8',
);

describe('PS-020 — Atomic claim', () => {
  it('uses UPDATE items SET status = \'processing\' (not just SELECT)', () => {
    assert.ok(
      src.includes("UPDATE items SET status = 'processing'"),
      "claim query should use UPDATE items SET status = 'processing'",
    );
  });

  it('uses FOR UPDATE SKIP LOCKED', () => {
    assert.ok(
      src.includes('FOR UPDATE SKIP LOCKED'),
      'claim query should use FOR UPDATE SKIP LOCKED to prevent race conditions',
    );
  });

  it('has a RETURNING clause', () => {
    // Find the claim query (the UPDATE ... SET status = 'processing' block)
    const claimStart = src.indexOf("UPDATE items SET status = 'processing'");
    assert.ok(claimStart > -1, 'should find the claim query');

    const afterClaim = src.slice(claimStart);
    // RETURNING should appear before the next pool.query or closing backtick
    const returningIdx = afterClaim.indexOf('RETURNING');
    const closingBacktick = afterClaim.indexOf('`', 1);

    assert.ok(returningIdx > -1, 'claim query should have a RETURNING clause');
    assert.ok(
      returningIdx < closingBacktick,
      'RETURNING clause should be inside the claim query',
    );
  });
});

describe('PS-021 — Livelock guard', () => {
  it('claim query includes retry_count < 3', () => {
    const claimStart = src.indexOf("UPDATE items SET status = 'processing'");
    assert.ok(claimStart > -1, 'should find the claim query');

    const afterClaim = src.slice(claimStart);
    const closingBacktick = afterClaim.indexOf('`', 1);
    const claimQuery = afterClaim.slice(0, closingBacktick);

    assert.ok(
      claimQuery.includes('retry_count < 3'),
      'claim query should include retry_count < 3 to prevent livelock',
    );
  });

  it('increments retry_count on parse failure', () => {
    assert.ok(
      src.includes('retry_count = retry_count + 1'),
      'should increment retry_count on parse failure',
    );
  });

  it('sets failed items back to status = \'ready\'', () => {
    // Find the retry_count increment query and verify it also sets status = 'ready'
    const retryIdx = src.indexOf('retry_count = retry_count + 1');
    assert.ok(retryIdx > -1, 'should find retry_count increment');

    // Look at the surrounding UPDATE statement
    const lineStart = src.lastIndexOf('UPDATE', retryIdx);
    const lineEnd = src.indexOf('`', retryIdx);
    const updateStmt = src.slice(lineStart, lineEnd);

    assert.ok(
      updateStmt.includes("status = 'ready'"),
      "retry_count increment query should also set status = 'ready'",
    );
  });
});

describe('PS-022 — ORDER BY', () => {
  it('claim query includes ORDER BY created_at ASC', () => {
    const claimStart = src.indexOf("UPDATE items SET status = 'processing'");
    assert.ok(claimStart > -1, 'should find the claim query');

    const afterClaim = src.slice(claimStart);
    const closingBacktick = afterClaim.indexOf('`', 1);
    const claimQuery = afterClaim.slice(0, closingBacktick);

    assert.ok(
      claimQuery.includes('ORDER BY created_at ASC'),
      'claim query should include ORDER BY created_at ASC for deterministic order',
    );
  });
});

describe('PS-023 — Token budget', () => {
  it('maxTokens uses 500 * batch.length (not 300)', () => {
    assert.ok(
      src.includes('500 * batch.length'),
      'maxTokens should use 500 * batch.length',
    );
    assert.ok(
      !src.includes('300 * batch.length'),
      'maxTokens should NOT use 300 * batch.length',
    );
  });
});
