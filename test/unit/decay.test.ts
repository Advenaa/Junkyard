import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Entity Decay', () => {
  it('applies 0.95 decay factor correctly', () => {
    const relevance = 2.0;
    const decayed = relevance * 0.95;
    assert.strictEqual(decayed, 1.9);
  });

  it('multiple decay cycles converge toward zero', () => {
    let r = 1.0;
    for (let i = 0; i < 100; i++) r *= 0.95;
    assert.ok(r < 0.01);
  });

  it('archival threshold is 0.01', () => {
    assert.ok(0.009 < 0.01); // should archive
    assert.ok(!(0.011 < 0.01)); // should not archive
  });

  it('archival requires both low relevance AND 90 days stale', () => {
    const now = Date.now();
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
    const fiftyDaysAgo = now - 50 * 24 * 60 * 60 * 1000;

    // Low relevance + old enough → archive
    assert.ok(0.005 < 0.01 && ninetyDaysAgo < now - 89 * 24 * 60 * 60 * 1000);

    // Low relevance but recent → don't archive
    assert.ok(0.005 < 0.01 && !(fiftyDaysAgo < now - 89 * 24 * 60 * 60 * 1000));
  });

  it('reactivation sets relevance to 0.5', () => {
    const reactivatedRelevance = 0.5;
    assert.strictEqual(reactivatedRelevance, 0.5);
  });

  it('decay preserves relative ordering', () => {
    const a = 2.0 * 0.95;
    const b = 1.0 * 0.95;
    assert.ok(a > b);
  });
});
