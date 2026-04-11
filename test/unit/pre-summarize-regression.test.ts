/**
 * Structural + behavioral regression tests for pre-summarize fixes.
 *
 * NR-001: Skipped items clear batch_id on release
 * NR-003: News source type handled in poll loop
 * NR-004: parseLabeledOutput uses generic digit lookahead (not i+1)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseLabeledOutput } from '../../src/pre-summarize/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ===========================================================================
// NR-001: Skipped items clear batch_id on release
// ===========================================================================

describe('NR-001: Skipped items clear batch_id', () => {
  const src = readSrc('src/pre-summarize/index.ts');

  it('release query includes batch_id = NULL', () => {
    // Find the UPDATE for skipped items (near skippedIds.length > 0)
    const skippedSection = src.slice(src.indexOf('skippedIds.length > 0'));
    assert.ok(skippedSection.includes('batch_id = NULL'), 'Skipped item release must clear batch_id');
  });
});

// ===========================================================================
// NR-004: parseLabeledOutput uses generic digit lookahead
// ===========================================================================

describe('NR-004: parseLabeledOutput handles skipped labels', () => {
  const src = readSrc('src/pre-summarize/index.ts');

  it('uses generic digit lookahead, not next-index-specific', () => {
    const fnStart = src.indexOf('function parseLabeledOutput');
    const fn = src.slice(fnStart, fnStart + 500);
    assert.ok(fn.includes('\\d+'), 'Lookahead must match any [N] label, not just [i+1]');
    assert.ok(!fn.includes('i + 1'), 'Must not use i+1 in lookahead pattern');
  });
});

// ===========================================================================
// NR-003: News source type handled in poll loop
// ===========================================================================

describe('NR-003: News source type handled in poll loop', () => {
  const indexSrc = readSrc('src/index.ts');
  const newsSectionStart = indexSrc.indexOf("source === 'news'");
  const newsSection = indexSrc.slice(newsSectionStart, newsSectionStart + 900);

  it('has explicit news source handling', () => {
    assert.ok(indexSrc.includes("source === 'news'"), 'Poll loop must explicitly handle news source type');
    assert.ok(indexSrc.includes('createNewsAdapter(log)'), 'Poll loop must instantiate the news adapter');
    assert.ok(
      newsSection.includes('const result = await newsAdapter.extract(src.source_id)'),
      'News source must call the news adapter',
    );
    assert.ok(
      newsSection.includes('if (result.fetchFailed)'),
      'News source must distinguish fetch failures from empty extraction',
    );
    assert.ok(
      newsSection.includes('news extraction failed — not advancing state'),
      'News fetch failures must be logged before returning',
    );
    assert.ok(newsSection.includes('INSERT INTO source_state'), 'News fetch failures must increment source_state');
    assert.ok(
      newsSection.includes('items = result.item ? [result.item] : []'),
      'News source must still advance on empty extraction',
    );
    assert.ok(!newsSection.includes('skip in poll loop'), 'News source must not be a silent no-op');
  });
});

// ===========================================================================
// parseLabeledOutput behavioral tests
// ===========================================================================

describe('parseLabeledOutput with skipped labels', () => {
  it('does not merge content when a label is skipped', () => {
    const output = '[1] First summary [3] Third summary';
    const results = parseLabeledOutput(output, 3);
    assert.equal(results[0], 'First summary');
    assert.equal(results[1], null); // [2] was skipped
    assert.equal(results[2], 'Third summary');
  });

  it('handles all labels present', () => {
    const output = '[1] First [2] Second [3] Third';
    const results = parseLabeledOutput(output, 3);
    assert.equal(results[0], 'First');
    assert.equal(results[1], 'Second');
    assert.equal(results[2], 'Third');
  });
});
