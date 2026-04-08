/**
 * Structural regression tests for cycle 110: CG-001, CG-002
 *
 * CG-001: API key omitted from stderr — the auto-generated key is no longer
 *         printed at all in bootstrap warnings.
 *
 * CG-002: PUBLIC_URL validated — new URL() is used to parse and validate
 *         the env var, trailing slashes are stripped, and invalid URLs
 *         cause an error to be thrown.
 *
 * CG-003: ALERT_WEBHOOK_URL warning is generic — invalid secret values are
 *         not echoed to stdout before the logger masking layer exists.
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
// CG-001: API key omitted from stderr
// ===========================================================================

describe('CG-001: API key omitted from stderr', () => {
  const src = readSrc('src/config.ts');

  it('does NOT print the full apiKey via padEnd(48)', () => {
    assert.ok(
      !src.includes('apiKey.padEnd(48)'),
      'console.error must not contain apiKey.padEnd(48) — key should be masked',
    );
  });

  it('does NOT print even a truncated apiKey prefix via .slice()', () => {
    assert.ok(
      !src.includes('apiKey.slice('),
      'console.error must not contain apiKey.slice() — generated keys should not be printed at all',
    );
  });

  it('still explains that the key was generated without echoing it', () => {
    assert.match(src, /Generated in memory only/, 'The warning box must still explain the generated-key state');
  });
});

// ===========================================================================
// CG-002: PUBLIC_URL validated
// ===========================================================================

describe('CG-002: PUBLIC_URL validated', () => {
  const src = readSrc('src/config.ts');

  it('uses new URL() to parse the publicUrl value', () => {
    assert.match(src, /new URL\(/, 'PUBLIC_URL handling must use new URL() for validation');
  });

  it('strips trailing slashes from the URL', () => {
    assert.match(src, /\.replace\(\/\\\/\+\$\//, 'PUBLIC_URL must strip trailing slashes via .replace(/\\/+$/, ...)');
  });

  it('has a try/catch around URL parsing with an error throw', () => {
    // Verify try block exists
    assert.match(src, /try\s*\{[^}]*new URL\(/s, 'PUBLIC_URL parsing must be inside a try block');
    // Verify catch block with throw
    assert.match(
      src,
      /catch[^{]*\{[^}]*throw new Error\([^)]*PUBLIC_URL/s,
      'Catch block must throw an Error mentioning PUBLIC_URL for invalid URLs',
    );
  });

  it('does not assign the raw env var directly to publicUrl', () => {
    // publicUrl should never be assigned rawPublicUrl directly (without URL parsing)
    assert.ok(
      !src.includes('publicUrl = rawPublicUrl'),
      'publicUrl must not be assigned the raw env var directly — must go through new URL() parsing',
    );
  });
});

// ===========================================================================
// CG-003: ALERT_WEBHOOK_URL warning is generic
// ===========================================================================

describe('CG-003: ALERT_WEBHOOK_URL warning is generic', () => {
  const src = readSrc('src/config.ts');

  it('does not interpolate rawAlertWebhookUrl into the warning string', () => {
    assert.ok(
      !src.includes('${rawAlertWebhookUrl}'),
      'invalid ALERT_WEBHOOK_URL warnings must not echo the raw secret value',
    );
  });

  it('still emits a generic invalid ALERT_WEBHOOK_URL warning', () => {
    assert.match(
      src,
      /ALERT_WEBHOOK_URL is not a valid URL — alerts disabled/,
      'config.ts should still warn when ALERT_WEBHOOK_URL is invalid',
    );
  });
});
