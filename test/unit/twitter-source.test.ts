/**
 * Structural regression tests for Twitter/X source management.
 *
 * Reads src/server.ts and src/config.ts as strings and verifies:
 * - Twitter sourceId validation exists for @handle format
 * - A helpful error message is returned for invalid handles
 * - `twitterApiKeyConfigured` appears in the status endpoint response
 * - The status response includes the twitter key check via config
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

// ═══════════════════════════════════════════════════════════════════════
// server.ts — Twitter sourceId validation
// ═══════════════════════════════════════════════════════════════════════

describe('Twitter sourceId validation (src/server.ts)', () => {
  const src = readServerSource();

  it('validates twitter sourceId that starts with @', () => {
    // The validation should check for 'twitter' source and @ prefix
    assert.ok(
      /source\s*===?\s*['"]twitter['"]/.test(src) && src.includes('startsWith'),
      'server.ts must validate twitter sourceId that starts with @',
    );
  });

  it('checks @handle against a regex pattern for valid characters', () => {
    // The validation regex should allow only letters, numbers, underscores after @
    assert.ok(
      /\^@\[A-Za-z0-9_\]/.test(src) || /\^@\[a-zA-Z0-9_\]/.test(src) || /\^@\\w/.test(src),
      'server.ts must validate @handle with a character class regex (letters, numbers, underscores)',
    );
  });

  it('returns 400 for invalid twitter handles', () => {
    // Find the twitter validation block and verify it sends a 400
    const twitterIdx = src.indexOf("source === 'twitter'");
    assert.ok(twitterIdx !== -1, "server.ts must have a twitter source check with source === 'twitter'");

    const validationSlice = src.slice(twitterIdx, twitterIdx + 500);
    assert.ok(
      validationSlice.includes('400') || validationSlice.includes('code(400)'),
      'Twitter handle validation must return a 400 status code',
    );
  });

  it('returns a helpful error message mentioning @username format', () => {
    const twitterIdx = src.indexOf("source === 'twitter'");
    assert.ok(twitterIdx !== -1, 'server.ts must have a twitter source check');

    const validationSlice = src.slice(twitterIdx, twitterIdx + 500);
    assert.ok(
      validationSlice.includes('@username') || validationSlice.includes('@handle'),
      'Twitter validation error must mention @username or @handle format',
    );
  });

  it('error message suggests omitting @ for search queries', () => {
    const twitterIdx = src.indexOf("source === 'twitter'");
    assert.ok(twitterIdx !== -1, 'server.ts must have a twitter source check');

    const validationSlice = src.slice(twitterIdx, twitterIdx + 500);
    assert.ok(
      validationSlice.includes('search') && validationSlice.includes('omit'),
      'Twitter validation error must suggest omitting @ for search queries',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// server.ts — status endpoint includes twitterApiKeyConfigured
// ═══════════════════════════════════════════════════════════════════════

describe('Status endpoint twitterApiKeyConfigured (src/server.ts)', () => {
  const src = readServerSource();

  it('status endpoint response includes twitterApiKeyConfigured field', () => {
    // Find the /api/v1/status route — handler can be >800 chars with the SQL query
    const statusIdx = src.indexOf("'/api/v1/status'");
    assert.ok(statusIdx !== -1, 'server.ts must define a /api/v1/status route');

    const handlerSlice = src.slice(statusIdx, statusIdx + 1500);
    assert.ok(
      handlerSlice.includes('twitterApiKeyConfigured'),
      '/api/v1/status response must include twitterApiKeyConfigured',
    );
  });

  it('twitterApiKeyConfigured is derived from config.twitterApiKey', () => {
    const statusIdx = src.indexOf("'/api/v1/status'");
    assert.ok(statusIdx !== -1, 'server.ts must define a /api/v1/status route');

    const handlerSlice = src.slice(statusIdx, statusIdx + 1500);
    assert.ok(
      handlerSlice.includes('config.twitterApiKey') || handlerSlice.includes('twitterApiKey'),
      'twitterApiKeyConfigured must reference the twitterApiKey from config',
    );
  });

  it('twitterApiKeyConfigured is a boolean (uses !! or Boolean)', () => {
    const statusIdx = src.indexOf("'/api/v1/status'");
    assert.ok(statusIdx !== -1, 'server.ts must define a /api/v1/status route');

    const handlerSlice = src.slice(statusIdx, statusIdx + 1500);
    assert.ok(
      handlerSlice.includes('!!config.twitterApiKey') ||
        handlerSlice.includes('Boolean(config.twitterApiKey)') ||
        handlerSlice.includes('!!twitterApiKey'),
      'twitterApiKeyConfigured must be cast to boolean via !! or Boolean()',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// config.ts — twitterApiKey config
// ═══════════════════════════════════════════════════════════════════════

describe('Twitter API key in config (src/config.ts)', () => {
  const src = readSrc('src/config.ts');

  it('config declares twitterApiKey field', () => {
    assert.ok(src.includes('twitterApiKey'), 'config.ts must declare a twitterApiKey field');
  });

  it('twitterApiKey is loaded from TWITTERAPI_KEY env var', () => {
    assert.ok(
      src.includes('TWITTERAPI_KEY') || src.includes('TWITTERAPI_KEY'),
      'config.ts must load twitterApiKey from TWITTERAPI_KEY environment variable',
    );
  });

  it('twitterApiKey can be null (optional)', () => {
    assert.ok(
      src.includes('twitterApiKey: string | null') || src.includes('twitterApiKey?: string'),
      'twitterApiKey must be nullable or optional (Twitter API key is not required)',
    );
  });
});
