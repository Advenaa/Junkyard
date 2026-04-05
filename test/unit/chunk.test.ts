import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkByTokens, estimateTokens, CHUNK_TOKEN_BUDGET } from '../../src/process/chunk.js';

type Item = { content: string };

function makeItem(charLength: number): Item {
  return { content: 'x'.repeat(charLength) };
}

describe('estimateTokens', () => {
  it('returns ~3 for "hello world" (11 chars / 4 = 2.75 → ceil 3)', () => {
    assert.equal(estimateTokens('hello world'), 3);
  });

  it('returns 1 for a single character', () => {
    assert.equal(estimateTokens('a'), 1);
  });

  it('returns 0 for empty string (ceil(0) = 0)', () => {
    assert.equal(estimateTokens(''), 0);
  });

  it('rounds up fractional tokens', () => {
    // 5 chars / 4 = 1.25 → 2
    assert.equal(estimateTokens('hello'), 2);
  });
});

describe('chunkByTokens', () => {
  it('returns empty array for empty item list', () => {
    const result = chunkByTokens([], 100);
    assert.deepStrictEqual(result, []);
  });

  it('single item within budget → one chunk', () => {
    const items: Item[] = [{ content: 'short text' }];
    const result = chunkByTokens(items, 100);
    assert.equal(result.length, 1);
    assert.equal(result[0].length, 1);
    assert.equal(result[0][0].content, 'short text');
  });

  it('single item exceeding budget → still one chunk (oversized passthrough)', () => {
    // 400 chars = 100 tokens, budget is 10
    const items: Item[] = [makeItem(400)];
    const result = chunkByTokens(items, 10);
    assert.equal(result.length, 1);
    assert.equal(result[0].length, 1);
  });

  it('multiple items fitting in one chunk', () => {
    // Each item: 20 chars = 5 tokens. 3 items = 15 tokens. Budget 100.
    const items: Item[] = [makeItem(20), makeItem(20), makeItem(20)];
    const result = chunkByTokens(items, 100);
    assert.equal(result.length, 1);
    assert.equal(result[0].length, 3);
  });

  it('items spanning multiple chunks at budget boundary', () => {
    // Each item: 40 chars = 10 tokens. Budget = 20.
    // Item 1: 10 tokens (current = 10)
    // Item 2: 10 + 10 = 20 (still fits, current = 20)
    // Item 3: 20 + 10 = 30 > 20 → flush, start new chunk
    const items: Item[] = [makeItem(40), makeItem(40), makeItem(40)];
    const result = chunkByTokens(items, 20);
    assert.equal(result.length, 2);
    assert.equal(result[0].length, 2);
    assert.equal(result[1].length, 1);
  });

  it('each item exactly at budget creates one-per-chunk after the first', () => {
    // Each item: 40 chars = 10 tokens. Budget = 10.
    // Item 1: 10 tokens (current = 10)
    // Item 2: 10 + 10 = 20 > 10 → flush. New chunk with item 2 (10)
    // Item 3: 10 + 10 = 20 > 10 → flush. New chunk with item 3 (10)
    const items: Item[] = [makeItem(40), makeItem(40), makeItem(40)];
    const result = chunkByTokens(items, 10);
    assert.equal(result.length, 3);
    assert.equal(result[0].length, 1);
    assert.equal(result[1].length, 1);
    assert.equal(result[2].length, 1);
  });

  it('uses default CHUNK_TOKEN_BUDGET constant of 6000', () => {
    assert.equal(CHUNK_TOKEN_BUDGET, 6000);
  });

  it('preserves item properties beyond content', () => {
    const items = [
      { content: 'hello', extra: 42 },
      { content: 'world', extra: 99 },
    ];
    const result = chunkByTokens(items, 100);
    assert.equal(result[0][0].extra, 42);
    assert.equal(result[0][1].extra, 99);
  });
});
