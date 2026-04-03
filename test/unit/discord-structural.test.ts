/**
 * Structural regression tests for Discord adapter fixes (DC-002, DC-003, DC-005, DC-006).
 *
 * These tests read the source text of src/ingest/discord.ts and assert code patterns,
 * ensuring fixes stay in place across refactors.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DISCORD_SRC = resolve(__dirname, '../../src/ingest/discord.ts');

let source: string;

before(async () => {
  source = await readFile(DISCORD_SRC, 'utf-8');
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
    if (depth === 0) { fnEnd = i; break; }
  }
  assert.ok(fnEnd > fnStart, `could not find closing brace for "${name}"`);
  return src.slice(fnStart, fnEnd + 1);
}

// ---------------------------------------------------------------------------
// DC-002: disconnect() drains concurrency queue
// ---------------------------------------------------------------------------

describe('DC-002: disconnect() drains concurrency queue', () => {
  it('disconnect method exists', () => {
    assert.ok(
      source.includes('async disconnect()'),
      'TokenConnection must have an async disconnect() method',
    );
  });

  it('disconnect iterates concurrency queue and calls resolve()', () => {
    const body = extractFunctionBody(source, 'async disconnect()');

    // Must iterate the concurrency queue
    assert.ok(
      body.includes('this.concurrency.queue') || body.includes('concurrency.queue'),
      'disconnect must reference the concurrency queue',
    );

    // Must call resolve on each pending waiter
    assert.ok(
      body.includes('resolve()'),
      'disconnect must call resolve() on queued waiters to drain them',
    );
  });

  it('disconnect clears the queue after draining', () => {
    const body = extractFunctionBody(source, 'async disconnect()');

    assert.ok(
      body.includes('.queue.length = 0') || body.includes('.queue = []') || body.includes('.splice(0'),
      'disconnect must clear the queue after draining (length=0 or reassign)',
    );
  });

  it('disconnect sets destroyed flag before draining', () => {
    const body = extractFunctionBody(source, 'async disconnect()');

    const destroyedIdx = body.indexOf('this.destroyed = true');
    const queueIdx = body.indexOf('concurrency.queue');
    assert.ok(destroyedIdx !== -1, 'disconnect must set this.destroyed = true');
    assert.ok(destroyedIdx < queueIdx, 'destroyed flag must be set before queue drain');
  });
});

// ---------------------------------------------------------------------------
// DC-005: NaN timestamp falls back to Date.now() with warning
// ---------------------------------------------------------------------------

describe('DC-005: NaN timestamp falls back to Date.now()', () => {
  it('handleMessageCreate method exists', () => {
    assert.ok(
      source.includes('handleMessageCreate'),
      'handleMessageCreate method must exist',
    );
  });

  it('checks for NaN on parsed timestamp', () => {
    const body = extractFunctionBody(source, 'private async handleMessageCreate');

    assert.ok(
      body.includes('Number.isNaN') || body.includes('isNaN(ts)') || body.includes('isNaN('),
      'handleMessageCreate must check for NaN on the parsed timestamp',
    );
  });

  it('falls back to Date.now() when timestamp is NaN', () => {
    const body = extractFunctionBody(source, 'private async handleMessageCreate');

    // Must have Date.now() fallback
    assert.ok(
      body.includes('Date.now()'),
      'handleMessageCreate must use Date.now() as fallback for invalid timestamps',
    );

    // The NaN check and Date.now() must appear near each other (within the same if block)
    const nanIdx = body.indexOf('isNaN');
    const dateNowIdx = body.indexOf('Date.now()');
    assert.ok(
      Math.abs(dateNowIdx - nanIdx) < 200,
      'Date.now() fallback must be close to the NaN check (same conditional block)',
    );
  });

  it('logs a warning when falling back', () => {
    const body = extractFunctionBody(source, 'private async handleMessageCreate');

    // Find the NaN-handling section
    const nanIdx = body.indexOf('isNaN');
    const nearbySlice = body.slice(nanIdx, nanIdx + 200);

    assert.ok(
      nearbySlice.includes('.warn') || nearbySlice.includes('log.warn'),
      'must log a warning when timestamp is invalid',
    );
  });
});

// ---------------------------------------------------------------------------
// DC-003: Attachment URLs validated against Discord CDN allowlist
// ---------------------------------------------------------------------------

describe('DC-003: Attachment URLs validated against Discord CDN allowlist', () => {
  it('DISCORD_CDN_HOSTS constant exists with expected hosts', () => {
    assert.ok(
      source.includes('DISCORD_CDN_HOSTS'),
      'DISCORD_CDN_HOSTS constant must be defined',
    );
    assert.ok(
      source.includes('cdn.discordapp.com'),
      'allowlist must include cdn.discordapp.com',
    );
    assert.ok(
      source.includes('media.discordapp.net'),
      'allowlist must include media.discordapp.net',
    );
  });

  it('isValidDiscordUrl function exists and checks protocol + hostname', () => {
    const body = extractFunctionBody(source, 'function isValidDiscordUrl');

    assert.ok(
      body.includes("parsed.protocol === 'https:'") || body.includes('parsed.protocol === "https:"'),
      'isValidDiscordUrl must require https protocol',
    );
    assert.ok(
      body.includes('DISCORD_CDN_HOSTS.has(parsed.hostname)') ||
      body.includes('DISCORD_CDN_HOSTS.has(parsed.host)'),
      'isValidDiscordUrl must check hostname against DISCORD_CDN_HOSTS',
    );
  });

  it('isValidDiscordUrl returns false for invalid URLs (try/catch)', () => {
    const body = extractFunctionBody(source, 'function isValidDiscordUrl');

    assert.ok(
      body.includes('catch'),
      'isValidDiscordUrl must catch URL parse errors',
    );
    assert.ok(
      body.includes('return false'),
      'isValidDiscordUrl must return false for unparseable URLs',
    );
  });

  it('handleMessageCreate filters attachments through isValidDiscordUrl', () => {
    const body = extractFunctionBody(source, 'private async handleMessageCreate');

    assert.ok(
      body.includes('isValidDiscordUrl'),
      'handleMessageCreate must filter attachments via isValidDiscordUrl',
    );
    assert.ok(
      body.includes('.filter(') && body.includes('isValidDiscordUrl'),
      'attachments must be filtered (not just checked) through the CDN validator',
    );
  });
});

// ---------------------------------------------------------------------------
// DC-006: Circuit breaker after 20 consecutive errors disables token
// ---------------------------------------------------------------------------

describe('DC-006: Circuit breaker disables token after consecutive errors', () => {
  it('MAX_CONSECUTIVE_ERRORS constant is defined with value 20', () => {
    assert.ok(
      source.includes('MAX_CONSECUTIVE_ERRORS'),
      'MAX_CONSECUTIVE_ERRORS constant must be defined',
    );

    const match = source.match(/MAX_CONSECUTIVE_ERRORS\s*=\s*(\d+)/);
    assert.ok(match, 'MAX_CONSECUTIVE_ERRORS must be assigned a numeric value');
    assert.equal(Number(match![1]), 20, 'MAX_CONSECUTIVE_ERRORS must be 20');
  });

  it('TokenState tracks errorCount field', () => {
    assert.ok(
      source.includes('errorCount: number') || source.includes('errorCount:number'),
      'TokenState interface must include errorCount field',
    );
  });

  it('handleClose increments errorCount', () => {
    const body = extractFunctionBody(source, 'private handleClose');

    assert.ok(
      body.includes('errorCount += 1') || body.includes('errorCount++'),
      'handleClose must increment errorCount',
    );
  });

  it('handleClose checks errorCount against MAX_CONSECUTIVE_ERRORS before reconnecting', () => {
    const body = extractFunctionBody(source, 'private handleClose');

    assert.ok(
      body.includes('errorCount >= MAX_CONSECUTIVE_ERRORS') ||
      body.includes('errorCount > MAX_CONSECUTIVE_ERRORS - 1'),
      'handleClose must compare errorCount against MAX_CONSECUTIVE_ERRORS',
    );
  });

  it('sets status to disabled when circuit breaker trips', () => {
    const body = extractFunctionBody(source, 'private handleClose');

    // The circuit breaker block must set status to disabled
    const cbIdx = body.indexOf('MAX_CONSECUTIVE_ERRORS');
    const nearbySlice = body.slice(cbIdx, cbIdx + 300);

    assert.ok(
      nearbySlice.includes("'disabled'") || nearbySlice.includes('"disabled"'),
      'circuit breaker must set status to disabled',
    );
  });

  it('calls onDeath when circuit breaker trips', () => {
    const body = extractFunctionBody(source, 'private handleClose');

    const cbIdx = body.indexOf('MAX_CONSECUTIVE_ERRORS');
    const nearbySlice = body.slice(cbIdx, cbIdx + 300);

    assert.ok(
      nearbySlice.includes('onDeath'),
      'circuit breaker must call onDeath to trigger channel reassignment',
    );
  });

  it('errorCount is reset to 0 on successful READY or RESUMED', () => {
    // Check READY handler
    const readyBody = extractFunctionBody(source, 'private handleReady');
    assert.ok(
      readyBody.includes('errorCount = 0'),
      'handleReady must reset errorCount to 0',
    );

    // Check RESUMED handling in handleDispatch
    const dispatchBody = extractFunctionBody(source, 'private handleDispatch');
    assert.ok(
      dispatchBody.includes('errorCount = 0'),
      'RESUMED handler must reset errorCount to 0',
    );
  });

  it('circuit breaker check happens before fatal/resumable close code checks', () => {
    const body = extractFunctionBody(source, 'private handleClose');

    const cbIdx = body.indexOf('errorCount >= MAX_CONSECUTIVE_ERRORS');
    const fatalIdx = body.indexOf('FATAL_CLOSE_CODES');

    assert.ok(cbIdx !== -1, 'circuit breaker check must exist');
    assert.ok(fatalIdx !== -1, 'fatal close code check must exist');
    assert.ok(
      cbIdx < fatalIdx,
      'circuit breaker check must come before fatal close code handling (errors take priority)',
    );
  });
});
