/**
 * Cycle 121 — structural regression tests for server + ops fixes.
 *
 * These tests read source files and assert code patterns that must hold
 * to prevent regressions on SR-009, SR-002, SC-013, OP-001, and OP-002.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');

const server = readFileSync(resolve(root, 'src/server.ts'), 'utf-8');
const scheduler = readFileSync(resolve(root, 'src/scheduler.ts'), 'utf-8');
const index = readFileSync(resolve(root, 'src/index.ts'), 'utf-8');
const retention = readFileSync(resolve(root, 'src/ops/retention.ts'), 'utf-8');

// ── SR-009: Webhook test truncates error response detail ──────────────

describe('SR-009 — webhook test truncates response detail', () => {
  it('error response text is sliced to 200 chars', () => {
    assert.ok(
      server.includes('.slice(0, 200)'),
      'Expected .slice(0, 200) in server.ts to truncate webhook error response detail',
    );
  });

  it('slice appears in the webhook test error handling path', () => {
    // The slice should be near a Webhook returned status message
    const webhookErrorBlock = server.match(/Webhook returned.*\.slice\(0,\s*200\)/s);
    assert.ok(webhookErrorBlock, 'Expected .slice(0, 200) to appear near the webhook error response path');
  });
});

// ── SR-002: PATCH /sources params schema has source enum ──────────────

describe('SR-002 — PATCH /sources has source enum in params schema', () => {
  it('params schema for PATCH /sources includes source enum with all four types', () => {
    // Find the PATCH /sources/:source/:sourceId route specifically
    const patchIdx = server.indexOf("'/api/v1/sources/:source/:sourceId'");
    assert.ok(patchIdx !== -1, 'PATCH /sources/:source/:sourceId route must exist');
    // Look within 1500 chars of the route for the enum
    const routeBlock = server.slice(patchIdx, patchIdx + 1500);
    const enumMatch = routeBlock.match(/enum:\s*\[([^\]]+)\]/);
    assert.ok(enumMatch, 'Expected params enum in PATCH /sources route');

    const enumValues = enumMatch[1];
    for (const source of ['discord', 'twitter', 'rss', 'news']) {
      assert.ok(enumValues.includes(`'${source}'`), `Expected '${source}' in PATCH /sources params enum`);
    }
  });
});

// ── SC-013: buildDailyCron validates hour/minute range ────────────────

describe('SC-013 — buildDailyCron validates hour and minute range', () => {
  it('validates hour is between 0 and 23', () => {
    assert.ok(
      scheduler.includes('hour >= 0 && hour <= 23'),
      'Expected hour >= 0 && hour <= 23 validation in buildDailyCron',
    );
  });

  it('validates minute is between 0 and 59', () => {
    assert.ok(
      scheduler.includes('minute >= 0 && minute <= 59'),
      'Expected minute >= 0 && minute <= 59 validation in buildDailyCron',
    );
  });
});

// ── OP-001: Advisory unlock has .catch() ──────────────────────────────

describe('OP-001 — pg_advisory_unlock calls have .catch()', () => {
  it('every pg_advisory_unlock is followed by .catch()', () => {
    const unlockCalls = [...index.matchAll(/pg_advisory_unlock\(\d+\)/g)];
    assert.ok(unlockCalls.length > 0, 'Expected at least one pg_advisory_unlock call in index.ts');

    // Each unlock call must be followed by .catch( within a short span
    const unlockWithCatch = [...index.matchAll(/pg_advisory_unlock\(\d+\).*?\.catch\(/gs)];
    assert.equal(
      unlockWithCatch.length,
      unlockCalls.length,
      `Expected all ${unlockCalls.length} pg_advisory_unlock calls to have .catch(), found ${unlockWithCatch.length}`,
    );
  });
});

// ── OP-002: Retention has embedding iteration cap ─────────────────────

describe('OP-002 — retention has embedding iteration cap', () => {
  it('defines MAX_EMBEDDING_ITERATIONS constant', () => {
    assert.ok(
      retention.includes('MAX_EMBEDDING_ITERATIONS'),
      'Expected MAX_EMBEDDING_ITERATIONS constant in retention.ts',
    );
  });

  it('loop condition checks iterations against the cap', () => {
    const loopGuard = retention.match(/iterations\s*<\s*MAX_EMBEDDING_ITERATIONS/);
    assert.ok(loopGuard, 'Expected loop to check iterations < MAX_EMBEDDING_ITERATIONS');
  });
});
