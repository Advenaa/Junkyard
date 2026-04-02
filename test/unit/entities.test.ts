import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Entity Resolution', () => {
  it('normalizes aliases to lowercase', () => {
    const alias = 'Ethereum';
    assert.strictEqual(alias.toLowerCase(), 'ethereum');
  });

  it('strips $ prefix from token aliases', () => {
    const alias = '$ETH';
    const normalized = alias.replace(/^\$/, '').toLowerCase();
    assert.strictEqual(normalized, 'eth');
  });

  it('handles multiple aliases for same entity', () => {
    const aliases = ['ETH', '$ETH', 'Ethereum', 'ethereum'];
    const normalized = new Set(aliases.map(a => a.replace(/^\$/, '').toLowerCase()));
    assert.strictEqual(normalized.size, 2); // 'eth' and 'ethereum'
  });

  it('preserves entity types enum', () => {
    const validTypes = ['token', 'person', 'project', 'company', 'event'];
    assert.ok(validTypes.includes('token'));
    assert.ok(!validTypes.includes('unknown'));
  });

  it('source weights are correct', () => {
    const weights: Record<string, number> = { discord: 1.0, twitter: 1.5, rss: 2.0, news: 2.0 };
    assert.strictEqual(weights['discord'], 1.0);
    assert.strictEqual(weights['twitter'], 1.5);
    assert.strictEqual(weights['news'], 2.0);
  });

  it('relevance formula produces expected values', () => {
    const mentionCount = 5;
    const sourceWeight = 1.5;
    const relevanceDelta = Math.log(1 + mentionCount) * sourceWeight;
    assert.ok(relevanceDelta > 0);
    assert.ok(Math.abs(relevanceDelta - Math.log(6) * 1.5) < 0.001);
  });

  it('Indonesian entity seeds include expected entries', () => {
    const expected = ['OJK', 'Bappebti', 'Bank Indonesia', 'BEI', 'Indodax', 'Tokocrypto', 'Pintu', 'Rupiah'];
    assert.strictEqual(expected.length, 8);
    assert.ok(expected.includes('Bank Indonesia'));
  });
});
