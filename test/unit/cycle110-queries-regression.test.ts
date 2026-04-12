/**
 * Structural regression tests for cycle 110: QR-009, QR-010
 *
 * QR-009: insertSummary is idempotent via ON CONFLICT (id) DO NOTHING
 * QR-010: insertSource call in server.ts uses Date.now() not epoch-seconds
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readServerSource } from './helpers/server-source.js';
import { readQueriesSource } from './helpers/queries-source.js';

// ===========================================================================
// QR-010: insertSource uses Date.now() not epoch-seconds
// ===========================================================================

describe('QR-010: insertSource call uses Date.now() not epoch-seconds', () => {
  const src = readServerSource();

  // Extract the line(s) around the insertSource call
  const insertSourceCallLines = src.split('\n').filter((line) => line.includes('insertSource'));

  it('insertSource call does NOT contain / 1000', () => {
    for (const line of insertSourceCallLines) {
      assert.ok(!line.includes('/ 1000'), `insertSource call must not contain "/ 1000" but found: ${line.trim()}`);
    }
  });

  it('insertSource call does NOT contain Math.floor', () => {
    for (const line of insertSourceCallLines) {
      assert.ok(
        !line.includes('Math.floor'),
        `insertSource call must not contain "Math.floor" but found: ${line.trim()}`,
      );
    }
  });

  it('insertSource call passes Date.now() as the timestamp argument', () => {
    const callLine = insertSourceCallLines.find((line) => line.includes('Date.now()'));
    assert.ok(callLine !== undefined, 'insertSource call must contain Date.now() in the invocation line');
  });
});

// ===========================================================================
// QR-009: insertSummary idempotent via ON CONFLICT
// ===========================================================================

describe('QR-009: insertSummary is idempotent', () => {
  const src = readQueriesSource();

  // Extract the insertSummary function body
  const fnStart = src.indexOf('async function insertSummary');
  const fnBody = src.slice(fnStart, fnStart + 600);

  it('insertSummary SQL contains ON CONFLICT', () => {
    assert.ok(fnStart !== -1, 'insertSummary function must exist in queries.ts');
    assert.ok(fnBody.includes('ON CONFLICT'), 'insertSummary SQL must contain "ON CONFLICT" for idempotency');
  });

  it('insertSummary SQL contains DO NOTHING', () => {
    assert.ok(fnBody.includes('DO NOTHING'), 'insertSummary SQL must contain "DO NOTHING" for idempotency');
  });
});
