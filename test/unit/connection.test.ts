import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// CF-001: Structural regression — pool error handler
// ---------------------------------------------------------------------------

describe('CF-001: pool idle client error handler (structural)', () => {
  const src = readFileSync(new URL('../../src/db/connection.ts', import.meta.url), 'utf-8');

  it('registers a pool.on("error") handler', () => {
    assert.ok(
      src.includes("pool.on('error'") || src.includes('pool.on("error"'),
      'connection.ts must register pool.on("error", ...) to handle idle client errors',
    );
  });

  it('error handler logs but does not call process.exit', () => {
    assert.ok(!src.includes('process.exit'), 'connection.ts must NOT call process.exit — pool self-heals');
  });

  it('error handler logs but does not rethrow', () => {
    // Extract the error handler body between pool.on('error' and the next pool.on or return
    const errorStart = src.indexOf("pool.on('error'");
    assert.ok(errorStart > -1, 'pool.on("error") must exist');

    // Find the closing of the error handler (next pool.on or return statement)
    const nextSection = src.indexOf('pool.on(', errorStart + 1);
    const handlerBody =
      nextSection > -1 ? src.slice(errorStart, nextSection) : src.slice(errorStart, src.indexOf('return pool'));

    assert.ok(!handlerBody.includes('throw '), 'error handler must not rethrow — it should only log');
  });

  it('logs the error message via console.error', () => {
    assert.ok(
      src.includes('console.error') || src.includes('log.error'),
      'connection.ts must log the idle client error',
    );
  });
});
