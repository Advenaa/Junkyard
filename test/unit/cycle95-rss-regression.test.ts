/**
 * Cycle-95 structural regression tests for RSS ingestion fixes.
 *
 * RS-001: HTML content stripping when contentSnippet is missing
 * RS-004: RSS engagement sentinel value
 *
 * These are source-level pattern tests — they read the TypeScript source
 * and assert structural invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rssSrc = readFileSync(
  new URL('../../src/ingest/rss.ts', import.meta.url), 'utf-8',
);

describe('RS-001 — HTML content stripping when contentSnippet missing', () => {
  it('checks item.contentSnippet === undefined before HTML extraction', () => {
    assert.ok(
      rssSrc.includes('item.contentSnippet === undefined'),
      'should contain item.contentSnippet === undefined check',
    );
  });

  it('uses parseHTML for HTML content extraction', () => {
    const snippetCheckIdx = rssSrc.indexOf('item.contentSnippet === undefined');
    const parseHTMLIdx = rssSrc.indexOf('parseHTML(', snippetCheckIdx);

    assert.ok(snippetCheckIdx > -1, 'should find contentSnippet === undefined check');
    assert.ok(parseHTMLIdx > -1, 'should find parseHTML call after the check');
    assert.ok(
      parseHTMLIdx > snippetCheckIdx,
      'parseHTML call must appear after the contentSnippet === undefined check',
    );
  });

  it('compares extracted.length > content.length before replacing', () => {
    const snippetCheckIdx = rssSrc.indexOf('item.contentSnippet === undefined');
    const lengthCompareIdx = rssSrc.indexOf('extracted.length > content.length', snippetCheckIdx);

    assert.ok(snippetCheckIdx > -1, 'should find contentSnippet === undefined check');
    assert.ok(lengthCompareIdx > -1, 'should find extracted.length > content.length comparison');
    assert.ok(
      lengthCompareIdx > snippetCheckIdx,
      'length comparison must appear after the contentSnippet check',
    );
  });

  it('references item.content as the raw HTML source', () => {
    const snippetCheckIdx = rssSrc.indexOf('item.contentSnippet === undefined');
    assert.ok(snippetCheckIdx > -1, 'should find contentSnippet === undefined check');

    // Search for item.content that is NOT item.contentSnippet (use word boundary after "content")
    const afterCheck = rssSrc.slice(snippetCheckIdx);
    const itemContentMatch = afterCheck.match(/item\.content[^S]/);
    assert.ok(
      itemContentMatch,
      'should reference item.content (not item.contentSnippet) after the undefined check',
    );
  });
});

describe('RS-004 — RSS engagement sentinel', () => {
  it('uses engagement: -1 (not engagement: 0)', () => {
    assert.ok(
      rssSrc.includes('engagement: -1'),
      'should contain engagement: -1 sentinel value',
    );
    // Ensure there is no engagement: 0 in the return object area
    const returnIdx = rssSrc.indexOf('return {');
    const satisfiesIdx = rssSrc.indexOf('satisfies RawItem', returnIdx);
    if (returnIdx > -1 && satisfiesIdx > -1) {
      const returnBlock = rssSrc.slice(returnIdx, satisfiesIdx);
      assert.ok(
        !returnBlock.includes('engagement: 0'),
        'should NOT contain engagement: 0 in the return block',
      );
    }
  });

  it('has a comment mentioning sentinel or unknown near engagement', () => {
    const engagementIdx = rssSrc.indexOf('engagement: -1');
    assert.ok(engagementIdx > -1, 'should find engagement: -1');

    // Check the surrounding context (100 chars before and after) for sentinel/unknown comment
    const contextStart = Math.max(0, engagementIdx - 100);
    const contextEnd = Math.min(rssSrc.length, engagementIdx + 100);
    const context = rssSrc.slice(contextStart, contextEnd);

    const hasSentinelComment = /\/\/.*sentinel/i.test(context) || /\/\/.*unknown/i.test(context);
    assert.ok(
      hasSentinelComment,
      'should have a comment mentioning "sentinel" or "unknown" near engagement: -1',
    );
  });
});
