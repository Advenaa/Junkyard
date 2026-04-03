/**
 * Cycle-95 structural regression tests for SP-003 stale processing recovery.
 *
 * SP-003: `recoverStaleProcessing` in src/db/queries.ts recovers items stuck
 * in 'processing' mid-run using ULID timestamp decoding via `decodeTime`.
 *
 * These are source-level pattern tests — they read the TypeScript source
 * and assert structural invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const queriesSrc = readFileSync(
  new URL('../../src/db/queries.ts', import.meta.url), 'utf-8',
);
const indexSrc = readFileSync(
  new URL('../../src/index.ts', import.meta.url), 'utf-8',
);

describe('SP-003 — recoverStaleProcessing exists and is exported', () => {
  it('exports an async function named recoverStaleProcessing', () => {
    assert.ok(
      queriesSrc.includes('export async function recoverStaleProcessing'),
      'queries.ts must export async function recoverStaleProcessing',
    );
  });

  it('imports decodeTime from ulid for ULID timestamp extraction', () => {
    assert.ok(
      queriesSrc.includes("decodeTime") && queriesSrc.includes("from 'ulid'"),
      'queries.ts must import decodeTime from ulid',
    );
  });
});

describe('SP-003 — recoverStaleProcessing parameters', () => {
  it('has a staleMinutes parameter with default 30', () => {
    assert.match(
      queriesSrc,
      /staleMinutes\s*=\s*30/,
      'recoverStaleProcessing must have staleMinutes parameter defaulting to 30',
    );
  });

  it('has a maxRetries parameter with default 3', () => {
    assert.match(
      queriesSrc,
      /maxRetries\s*=\s*3/,
      'recoverStaleProcessing must have maxRetries parameter defaulting to 3',
    );
  });
});

describe('SP-003 — recoverStaleProcessing recovery logic', () => {
  it('marks exhausted items (retry_count >= maxRetries) as failed', () => {
    const fnStart = queriesSrc.indexOf('export async function recoverStaleProcessing');
    const fnBody = queriesSrc.slice(fnStart);

    assert.ok(
      fnBody.includes('retry_count >= maxRetries'),
      'must check retry_count >= maxRetries to identify exhausted items',
    );
    assert.ok(
      fnBody.includes("status = 'failed'"),
      'exhausted items must be set to failed status',
    );
  });

  it('resets stale items to ready with retry_count incremented', () => {
    const fnStart = queriesSrc.indexOf('export async function recoverStaleProcessing');
    const fnBody = queriesSrc.slice(fnStart);

    assert.ok(
      fnBody.includes("status = 'ready'"),
      'stale items must be reset to ready status',
    );
    assert.ok(
      fnBody.includes('retry_count = retry_count + 1'),
      'stale items must have retry_count incremented',
    );
  });

  it('wraps updates in a transaction (BEGIN/COMMIT pattern)', () => {
    const fnStart = queriesSrc.indexOf('export async function recoverStaleProcessing');
    const fnBody = queriesSrc.slice(fnStart);
    const beginIdx = fnBody.indexOf("'BEGIN'");
    const commitIdx = fnBody.indexOf("'COMMIT'");

    assert.ok(beginIdx > -1, 'must call BEGIN to start transaction');
    assert.ok(commitIdx > -1, 'must call COMMIT to end transaction');
    assert.ok(
      commitIdx > beginIdx,
      'COMMIT must appear after BEGIN',
    );
  });

  it('handles malformed ULIDs gracefully by setting claimedAt = 0 in catch block', () => {
    const fnStart = queriesSrc.indexOf('export async function recoverStaleProcessing');
    const fnBody = queriesSrc.slice(fnStart);
    const decodeIdx = fnBody.indexOf('decodeTime(');
    const catchIdx = fnBody.indexOf('catch', decodeIdx);
    const fallbackIdx = fnBody.indexOf('claimedAt = 0', catchIdx);

    assert.ok(decodeIdx > -1, 'must call decodeTime');
    assert.ok(catchIdx > decodeIdx, 'must have catch block after decodeTime call');
    assert.ok(
      fallbackIdx > catchIdx,
      'catch block must set claimedAt = 0 for malformed ULIDs',
    );
  });
});

describe('SP-003 — wiring in src/index.ts', () => {
  it('imports recoverStaleProcessing from db/queries', () => {
    assert.ok(
      indexSrc.includes('recoverStaleProcessing'),
      'index.ts must import recoverStaleProcessing',
    );
    assert.match(
      indexSrc,
      /import\s*\{[^}]*recoverStaleProcessing[^}]*\}\s*from\s*['"]\.\/db\/queries/,
      'recoverStaleProcessing must be imported from ./db/queries',
    );
  });

  it('calls recoverStaleProcessing within onHealthCheck', () => {
    const healthCheckIdx = indexSrc.indexOf('async function onHealthCheck');
    assert.ok(healthCheckIdx > -1, 'index.ts must define onHealthCheck function');

    const afterHealthCheck = indexSrc.slice(healthCheckIdx);
    // Find the end of onHealthCheck — look for the next top-level function or closing pattern
    const callIdx = afterHealthCheck.indexOf('recoverStaleProcessing(');
    assert.ok(
      callIdx > -1,
      'recoverStaleProcessing must be called inside onHealthCheck',
    );
  });
});
