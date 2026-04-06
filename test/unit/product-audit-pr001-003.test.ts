/**
 * Structural regression tests for product audit fixes PR-001 through PR-003.
 *
 * PR-001: OAuth callback handles Discord error parameter
 * PR-002: Poll interval in Add Source form and sources table
 * PR-003: Feed empty state for no Discord sources
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
// PR-001: OAuth callback handles Discord error parameter
// ===========================================================================

describe('PR-001: OAuth callback handles Discord error', () => {
  const src = readSrc('src/auth/discord-oauth.ts');

  it('Querystring type includes error parameter', () => {
    // The callback route generic defines Querystring with error
    const callbackSection = src.slice(src.indexOf('/auth/discord/callback'));
    assert.ok(
      callbackSection.includes('error?:') || callbackSection.includes('error :'),
      'Callback Querystring must include error parameter',
    );
  });

  it('checks error before checking code', () => {
    const callbackStart = src.indexOf('/auth/discord/callback');
    const callbackBody = src.slice(callbackStart, callbackStart + 2000);
    const errorCheck = callbackBody.indexOf('if (error)');
    const codeCheck = callbackBody.indexOf('if (!code)');
    assert.ok(errorCheck !== -1, 'Must check for error parameter');
    assert.ok(codeCheck !== -1, 'Must check for missing code parameter');
    assert.ok(errorCheck < codeCheck, 'Error check must come before code check');
  });

  it('redirects to login on error instead of raw JSON', () => {
    const callbackStart = src.indexOf('/auth/discord/callback');
    const callbackBody = src.slice(callbackStart, callbackStart + 2000);
    const errorSection = callbackBody.slice(callbackBody.indexOf('if (error)'), callbackBody.indexOf('if (!code)'));
    assert.ok(errorSection.includes('/login?error='), 'Error case must redirect to /login with error param');
  });
});

// ===========================================================================
// PR-002: Poll interval surfaced in dashboard
// ===========================================================================

describe('PR-002: Poll interval surfaced in dashboard', () => {
  const src = readSrc('dashboard/src/pages/Settings.tsx');

  it('Add Source form has poll interval control', () => {
    assert.ok(
      src.includes('addPollInterval') || src.includes('pollInterval'),
      'Must have poll interval state in Add Source form',
    );
  });

  it('POST body includes poll_interval', () => {
    const handleAdd = src.slice(src.indexOf('handleAddSource'));
    const postBody = handleAdd.slice(0, handleAdd.indexOf('catch'));
    assert.ok(
      postBody.includes('poll_interval') || postBody.includes('pollInterval'),
      'POST /sources body must include poll_interval',
    );
  });

  it('sources table shows poll interval', () => {
    const mapSection = src.slice(src.indexOf('sources.map'));
    assert.ok(
      mapSection.includes('pollInterval') &&
        (mapSection.includes('/3600') || mapSection.includes('/60') || mapSection.includes('poll')),
      'Sources table must display poll interval',
    );
  });
});

// ===========================================================================
// PR-003: Feed empty state for no Discord sources
// ===========================================================================

describe('PR-003: Feed empty state for no Discord sources', () => {
  const src = readSrc('dashboard/src/pages/Feed.tsx');
  const noSourcesSrc = readSrc('dashboard/src/components/RawFeedNoSources.tsx');

  it('checks for empty sources after loading', () => {
    assert.ok(
      src.includes('sources.length === 0') || src.includes('sources.length < 1'),
      'Must check for empty sources',
    );
  });

  it('shows guidance when no Discord sources exist', () => {
    assert.ok(src.includes('RawFeedNoSources'), 'Feed must render the extracted no-sources guidance component');
    assert.ok(
      noSourcesSrc.includes('No Discord sources') ||
        noSourcesSrc.includes('no Discord sources') ||
        noSourcesSrc.includes('Add a Discord source'),
      'Must show guidance message for empty Discord sources',
    );
  });
});
