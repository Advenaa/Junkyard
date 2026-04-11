import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bytesToVector } from '../../src/embed.js';

describe('bytesToVector', () => {
  it('round-trips a valid Float32Array buffer', () => {
    const input = new Float32Array([1.5, -2.5, 3.5]);
    const result = bytesToVector(Buffer.from(input.buffer));

    assert.ok(result);
    assert.deepEqual(Array.from(result), Array.from(input));
  });

  it('returns null for a zero-length buffer', () => {
    assert.equal(bytesToVector(Buffer.alloc(0)), null);
  });

  it('returns null for a buffer whose length is not divisible by 4', () => {
    assert.equal(bytesToVector(Buffer.alloc(5)), null);
  });
});
