/**
 * Structural regression tests for Discord adapter fixes (DC-011, DC-012, DC-013, DC-015).
 *
 * These tests read the source text of src/ingest/discord.ts and assert code patterns,
 * ensuring fixes stay in place across refactors.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DISCORD_SRC = resolve(__dirname, '../../src/ingest/discord.ts');

let source: string;

before(() => {
  source = readFileSync(DISCORD_SRC, 'utf-8');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a function/method body by name using brace-depth counting. */
function extractFunctionBody(src: string, name: string): string {
  const fnStart = src.indexOf(name);
  assert.ok(fnStart !== -1, `function/method "${name}" must exist in source`);

  const braceStart = src.indexOf('{', fnStart);
  assert.ok(braceStart !== -1, `opening brace for "${name}" not found`);

  let depth = 0;
  let fnEnd = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') depth--;
    if (depth === 0) {
      fnEnd = i;
      break;
    }
  }
  assert.ok(fnEnd > fnStart, `could not find closing brace for "${name}"`);
  return src.slice(fnStart, fnEnd + 1);
}

// ---------------------------------------------------------------------------
// DC-013: handleMessageCreate has shutdown guard
// ---------------------------------------------------------------------------

describe('DC-013: handleMessageCreate shutdown guard', () => {
  it('has an early destroyed check as the first guard', () => {
    const body = extractFunctionBody(source, 'private async handleMessageCreate');

    assert.ok(
      body.includes('if (this.destroyed) return'),
      'handleMessageCreate must have an early `if (this.destroyed) return` guard',
    );
  });

  it('destroyed guard appears before any message processing', () => {
    const body = extractFunctionBody(source, 'private async handleMessageCreate');

    const destroyedIdx = body.indexOf('if (this.destroyed) return');
    const channelCheckIdx = body.indexOf('assignedChannels');

    assert.ok(destroyedIdx !== -1, 'destroyed guard must exist');
    assert.ok(channelCheckIdx !== -1, 'channel filtering must exist');
    assert.ok(destroyedIdx < channelCheckIdx, 'destroyed guard must come before channel filtering logic');
  });
});

// ---------------------------------------------------------------------------
// DC-011: handleClose only increments errorCount for non-resumable codes
// ---------------------------------------------------------------------------

describe('DC-011: handleClose conditional errorCount increment', () => {
  it('errorCount increment is guarded by RESUMABLE_CLOSE_CODES check', () => {
    const body = extractFunctionBody(source, 'private handleClose');

    // The increment must be inside a !RESUMABLE_CLOSE_CODES.has(code) block
    assert.ok(
      body.includes('!RESUMABLE_CLOSE_CODES.has(code)'),
      'handleClose must check !RESUMABLE_CLOSE_CODES.has(code)',
    );

    const guardIdx = body.indexOf('!RESUMABLE_CLOSE_CODES.has(code)');
    const incrementIdx = body.indexOf('errorCount += 1', guardIdx);

    assert.ok(incrementIdx !== -1, 'errorCount increment must exist after the RESUMABLE_CLOSE_CODES guard');
    assert.ok(
      incrementIdx - guardIdx < 80,
      'errorCount increment must be close to the RESUMABLE_CLOSE_CODES guard (inside the if block)',
    );
  });

  it('RESUMABLE_CLOSE_CODES set is defined with expected codes', () => {
    assert.ok(source.includes('RESUMABLE_CLOSE_CODES'), 'RESUMABLE_CLOSE_CODES constant must be defined');
    // Must include the key resumable codes
    const match = source.match(/RESUMABLE_CLOSE_CODES[^=]*=\s*new Set\(([^)]+)\)/);
    assert.ok(match, 'RESUMABLE_CLOSE_CODES must be a Set');
    assert.ok(match![1].includes('4000'), 'RESUMABLE_CLOSE_CODES must include 4000');
    assert.ok(match![1].includes('4009'), 'RESUMABLE_CLOSE_CODES must include 4009');
  });
});

// ---------------------------------------------------------------------------
// DC-012: closeAndResume increments errorCount and calls checkCircuitBreaker
// ---------------------------------------------------------------------------

describe('DC-012: closeAndResume circuit breaker integration', () => {
  it('closeAndResume increments errorCount', () => {
    const body = extractFunctionBody(source, 'private closeAndResume');

    assert.ok(
      body.includes('errorCount += 1') || body.includes('errorCount++'),
      'closeAndResume must increment errorCount',
    );
  });

  it('closeAndResume calls checkCircuitBreaker after incrementing errorCount', () => {
    const body = extractFunctionBody(source, 'private closeAndResume');

    const incrementIdx = body.indexOf('errorCount');
    const cbIdx = body.indexOf('checkCircuitBreaker()');

    assert.ok(incrementIdx !== -1, 'errorCount reference must exist');
    assert.ok(cbIdx !== -1, 'checkCircuitBreaker() call must exist');
    assert.ok(incrementIdx < cbIdx, 'errorCount increment must come before checkCircuitBreaker() call');
  });

  it('closeAndResume returns early if circuit breaker trips', () => {
    const body = extractFunctionBody(source, 'private closeAndResume');

    // Pattern: if (this.checkCircuitBreaker()) return;
    assert.ok(
      body.includes('checkCircuitBreaker()) return'),
      'closeAndResume must return early when checkCircuitBreaker() returns true',
    );
  });
});

// ---------------------------------------------------------------------------
// DC-015: connectedAt / reconnectAttempt backoff reset semantics
// ---------------------------------------------------------------------------

describe('DC-015: connectedAt and backoff reset semantics', () => {
  it('TokenState includes connectedAt field', () => {
    assert.ok(
      source.includes('connectedAt: number | null') || source.includes('connectedAt:number|null'),
      'TokenState must include connectedAt: number | null',
    );
  });

  it('RESUMED handler sets connectedAt but does NOT directly reset reconnectAttempt', () => {
    const body = extractFunctionBody(source, 'private handleDispatch');

    // Find the RESUMED case block
    const resumedIdx = body.indexOf("'RESUMED'");
    assert.ok(resumedIdx !== -1, 'RESUMED case must exist in handleDispatch');

    // Slice from RESUMED to the next case or end of switch
    const afterResumed = body.slice(resumedIdx, resumedIdx + 300);

    assert.ok(afterResumed.includes('connectedAt = Date.now()'), 'RESUMED handler must set connectedAt = Date.now()');
    assert.ok(
      !afterResumed.includes('reconnectAttempt = 0'),
      'RESUMED handler must NOT directly set reconnectAttempt = 0 (backoff reset happens in resumeWithBackoff)',
    );
  });

  it('READY handler sets connectedAt but does NOT directly reset reconnectAttempt', () => {
    const body = extractFunctionBody(source, 'private handleReady');

    assert.ok(body.includes('connectedAt = Date.now()'), 'handleReady must set connectedAt = Date.now()');
    assert.ok(!body.includes('reconnectAttempt = 0'), 'handleReady must NOT directly set reconnectAttempt = 0');
  });

  it('resumeWithBackoff resets reconnectAttempt only when connection was stable >30s', () => {
    const body = extractFunctionBody(source, 'private async resumeWithBackoff');

    // Must reference connectedAt and a stability threshold
    assert.ok(
      body.includes('connectedAt') && body.includes('STABLE_THRESHOLD_MS'),
      'resumeWithBackoff must check connectedAt against STABLE_THRESHOLD_MS',
    );

    // reconnectAttempt = 0 must be inside the stability check, not unconditional
    const thresholdIdx = body.indexOf('STABLE_THRESHOLD_MS');
    const resetIdx = body.indexOf('reconnectAttempt = 0');
    assert.ok(resetIdx !== -1, 'reconnectAttempt = 0 must exist in resumeWithBackoff');
    assert.ok(resetIdx > thresholdIdx, 'reconnectAttempt reset must come after the stability threshold check');
  });
});
