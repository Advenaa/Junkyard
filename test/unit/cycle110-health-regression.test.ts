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

const healthSrc = readFileSync(new URL('../../src/health.ts', import.meta.url), 'utf-8');

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
    assert.ok(cancelCount >= 2, `Expected at least 2 body cancel calls (ok + non-ok paths), found ${cancelCount}`);
  });
});

// ── HE-011 — Health event dedup matches on category only (HM-021: now atomic) ──

describe('HE-011: Health event dedup matches on category only (atomic via HM-021)', () => {
  it('health event INSERT uses WHERE NOT EXISTS for atomic dedup', () => {
    assert.ok(
      healthSrc.includes('WHERE NOT EXISTS'),
      'insertEvent must use WHERE NOT EXISTS for atomic dedup (HM-021)',
    );
  });

  it('dedup filters on category', () => {
    assert.ok(/category\s*=\s*\$2/.test(healthSrc), 'Dedup subquery must filter on category');
  });

  it('dedup filters on acknowledged = false', () => {
    assert.ok(/acknowledged\s*=\s*false/.test(healthSrc), 'Dedup subquery must filter on acknowledged = false');
  });

  it('does NOT filter on message in the dedup SQL', () => {
    // Extract the INSERT...WHERE NOT EXISTS block
    const insertIdx = healthSrc.indexOf('INSERT INTO health_events');
    const blockEnd = healthSrc.indexOf(')', healthSrc.indexOf('WHERE NOT EXISTS', insertIdx) + 50);
    const dedupBlock = healthSrc.slice(insertIdx, blockEnd + 50);
    assert.ok(
      !dedupBlock.includes('AND message =') && !dedupBlock.includes('AND message='),
      'Dedup SQL must NOT filter on message — dedup is by category only',
    );
  });
});
