/**
 * Structural regression tests for cycle 118 config/dashboard fixes.
 *
 * CF-002: alertWebhookUrl validated with new URL() in config.ts
 * CF-002: Fire-and-forget pattern removed from health.ts webhook calls
 * AC-002: /auth/me returns avatar field
 * AC-003: lastFetchedAt typed as number | null in Settings.tsx
 * TW-003: Twitter rate limit persisted to DB via source_state.next_retry_at
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
// CF-002: alertWebhookUrl validated with new URL() in config.ts
// ===========================================================================

describe('CF-002: alertWebhookUrl URL validation in config.ts', () => {
  const src = readSrc('src/config.ts');

  it('parses alertWebhookUrl with new URL() like PUBLIC_URL', () => {
    // Must contain a `new URL(rawAlertWebhookUrl)` or similar pattern
    assert.match(
      src,
      /new URL\(rawAlertWebhookUrl\)/,
      'config.ts must validate alertWebhookUrl by constructing new URL(rawAlertWebhookUrl)',
    );
  });

  it('normalizes alertWebhookUrl origin + pathname (same as PUBLIC_URL)', () => {
    // The validated alertWebhookUrl should use parsed.origin + parsed.pathname
    const webhookSection = src.slice(src.indexOf('rawAlertWebhookUrl'));
    assert.match(
      webhookSection,
      /parsed\.origin\s*\+\s*parsed\.pathname/,
      'alertWebhookUrl must be normalized via parsed.origin + parsed.pathname',
    );
  });
});

// ===========================================================================
// CF-002: Fire-and-forget removed from health.ts webhook calls
// ===========================================================================

describe('CF-002: No fire-and-forget .then() on webhook calls in health.ts', () => {
  const src = readSrc('src/health.ts');

  it('sendAlertWebhook is awaited, not chained with .then()', () => {
    // The sendAlertWebhook call should use await, not .then()
    // Check that there is no `.then(` immediately after sendAlertWebhook
    const lines = src.split('\n');
    const thenAfterWebhook = lines.some((line) => /sendAlertWebhook\(.*\)\.then\(/.test(line));
    assert.ok(!thenAfterWebhook, 'sendAlertWebhook must not use .then() fire-and-forget pattern; should be awaited');
  });

  it('sendAlertWebhook invocations use await keyword', () => {
    // Every invocation of sendAlertWebhook (excluding the function definition) must be awaited
    const callMatches = [...src.matchAll(/(await\s+)?sendAlertWebhook\(/g)];
    // Filter out the function definition line
    const invocations = callMatches.filter((m) => {
      const before = src.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
      return !before.includes('function ');
    });
    assert.ok(invocations.length > 0, 'health.ts must invoke sendAlertWebhook at least once');
    for (const m of invocations) {
      assert.ok(m[0].startsWith('await'), `sendAlertWebhook invocation must be awaited: found "${m[0]}" without await`);
    }
  });
});

// ===========================================================================
// AC-002: /auth/me returns avatar in response
// ===========================================================================

describe('AC-002: /auth/me handler returns avatar field', () => {
  const src = readSrc('src/auth/discord-oauth.ts');

  it('response object includes avatar property', () => {
    // Find the /auth/me handler and check its return object includes avatar
    const authMeSection = src.slice(src.indexOf('/api/v1/auth/me'));
    assert.ok(authMeSection.length > 0, 'Must contain /api/v1/auth/me route');
    assert.match(authMeSection, /avatar/, '/auth/me handler must include avatar in the response');
  });

  it('queries avatar from users table', () => {
    const authMeSection = src.slice(src.indexOf('/api/v1/auth/me'));
    assert.match(authMeSection, /SELECT\s+avatar\s+FROM\s+users/i, '/auth/me must query avatar from users table');
  });
});

// ===========================================================================
// AC-003: lastFetchedAt typed as number | null in Settings.tsx
// ===========================================================================

describe('AC-003: lastFetchedAt typed as number | null in Settings.tsx', () => {
  const src = [
    readSrc('dashboard/src/pages/Settings/index.tsx'),
    readSrc('dashboard/src/pages/Settings/types.ts'),
    readSrc('dashboard/src/pages/Settings/api.ts'),
    readSrc('dashboard/src/pages/Settings/formatters.ts'),
  ].join('\n');

  it('Source interface declares lastFetchedAt as number | null', () => {
    assert.match(
      src,
      /lastFetchedAt:\s*number\s*\|\s*null/,
      'lastFetchedAt must be typed as number | null, not string | null',
    );
  });

  it('lastFetchedAt is NOT typed as string', () => {
    const hasStringType = /lastFetchedAt:\s*string/.test(src);
    assert.ok(!hasStringType, 'lastFetchedAt must not be typed as string (should be number | null)');
  });
});

// ===========================================================================
// TW-003: Twitter rate limit persisted to DB via source_state.next_retry_at
// ===========================================================================

describe('TW-003: Twitter rate limit persisted to source_state', () => {
  const src = readSrc('src/ingest/twitter.ts');

  it('writes next_retry_at to source_state on rate limit', () => {
    assert.match(
      src,
      /UPDATE\s+source_state\s+SET\s+next_retry_at/i,
      'Must persist rate limit deadline to source_state.next_retry_at',
    );
  });

  it('reads next_retry_at from source_state before polling', () => {
    assert.match(
      src,
      /SELECT\s+next_retry_at\s+FROM\s+source_state/i,
      'Must read next_retry_at from source_state to check backoff',
    );
  });
});
