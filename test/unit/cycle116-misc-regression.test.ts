/**
 * Structural regression tests for cycle 116 misc fixes.
 *
 * DL-025: Response body consumed on non-2xx to prevent socket leaks.
 * DL-028: Rate-limit retry has a minimum floor (MIN_RETRY_AFTER_MS).
 * AU-035: deleteAllForUser method exists with DELETE FROM sessions.
 * NP-040: validateIntermediateHop exists and does not require HTTPS.
 * LM-032: Translated query gets nonce wrapping via wrapWithNonce.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ===========================================================================
// DL-025: Response body consumed on non-2xx paths
// ===========================================================================

describe('DL-025: webhook.ts drains response body on non-2xx', () => {
  const src = readSrc('src/deliver/webhook.ts');

  it('calls response.body?.cancel() to drain the body', () => {
    assert.ok(
      src.includes('response.body?.cancel()') || src.includes('await response.text()'),
      'webhook.ts must consume the response body on non-2xx to prevent socket leaks (response.body?.cancel() or await response.text())',
    );
  });
});

// ===========================================================================
// DL-028: Rate-limit retry has minimum floor
// ===========================================================================

describe('DL-028: webhook.ts enforces a minimum retry-after floor', () => {
  const src = readSrc('src/deliver/webhook.ts');

  it('defines MIN_RETRY_AFTER_MS constant', () => {
    assert.ok(
      /MIN_RETRY_AFTER_MS\s*=\s*\d+/.test(src),
      'webhook.ts must define MIN_RETRY_AFTER_MS with a numeric value',
    );
  });

  it('uses Math.max to enforce the floor on retryAfter', () => {
    assert.ok(
      src.includes('Math.max') && src.includes('MIN_RETRY_AFTER_MS'),
      'webhook.ts must use Math.max with MIN_RETRY_AFTER_MS to clamp the retry-after value',
    );
  });
});

// ===========================================================================
// AU-035: deleteAllForUser method exists
// ===========================================================================

describe('AU-035: sessions.ts has deleteAllForUser method', () => {
  const src = readSrc('src/auth/sessions.ts');

  it('defines deleteAllForUser function/method', () => {
    assert.ok(/deleteAllForUser\s*\(/.test(src), 'sessions.ts must define a deleteAllForUser method');
  });

  it('deleteAllForUser contains DELETE FROM sessions', () => {
    assert.ok(
      src.includes('DELETE FROM sessions WHERE discord_id'),
      'deleteAllForUser must issue DELETE FROM sessions WHERE discord_id',
    );
  });
});

// ===========================================================================
// NP-040: validateIntermediateHop exists and allows HTTP
// ===========================================================================

describe('NP-040: url-expand.ts has validateIntermediateHop without HTTPS requirement', () => {
  const src = readSrc('src/normalize/url-expand.ts');

  it('defines validateIntermediateHop function', () => {
    assert.ok(
      /function\s+validateIntermediateHop\s*\(/.test(src),
      'url-expand.ts must define a validateIntermediateHop function',
    );
  });

  it('does not enforce HTTPS-only in validateIntermediateHop', () => {
    // Extract the function body (from declaration to the next top-level function or export)
    const fnMatch = src.match(/function\s+validateIntermediateHop[\s\S]*?^}/m);
    assert.ok(fnMatch, 'could not extract validateIntermediateHop body');
    const fnBody = fnMatch[0];
    // Must not reject based on protocol being http
    assert.ok(
      !fnBody.includes("protocol !== 'https:'") && !fnBody.includes('protocol !== "https:"'),
      'validateIntermediateHop must NOT require HTTPS — intermediate hops may use HTTP',
    );
  });
});

// ===========================================================================
// LM-032: Translated query gets nonce wrapping
// ===========================================================================

describe('LM-032: handler.ts wraps translated query with nonce', () => {
  const src = readSrc('src/chat/handler.ts');

  it('calls llm.wrapWithNonce after the translation block', () => {
    const translateIdx = src.indexOf("detectedLang === 'ind'");
    const nonceIdx = src.indexOf('llm.wrapWithNonce(translated)');
    assert.ok(translateIdx > -1, 'handler.ts must contain Indonesian detection block');
    assert.ok(nonceIdx > -1, 'handler.ts must call llm.wrapWithNonce(translated) for translated queries');
    assert.ok(
      nonceIdx > translateIdx,
      'llm.wrapWithNonce(translated) must appear after the Indonesian translation block',
    );
  });
});
