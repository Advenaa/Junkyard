/**
 * Structural regression tests for cycle 87-88 RSS, scheduler, and source toggle fixes.
 *
 * RS-010: RSS feed body capped at 5 MB (Content-Length + body length checks)
 * RS-011: Items per poll capped at 50
 * RS-012: RSS feed URLs validated at source creation
 * TM-002: Pulse/health crons use configured timezone
 * CR-001: PATCH /sources returns 409 for halted sources
 * CR-002: Dashboard toggle uses stateStatus, not bare s.enabled
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

// ===========================================================================
// RS-010: Feed body capped at 5 MB
// ===========================================================================

describe('RS-010: RSS feed body capped at 5 MB', () => {
  const src = readSrc('src/ingest/rss.ts');

  it('defines MAX_FEED_BYTES constant', () => {
    assert.match(
      src,
      /const\s+MAX_FEED_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/,
      'MAX_FEED_BYTES must be defined as 5 * 1024 * 1024',
    );
  });

  it('checks Content-Length header before streaming body', () => {
    const pollFnStart = src.indexOf('async function pollFeed');
    assert.ok(pollFnStart !== -1, 'pollFeed must exist');
    const pollFnBody = src.slice(pollFnStart);

    const contentLengthCheck = pollFnBody.indexOf('contentLength > MAX_FEED_BYTES');
    const streamCall = pollFnBody.indexOf('readBodyLimited(feedResponse');
    assert.ok(contentLengthCheck !== -1, 'Must check contentLength against MAX_FEED_BYTES');
    assert.ok(streamCall !== -1, 'Must call readBodyLimited for streaming body read');
    assert.ok(contentLengthCheck < streamCall, 'Content-Length check must happen before streaming body read');
  });

  it('uses streaming reader to enforce size limit mid-stream', () => {
    assert.ok(src.includes('readBodyLimited'), 'Must use readBodyLimited helper for streaming size enforcement');
    const helperStart = src.indexOf('async function readBodyLimited');
    assert.ok(helperStart !== -1, 'readBodyLimited helper must be defined');
    const helperBody = src.slice(helperStart, helperStart + 600);
    assert.ok(helperBody.includes('reader.cancel()'), 'Must cancel reader when limit is exceeded');
    assert.ok(helperBody.includes('total > maxBytes'), 'Must check accumulated bytes against limit');
  });

  it('returns early with empty items when feed is too large', () => {
    // Both checks should return { items: [], lastId, fetchFailed: false }
    const matches = src.match(/return\s*\{\s*items\s*:\s*\[\]\s*,\s*lastId\s*,\s*fetchFailed\s*:\s*false\s*\}/g);
    assert.ok(matches && matches.length >= 2, 'Must have at least 2 early returns with empty items for size checks');
  });
});

// ===========================================================================
// RS-011: Items per poll capped at 50
// ===========================================================================

describe('RS-011: Items per poll capped at 50', () => {
  const src = readSrc('src/ingest/rss.ts');

  it('defines MAX_ITEMS_PER_POLL constant as 50', () => {
    assert.match(src, /const\s+MAX_ITEMS_PER_POLL\s*=\s*50/, 'MAX_ITEMS_PER_POLL must be defined as 50');
  });

  it('compares filtered length against MAX_ITEMS_PER_POLL', () => {
    assert.match(src, /filtered\.length\s*>\s*MAX_ITEMS_PER_POLL/, 'Must check filtered.length > MAX_ITEMS_PER_POLL');
  });

  it('slices to keep newest items using .slice(-MAX_ITEMS_PER_POLL)', () => {
    assert.match(
      src,
      /filtered\s*=\s*filtered\.slice\(\s*-MAX_ITEMS_PER_POLL\s*\)/,
      'Must reassign filtered to filtered.slice(-MAX_ITEMS_PER_POLL) to keep newest',
    );
  });
});

// ===========================================================================
// RS-012: RSS feed URLs validated at source creation
// ===========================================================================

describe('RS-012: RSS feed URLs validated at POST /sources', () => {
  const src = readServerSource();

  it('imports validateUrl from url-validator', () => {
    assert.match(
      src,
      /import\s*\{[^}]*validateUrl[^}]*\}\s*from\s*['"]\.\/url-validator/,
      'server.ts must import validateUrl from url-validator',
    );
  });

  it('POST /sources handler checks source === rss', () => {
    const postMatch = src.match(/app\.post\(\s*\n?\s*'\/api\/v1\/sources'/);
    assert.ok(postMatch && postMatch.index !== undefined, 'POST /api/v1/sources route must exist');
    const postSourcesStart = postMatch.index;

    const handlerBody = src.slice(postSourcesStart, postSourcesStart + 1500);
    assert.ok(handlerBody.includes("source === 'rss'"), 'POST /sources handler must check if source is rss');
  });

  it('calls validateUrl on RSS sourceId', () => {
    const postMatch = src.match(/app\.post\(\s*\n?\s*'\/api\/v1\/sources'/);
    const postSourcesStart = postMatch!.index!;
    const handlerBody = src.slice(postSourcesStart, postSourcesStart + 1500);

    assert.ok(
      handlerBody.includes('validateUrl(sourceId)'),
      'POST /sources handler must call validateUrl(sourceId) for RSS sources',
    );
  });

  it('returns 400 for invalid RSS feed URLs', () => {
    const postMatch = src.match(/app\.post\(\s*\n?\s*'\/api\/v1\/sources'/);
    const postSourcesStart = postMatch!.index!;
    const handlerBody = src.slice(postSourcesStart, postSourcesStart + 1500);

    assert.ok(
      handlerBody.includes('400') && handlerBody.includes('Invalid RSS feed URL'),
      'Must return 400 with descriptive error for invalid RSS URLs',
    );
  });
});

// ===========================================================================
// TM-002: Pulse/health crons use configured timezone
// ===========================================================================

describe('TM-002: Pulse/health crons use configured timezone', () => {
  const src = readSrc('src/scheduler.ts');

  it('market-pulse register call includes timezone in options', () => {
    const pulseRegister = src.indexOf("register('market-pulse'");
    assert.ok(pulseRegister !== -1, "register('market-pulse', ...) must exist");

    const callEnd = src.indexOf(');', pulseRegister);
    const callStr = src.slice(pulseRegister, callEnd + 2);

    assert.ok(callStr.includes('timezone'), 'market-pulse register call must include timezone in options');
  });

  it('health-monitor register call includes timezone in options', () => {
    const healthRegister = src.indexOf("register('health-monitor'");
    assert.ok(healthRegister !== -1, "register('health-monitor', ...) must exist");

    const callEnd = src.indexOf(');', healthRegister);
    const callStr = src.slice(healthRegister, callEnd + 2);

    assert.ok(callStr.includes('timezone'), 'health-monitor register call must include timezone in options');
  });

  it('timezone is fetched from app_config before registering cron jobs', () => {
    assert.match(
      src,
      /getAppConfig\s*\(\s*pool\s*,\s*['"]timezone['"]\s*\)/,
      "Must fetch timezone from app_config via getAppConfig(pool, 'timezone')",
    );
  });

  it('timezone defaults to Asia/Jakarta', () => {
    assert.match(src, /timezone[^;]*\?\?\s*['"]Asia\/Jakarta['"]/, 'timezone must default to Asia/Jakarta');
  });
});

// ===========================================================================
// CR-001: PATCH /sources returns 409 for halted sources
// ===========================================================================

describe('CR-001: PATCH /sources returns 409 for halted sources', () => {
  const src = readServerSource();
  const patchSourcesRe = /app\.patch\(\s*\n?\s*'\/api\/v1\/sources\/:source\/:sourceId'/;

  function getPatchSourcesStart(): number {
    const m = src.match(patchSourcesRe);
    assert.ok(m && m.index !== undefined, 'PATCH /api/v1/sources/:source/:sourceId route must exist');
    return m.index;
  }

  it('PATCH /sources handler exists', () => {
    assert.ok(patchSourcesRe.test(src), 'PATCH /api/v1/sources/:source/:sourceId route must exist');
  });

  it('checks for halted status', () => {
    const patchStart = getPatchSourcesStart();

    const handlerBody = src.slice(patchStart, patchStart + 3000);
    assert.ok(handlerBody.includes("=== 'halted'"), 'PATCH handler must check if current status is halted');
  });

  it('returns 409 when source is halted and trying to enable', () => {
    const patchStart = getPatchSourcesStart();
    const handlerBody = src.slice(patchStart, patchStart + 3000);

    assert.ok(handlerBody.includes('409'), 'PATCH handler must send 409 status code for halted sources');
  });

  it('includes last_error in 409 response', () => {
    const patchStart = getPatchSourcesStart();
    const handlerBody = src.slice(patchStart, patchStart + 3000);

    assert.ok(
      handlerBody.includes('lastError') && handlerBody.includes('last_error'),
      'PATCH handler 409 response must include lastError from source state',
    );
  });

  it('queries source_state table for current status', () => {
    const patchStart = getPatchSourcesStart();
    const handlerBody = src.slice(patchStart, patchStart + 3000);

    assert.ok(
      handlerBody.includes('source_state') && handlerBody.includes('status'),
      'PATCH handler must query source_state for current status',
    );
  });
});

// ===========================================================================
// CR-002: Dashboard toggle uses stateStatus
// ===========================================================================

describe('CR-002: Dashboard toggle uses stateStatus, not bare s.enabled', () => {
  const src = [
    readSrc('dashboard/src/pages/Settings/index.tsx'),
    readSrc('dashboard/src/pages/Settings/types.ts'),
    readSrc('dashboard/src/pages/Settings/api.ts'),
    readSrc('dashboard/src/pages/Settings/formatters.ts'),
  ].join('\n');

  it('Source interface includes stateStatus field', () => {
    assert.match(src, /stateStatus\s*:\s*string/, 'Source interface must include stateStatus field');
  });

  it('toggleSource uses stateStatus to determine active state', () => {
    const fnStart = src.indexOf('toggleSource');
    assert.ok(fnStart !== -1, 'toggleSource function must exist');

    const fnBody = src.slice(fnStart, fnStart + 500);
    assert.ok(
      fnBody.includes("stateStatus === 'active'") || fnBody.includes('stateStatus === "active"'),
      'toggleSource must check stateStatus === active, not s.enabled',
    );
  });

  it('toggle button visual state is driven by stateStatus', () => {
    // The button area uses a computed `isActive` variable derived from stateStatus
    const mapArea = src.slice(src.indexOf('sources.map'));
    assert.ok(
      mapArea.includes("stateStatus == null || s.stateStatus === 'active'") ||
        mapArea.includes("s.stateStatus === 'active'"),
      'Toggle button visual state must derive from stateStatus, not s.enabled',
    );
  });

  it('optimistic state update sets stateStatus, not enabled', () => {
    const toggleFnStart = src.indexOf('const toggleSource');
    assert.ok(toggleFnStart !== -1, 'toggleSource function must exist');

    const toggleBody = src.slice(toggleFnStart, toggleFnStart + 600);
    assert.ok(toggleBody.includes('stateStatus:'), 'Optimistic update must set stateStatus field');
  });
});
