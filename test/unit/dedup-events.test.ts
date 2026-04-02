import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateEvents } from '../../src/process/dedup-events.js';

describe('deduplicateEvents', () => {
  it('returns empty array for empty input', () => {
    assert.deepStrictEqual(deduplicateEvents([]), []);
  });

  it('returns single event unchanged', () => {
    const events = ['BTC price hits $50000'];
    assert.deepStrictEqual(deduplicateEvents(events), ['BTC price hits $50000']);
  });

  it('removes exact duplicates', () => {
    const events = [
      'BTC price hits $50000',
      'BTC price hits $50000',
      'ETH breaks $3000',
      'BTC price hits $50000',
    ];
    const result = deduplicateEvents(events);
    assert.deepStrictEqual(result, [
      'BTC price hits $50000',
      'ETH breaks $3000',
    ]);
  });

  it('deduplicates similar events above 0.85 threshold', () => {
    const events = [
      'BTC price hits $50000',
      'BTC price hits $50001',
    ];
    const result = deduplicateEvents(events);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], 'BTC price hits $50000');
  });

  it('keeps dissimilar events below 0.85 threshold', () => {
    const events = [
      'SEC rejects Bitcoin ETF',
      'SEC approves Bitcoin ETF',
    ];
    const result = deduplicateEvents(events);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0], 'SEC rejects Bitcoin ETF');
    assert.strictEqual(result[1], 'SEC approves Bitcoin ETF');
  });

  it('preserves order — first occurrence is kept', () => {
    const events = [
      'BTC rallied to 50000 today on strong volume',
      'ETH breaks past 3000 resistance level',
      'BTC rallied to 50001 today on strong volume',
    ];
    const result = deduplicateEvents(events);
    // The third event is similar to the first (>0.85), so it should be deduped
    // First and second should remain in original order
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0], 'BTC rallied to 50000 today on strong volume');
    assert.strictEqual(result[1], 'ETH breaks past 3000 resistance level');
  });

  it('respects custom threshold', () => {
    const events = [
      'BTC price hits $50000',
      'BTC price hits $50001',
    ];
    // With a very high threshold (0.99), these should be kept as separate
    const strict = deduplicateEvents(events, 0.99);
    assert.strictEqual(strict.length, 2);

    // With a low threshold (0.5), they should be deduped
    const loose = deduplicateEvents(events, 0.5);
    assert.strictEqual(loose.length, 1);
  });

  it('handles empty string events', () => {
    // Two empty strings: maxLen=0, returns true (duplicate)
    const events = ['', ''];
    const result = deduplicateEvents(events);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], '');
  });
});
