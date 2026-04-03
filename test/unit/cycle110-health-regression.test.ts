/**
 * Cycle-110 structural regression tests — health module.
 *
 * HE-010: Response body consumed on non-ok webhook responses
 * HE-011: isDuplicate matches on category only (not category + message)
 *
 * Source-level pattern tests — read TypeScript source and assert structural
 * invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const healthSrc = readFileSync(
  new URL('../../src/health.ts', import.meta.url), 'utf-8',
);

// ── HE-010 — Response body consumed on non-ok webhook ────────────────

describe('HE-010: response body consumed on non-ok webhook', () => {
  it('references response.body in sendAlertWebhook', () => {
    assert.ok(
      healthSrc.includes('response.body'),
      'sendAlertWebhook must reference response.body to prevent resource leaks',
    );
  });

  it('calls .cancel() on response body', () => {
    assert.ok(
      /response\.body\?\.cancel\(\)/.test(healthSrc),
      'sendAlertWebhook must call response.body?.cancel() to consume the body',
    );
  });

  it('consumes body on non-ok path (before early return on client error)', () => {
    // The section between "if (response.ok)" and the retry delay should
    // contain at least two body cancellations (ok path + non-ok path)
    const cancelCount = (healthSrc.match(/response\.body\?\.cancel\(\)/g) || []).length;
    assert.ok(
      cancelCount >= 2,
      `Expected at least 2 body cancel calls (ok + non-ok paths), found ${cancelCount}`,
    );
  });
});

// ── HE-011 — isDuplicate matches on category only ────────────────────

describe('HE-011: isDuplicate matches on category only', () => {
  // Extract the isDuplicate function body for targeted assertions
  const isDupMatch = healthSrc.match(
    /async function isDuplicate\b[\s\S]*?^  \}/m,
  );
  const isDupBody = isDupMatch ? isDupMatch[0] : '';

  it('isDuplicate function exists', () => {
    assert.ok(isDupBody.length > 0, 'isDuplicate function must exist in health.ts');
  });

  it('does NOT filter on message in the SQL query', () => {
    assert.ok(
      !isDupBody.includes('AND message ='),
      'isDuplicate SQL must NOT contain "AND message =" — dedup is by category only',
    );
    assert.ok(
      !isDupBody.includes('AND message='),
      'isDuplicate SQL must NOT contain "AND message=" — dedup is by category only',
    );
  });

  it('filters on category = $1', () => {
    assert.ok(
      /category\s*=\s*\$1/.test(isDupBody),
      'isDuplicate SQL must filter on category = $1',
    );
  });

  it('filters on acknowledged = false', () => {
    assert.ok(
      /acknowledged\s*=\s*false/.test(isDupBody),
      'isDuplicate SQL must filter on acknowledged = false',
    );
  });

  it('function signature does not use message in the query', () => {
    // The function should accept only category (no message param used in query)
    const sigMatch = isDupBody.match(/async function isDuplicate\(([^)]*)\)/);
    assert.ok(sigMatch, 'isDuplicate signature must be extractable');
    const params = sigMatch![1];
    // If message param exists, it must not appear as a bind parameter in the query
    if (params.includes('message')) {
      // message param exists but must not be used in the SQL bind array
      const bindArray = isDupBody.match(/\],\s*\[([^\]]*)\]/);
      if (bindArray) {
        assert.ok(
          !bindArray[1].includes('message'),
          'isDuplicate must not pass message to the SQL query bind parameters',
        );
      }
    }
    // Primary check: signature should only take category
    assert.ok(
      /async function isDuplicate\(\s*category:\s*string\s*\)/.test(isDupBody),
      'isDuplicate should accept only category parameter',
    );
  });
});
