/**
 * Structural regression tests for cycle 110: RS-010
 *
 * RS-010: NaN timestamp from unparseable isoDate is now handled.
 *         A `safeParseDate` helper returns 0 for undefined/null/unparseable
 *         dates instead of NaN. The item timestamp assignment path has a
 *         Number.isNaN guard with fallback to Date.now() and a warning log.
 *         Filter/sort paths use safeParseDate instead of raw Date construction.
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
// RS-010: NaN timestamp from unparseable isoDate
// ===========================================================================

describe('RS-010: safeParseDate helper exists and handles bad dates', () => {
  const src = readSrc('src/ingest/rss.ts');

  it('defines a safeParseDate function', () => {
    assert.match(src, /function safeParseDate\(/, 'rss.ts must define a safeParseDate helper function');
  });

  it('safeParseDate checks for NaN via Number.isNaN or isNaN', () => {
    // The function body should contain a NaN check
    const fnMatch = src.match(/function safeParseDate\([^)]*\)[^{]*\{([\s\S]*?\n\})/);
    assert.ok(fnMatch, 'safeParseDate function body must be extractable');
    const body = fnMatch![1];
    assert.match(body, /(?:Number\.isNaN|isNaN)\(/, 'safeParseDate must check for NaN using Number.isNaN or isNaN');
  });

  it('safeParseDate returns 0 as the fallback for bad dates', () => {
    const fnMatch = src.match(/function safeParseDate\([^)]*\)[^{]*\{([\s\S]*?\n\})/);
    assert.ok(fnMatch, 'safeParseDate function body must be extractable');
    const body = fnMatch![1];
    // Should return 0 for null/undefined and for NaN results
    const zeroReturns = (body.match(/return 0/g) ?? []).length;
    assert.ok(zeroReturns >= 1, `safeParseDate must return 0 for bad dates (found ${zeroReturns} return-0 statements)`);
  });
});

describe('RS-010: item timestamp assignment guards against NaN', () => {
  const src = readSrc('src/ingest/rss.ts');

  it('has a Number.isNaN check on the timestamp variable', () => {
    assert.match(src, /Number\.isNaN\(timestamp\)/, 'The item processing path must check Number.isNaN(timestamp)');
  });

  it('logs a warning for unparseable dates', () => {
    assert.match(
      src,
      /unparseable|invalid date|bad date/i,
      'A warning must be logged when an unparseable date is encountered',
    );
  });

  it('falls back to Date.now() when timestamp is NaN', () => {
    // After the NaN check there should be a Date.now() fallback
    const nanIdx = src.indexOf('Number.isNaN(timestamp)');
    assert.ok(nanIdx !== -1, 'Number.isNaN(timestamp) must exist in source');
    const afterNaN = src.slice(nanIdx, nanIdx + 300);
    assert.match(
      afterNaN,
      /timestamp\s*=\s*Date\.now\(\)/,
      'timestamp must be reassigned to Date.now() after the NaN check',
    );
  });
});

describe('RS-010: filter and sort paths use safeParseDate', () => {
  const src = readSrc('src/ingest/rss.ts');

  it('filter paths call safeParseDate instead of raw new Date(item.isoDate)', () => {
    // Extract the filter callbacks — they should use safeParseDate, not raw Date
    const filterBlocks = src.match(/\.filter\(\s*\(item\)\s*=>\s*\{[\s\S]*?\}\s*\)/g) ?? [];
    assert.ok(filterBlocks.length > 0, 'There must be at least one .filter() call on feed items');
    for (const block of filterBlocks) {
      assert.ok(
        !block.includes('new Date(item.isoDate'),
        'Filter callbacks must not use raw new Date(item.isoDate...) — use safeParseDate instead',
      );
      assert.ok(block.includes('safeParseDate'), 'Filter callbacks must use safeParseDate for date parsing');
    }
  });

  it('sort comparator calls safeParseDate instead of raw new Date', () => {
    const sortBlock = src.match(/\.sort\(\s*\(a,\s*b\)\s*=>\s*\{[\s\S]*?\}\s*\)/);
    assert.ok(sortBlock, 'There must be a .sort() comparator on filtered items');
    const block = sortBlock![0];
    assert.ok(!block.includes('new Date('), 'Sort comparator must not use raw new Date() — use safeParseDate instead');
    assert.ok(block.includes('safeParseDate'), 'Sort comparator must use safeParseDate for date comparison');
  });
});
