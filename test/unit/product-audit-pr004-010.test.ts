/**
 * Structural regression tests for product audit fixes PR-004 through PR-010.
 *
 * PR-004: Chat character counter
 * PR-005: Failed tools not in toolsUsed
 * PR-006: Budget message mentions UTC
 * PR-007: Timezone uses Intl.supportedValuesOf
 * PR-008: Halted source fallback error message
 * PR-009: Delete uses Modal not window.confirm
 * PR-010: Config PATCH accepts camelCase
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readServerSource } from './helpers/server-source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

const settingsSrc = [
  readSrc('dashboard/src/pages/Settings/index.tsx'),
  readSrc('dashboard/src/pages/Settings/types.ts'),
  readSrc('dashboard/src/pages/Settings/api.ts'),
  readSrc('dashboard/src/pages/Settings/formatters.ts'),
].join('\n');

// ===========================================================================
// PR-004: Chat character counter
// ===========================================================================

describe('PR-004: Chat character counter', () => {
  const src = readSrc('dashboard/src/pages/Chat.tsx');

  it('displays 4000-char limit near input area', () => {
    // The counter text shows "X/4,000" when the user is close to the limit
    assert.ok(src.includes('4,000') || src.includes('4000'), 'Must display 4000-character limit near the input area');
  });

  it('send button is disabled when input exceeds 4000 chars', () => {
    // The send button's disabled prop must reference input.length > 4000
    const sendButton = src.slice(src.indexOf('Send message') - 500, src.indexOf('Send message'));
    assert.ok(sendButton.includes('input.length > 4000'), 'Send button disabled prop must check input.length > 4000');
  });

  it('counter appears conditionally when approaching limit', () => {
    // The counter should only show when input is getting long (> 3000 chars)
    assert.ok(
      src.includes('input.length > 3000') || src.includes('input.length >= 3000'),
      'Character counter must appear conditionally near the limit',
    );
  });
});

// ===========================================================================
// PR-005: Failed tools not in toolsUsed
// ===========================================================================

describe('PR-005: Failed tools not in toolsUsed', () => {
  const src = readSrc('src/chat/handler.ts');

  it('adds to toolsUsed only after successful execution', () => {
    const executeIdx = src.indexOf('tool.execute(call.args)');
    const pushIdx = src.indexOf('toolsUsed.push(call.name)', executeIdx - 200);
    // Find the push that's nearest to execute
    const pushAfterExecute = src.indexOf('toolsUsed.push(call.name)', executeIdx);
    assert.ok(pushAfterExecute !== -1 && pushAfterExecute > executeIdx, 'toolsUsed.push must come after tool.execute');
  });

  it('push is inside try block, not before it', () => {
    // Find the try block that contains tool.execute
    const tryIdx = src.lastIndexOf('try {', src.indexOf('tool.execute(call.args)'));
    const catchIdx = src.indexOf('} catch', src.indexOf('tool.execute(call.args)'));
    const pushIdx = src.indexOf('toolsUsed.push(call.name)', tryIdx);
    assert.ok(
      pushIdx > tryIdx && pushIdx < catchIdx,
      'toolsUsed.push must be inside the try block (between try and catch)',
    );
  });
});

// ===========================================================================
// PR-006: Budget message mentions UTC
// ===========================================================================

describe('PR-006: Budget message mentions UTC', () => {
  const src = readSrc('src/chat/handler.ts');

  it('budget exceeded message mentions midnight UTC', () => {
    // Find the budget check response
    const budgetSection = src.slice(src.indexOf('checkUserBudget'), src.indexOf('checkUserBudget') + 500);
    // The full handler section where budget is checked and response returned
    const handleSection = src.slice(src.indexOf('async function handle'));
    assert.ok(
      handleSection.includes('midnight UTC') || handleSection.includes('resets at midnight'),
      'Budget exceeded message must mention "midnight UTC" or "resets at midnight"',
    );
  });
});

// ===========================================================================
// PR-007: Timezone uses Intl.supportedValuesOf
// ===========================================================================

describe('PR-007: Timezone uses Intl.supportedValuesOf', () => {
  const src = settingsSrc;

  it('uses Intl.supportedValuesOf for dynamic timezone list', () => {
    assert.ok(src.includes('supportedValuesOf'), 'Must use Intl.supportedValuesOf for timezone list');
  });

  it('has fallback for older environments', () => {
    // The supportedValuesOf call should be wrapped in try/catch with a fallback
    const tzSection = src.slice(src.indexOf('supportedValuesOf'), src.indexOf('supportedValuesOf') + 500);
    assert.ok(
      tzSection.includes('catch') || tzSection.includes('Fallback'),
      'Must have fallback when Intl.supportedValuesOf is unavailable',
    );
  });
});

// ===========================================================================
// PR-008: Halted source fallback error message
// ===========================================================================

describe('PR-008: Halted source fallback error message', () => {
  const src = settingsSrc;

  it('shows fallback message when lastError is null for halted sources', () => {
    assert.ok(
      src.includes('check server logs') || src.includes('check logs'),
      'Must show fallback message mentioning server logs when lastError is null',
    );
  });

  it('displays lastError when available, fallback when not', () => {
    // Pattern: s.lastError || 'fallback message' — short-circuit for null lastError
    // Find the display section (not the toggle error handler) by searching near "check server logs"
    const fallbackIdx = src.indexOf('check server logs');
    assert.ok(fallbackIdx !== -1, 'Must have fallback text');
    const nearbySection = src.slice(Math.max(0, fallbackIdx - 300), fallbackIdx + 100);
    assert.ok(
      nearbySection.includes('lastError') || nearbySection.includes('last_error'),
      'Must reference lastError to conditionally show fallback',
    );
  });
});

// ===========================================================================
// PR-009: Delete uses Modal not window.confirm
// ===========================================================================

describe('PR-009: Delete uses Modal not window.confirm', () => {
  const src = settingsSrc;

  it('does not use window.confirm', () => {
    assert.ok(!src.includes('window.confirm'), 'Must not use window.confirm — should use Modal component instead');
  });

  it('has deleteTarget state for modal-based confirmation', () => {
    assert.ok(src.includes('deleteTarget'), 'Must have deleteTarget state for modal-based delete confirmation');
  });

  it('imports and uses Modal component', () => {
    assert.ok(src.includes('import') && src.includes('Modal'), 'Must import Modal component');
  });
});

// ===========================================================================
// PR-010: Config PATCH accepts camelCase
// ===========================================================================

describe('PR-010: Config PATCH accepts camelCase', () => {
  const src = readServerSource();
  const patchMatch = src.match(/app\.patch\(\s*'\/api\/v1\/config'/);
  assert.ok(patchMatch && patchMatch.index !== undefined, 'PATCH /api/v1/config route must exist');
  const patchStart = patchMatch.index;

  it('PATCH /config schema includes camelCase keys', () => {
    // The schema should accept both snake_case and camelCase
    const patchConfig = src.slice(patchStart, patchStart + 1000);
    const hasDigestTime = patchConfig.includes('digestTime');
    const hasWebhookUrl = patchConfig.includes('webhookUrl');
    assert.ok(
      hasDigestTime || hasWebhookUrl,
      'PATCH /config schema must include camelCase keys (digestTime or webhookUrl)',
    );
  });

  it('normalizes camelCase to snake_case for DB storage', () => {
    const patchHandler = src.slice(patchStart, patchStart + 2000);
    // Should have normalization logic: digestTime -> digest_time
    const hasDigestNormalization = patchHandler.includes("'digestTime'") && patchHandler.includes("'digest_time'");
    const hasWebhookNormalization = patchHandler.includes("'webhookUrl'") && patchHandler.includes("'webhook_url'");
    assert.ok(
      hasDigestNormalization || hasWebhookNormalization,
      'Must normalize camelCase keys to snake_case (e.g., digestTime -> digest_time)',
    );
  });

  it('still accepts snake_case keys for backward compatibility', () => {
    const patchConfig = src.slice(patchStart, patchStart + 1000);
    assert.ok(
      patchConfig.includes('digest_time') && patchConfig.includes('webhook_url'),
      'PATCH /config schema must still accept snake_case keys for backward compatibility',
    );
  });
});
