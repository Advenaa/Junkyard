/**
 * Regression tests for cycle 104 webhook delivery fixes.
 *
 * DL-015: embedCharCount includes URL field length
 * DL-016: 2-minute total retry circuit breaker (MAX_TOTAL_RETRY_MS)
 * DL-020: DB failure after POST doesn't cause duplicate delivery
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { embedCharCount } from '../../src/deliver/webhook.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ===========================================================================
// DL-015: embedCharCount includes URL field
// ===========================================================================

describe('DL-015: embedCharCount includes embed.url length', () => {
  it('counts URL length when url is present', () => {
    const embed = {
      title: 'Test',
      description: 'Desc',
      color: 0x5b8def,
      fields: [],
      timestamp: new Date().toISOString(),
      footer: { text: 'podders' },
      url: 'https://example.com/reports/abc123',
    };

    const count = embedCharCount(embed);
    const expectedWithoutUrl = embed.title.length + embed.description.length + embed.footer.text.length;
    const expectedWithUrl = expectedWithoutUrl + embed.url.length;

    assert.equal(count, expectedWithUrl, 'embedCharCount must include url length in total');
  });

  it('handles missing url gracefully (undefined)', () => {
    const embed = {
      title: 'Test',
      description: 'Desc',
      color: 0x5b8def,
      fields: [],
      timestamp: new Date().toISOString(),
      footer: { text: 'podders' },
    };

    const count = embedCharCount(embed);
    const expected = embed.title.length + embed.description.length + embed.footer.text.length;

    assert.equal(count, expected, 'embedCharCount must work without url field');
  });

  it('includes fields and url together in total', () => {
    const embed = {
      title: 'T',
      description: 'D',
      color: 0x5b8def,
      fields: [{ name: 'FN', value: 'FV', inline: false }],
      timestamp: new Date().toISOString(),
      footer: { text: 'F' },
      url: 'https://example.com',
    };

    const count = embedCharCount(embed);
    const expected =
      embed.title.length +
      embed.description.length +
      embed.footer.text.length +
      embed.url.length +
      embed.fields[0]!.name.length +
      embed.fields[0]!.value.length;

    assert.equal(count, expected, 'embedCharCount must sum title + description + footer + url + fields');
  });
});

// ===========================================================================
// DL-016: 2-minute total retry circuit breaker
// ===========================================================================

describe('DL-016: postWithRetry has MAX_TOTAL_RETRY_MS circuit breaker', () => {
  const src = readSrc('src/deliver/webhook.ts');

  it('defines MAX_TOTAL_RETRY_MS = 120_000', () => {
    assert.match(
      src,
      /MAX_TOTAL_RETRY_MS\s*=\s*120[_]?000/,
      'MAX_TOTAL_RETRY_MS must be defined as 120000 (2 minutes)',
    );
  });

  it('records startTime before the retry loop', () => {
    // startTime must be captured before the for loop
    const startTimeIdx = src.indexOf('startTime');
    const forLoopIdx = src.indexOf('for (let attempt');
    assert.ok(startTimeIdx > 0, 'startTime must exist in source');
    assert.ok(forLoopIdx > 0, 'retry for-loop must exist in source');
    assert.ok(startTimeIdx < forLoopIdx, 'startTime must be set before the retry loop');
  });

  it('checks elapsed time inside the retry loop', () => {
    // The elapsed check must be inside the for-loop body
    const postWithRetryMatch = src.match(
      /async function postWithRetry[\s\S]*?for\s*\(let attempt.*?\{([\s\S]*?)\n\s*}\n\n\s*return lastFailure;/,
    );
    assert.ok(postWithRetryMatch, 'postWithRetry loop and terminal fallback must exist');

    const loopBody = postWithRetryMatch[1]!;
    assert.match(
      loopBody,
      /Date\.now\(\)\s*-\s*startTime\s*>\s*MAX_TOTAL_RETRY_MS/,
      'elapsed time check (Date.now() - startTime > MAX_TOTAL_RETRY_MS) must be inside the retry loop',
    );
  });
});

// ===========================================================================
// DL-020: DB failure after POST doesn't cause duplicate delivery
// ===========================================================================

describe('DL-020: updateDeliveryStatus after successful POST is wrapped in try/catch', () => {
  const src = readSrc('src/deliver/webhook.ts');

  it('wraps updateDeliveryStatus("delivered") in try/catch', () => {
    // After success path: try { await updateDeliveryStatus(..., 'delivered') } catch
    assert.match(
      src,
      /try\s*\{\s*\n\s*await\s+updateDeliveryStatus\(pool,\s*report\.id,\s*'delivered'\)/,
      'updateDeliveryStatus for delivered status must be inside a try block',
    );
  });

  it('catch block logs error but does not re-throw', () => {
    // Find the success delivery section (indentation varies)
    const successBlock = src.match(/if\s*\(postResult\.ok\)\s*\{([\s\S]*?)return true;/);
    assert.ok(successBlock, 'postResult.ok success block must exist after postWithRetry');

    const block = successBlock[1]!;
    // Must have catch
    assert.match(block, /catch\s*\(/, 'success path must have a catch clause');
    // Must log error
    assert.match(block, /log\.error/, 'catch block must log the error');
    // Must NOT re-throw (the block ends with return true, not throw)
    assert.ok(!block.includes('throw'), 'catch block must not re-throw — delivery should still return true');
  });

  it('returns true after the try/catch, not inside the try block', () => {
    // The `return true` must come after the catch block closes
    const successBlock = src.match(/if\s*\(postResult\.ok\)\s*\{([\s\S]*?)return true;/);
    assert.ok(successBlock, 'postResult.ok success block must exist');

    const block = successBlock[1]!;
    // The try/catch must close before return true
    const lastClosingBrace = block.lastIndexOf('}');
    const catchIdx = block.lastIndexOf('catch');
    assert.ok(catchIdx > 0, 'catch must exist in success block');
    assert.ok(lastClosingBrace > catchIdx, 'catch block must close before return true');
  });
});
