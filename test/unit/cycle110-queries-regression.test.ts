/**
 * Structural regression tests for cycle 110: QR-008, QR-009, QR-010
 *
 * QR-008: computeDailySentiment filters NULL sentiments
 * QR-009: insertSummary is idempotent via ON CONFLICT (id) DO NOTHING
 * QR-010: insertSource call in server.ts uses Date.now() not epoch-seconds
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
// QR-010: insertSource uses Date.now() not epoch-seconds
// ===========================================================================

describe('QR-010: insertSource call uses Date.now() not epoch-seconds', () => {
  const src = readSrc('src/server.ts');

  // Extract the line(s) around the insertSource call
  const insertSourceCallLines = src
    .split('\n')
    .filter((line) => line.includes('insertSource'));

  it('insertSource call does NOT contain / 1000', () => {
    for (const line of insertSourceCallLines) {
      assert.ok(
        !line.includes('/ 1000'),
        `insertSource call must not contain "/ 1000" but found: ${line.trim()}`,
      );
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
    const callLine = insertSourceCallLines.find(
      (line) => line.includes('Date.now()'),
    );
    assert.ok(
      callLine !== undefined,
      'insertSource call must contain Date.now() in the invocation line',
    );
  });
});

// ===========================================================================
// QR-008: computeDailySentiment filters NULL sentiments
// ===========================================================================

describe('QR-008: computeDailySentiment filters NULL sentiments', () => {
  const src = readSrc('src/db/queries.ts');

  it('computeDailySentiment query contains sentiment IS NOT NULL', () => {
    // Extract the function body
    const fnStart = src.indexOf('async function computeDailySentiment');
    assert.ok(fnStart !== -1, 'computeDailySentiment function must exist in queries.ts');

    const fnBody = src.slice(fnStart, fnStart + 800);
    assert.ok(
      fnBody.includes('sentiment IS NOT NULL'),
      'computeDailySentiment query must include "sentiment IS NOT NULL" to filter nulls',
    );
  });
});

// ===========================================================================
// QR-009: insertSummary idempotent via ON CONFLICT
// ===========================================================================

describe('QR-009: insertSummary is idempotent', () => {
  const src = readSrc('src/db/queries.ts');

  // Extract the insertSummary function body
  const fnStart = src.indexOf('async function insertSummary');
  const fnBody = src.slice(fnStart, fnStart + 600);

  it('insertSummary SQL contains ON CONFLICT', () => {
    assert.ok(fnStart !== -1, 'insertSummary function must exist in queries.ts');
    assert.ok(
      fnBody.includes('ON CONFLICT'),
      'insertSummary SQL must contain "ON CONFLICT" for idempotency',
    );
  });

  it('insertSummary SQL contains DO NOTHING', () => {
    assert.ok(
      fnBody.includes('DO NOTHING'),
      'insertSummary SQL must contain "DO NOTHING" for idempotency',
    );
  });
});
