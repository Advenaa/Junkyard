import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aggregateEntitySentiment, computeAvgSentiment, detectDrift } from '../../src/process/pulse-sentiment.js';

describe('pulse-sentiment', () => {
  describe('aggregateEntitySentiment', () => {
    it('computes average sentiment per entity across summaries', () => {
      const result = aggregateEntitySentiment([
        {
          parsedEntities: [
            { name: 'Bitcoin', sentiment: 0.5 },
            { name: 'Ethereum', sentiment: -0.4 },
          ],
        },
        {
          parsedEntities: [
            { name: 'Bitcoin', sentiment: -0.1 },
            { name: 'Ethereum', sentiment: 0.2 },
          ],
        },
      ]);

      assert.equal(result.get('bitcoin'), 0.2);
      assert.equal(result.get('ethereum'), -0.1);
    });

    it('returns an empty map for an empty summaries array', () => {
      const result = aggregateEntitySentiment([]);
      assert.equal(result.size, 0);
    });

    it('handles a single entity with a single mention', () => {
      const result = aggregateEntitySentiment([
        {
          parsedEntities: [{ name: 'Solana', sentiment: 0.7 }],
        },
      ]);

      assert.equal(result.size, 1);
      assert.equal(result.get('solana'), 0.7);
    });

    it('aggregates entity names case-insensitively', () => {
      const result = aggregateEntitySentiment([
        {
          parsedEntities: [{ name: 'Bitcoin', sentiment: 0.4 }],
        },
        {
          parsedEntities: [{ name: 'BITCOIN', sentiment: 0.2 }],
        },
      ]);

      assert.equal(result.size, 1);
      assert.ok(Math.abs((result.get('bitcoin') ?? 0) - 0.3) < Number.EPSILON);
    });

    it('handles entities with zero sentiment values', () => {
      const result = aggregateEntitySentiment([
        {
          parsedEntities: [{ name: 'Arbitrum', sentiment: 0 }],
        },
        {
          parsedEntities: [{ name: 'ARBITRUM', sentiment: 0 }],
        },
      ]);

      assert.equal(result.get('arbitrum'), 0);
    });
  });

  describe('detectDrift', () => {
    it('detects drift when delta is greater than 0.4', () => {
      const result = detectDrift(new Map([['bitcoin', 0.1]]), [
        { name: 'Bitcoin', sentiment: 0.55, reason: 'Earlier pulse' },
      ]);

      assert.deepEqual(result, [
        {
          entity: 'bitcoin',
          prior: 0.55,
          current: 0.1,
          delta: 0.45000000000000007,
        },
      ]);
    });

    it('returns an empty array when delta is 0.4 or smaller', () => {
      const result = detectDrift(new Map([['bitcoin', 0.4]]), [
        { name: 'Bitcoin', sentiment: 0.8, reason: 'Earlier pulse' },
      ]);

      assert.deepEqual(result, []);
    });

    it('matches current and prior entity names case-insensitively', () => {
      const result = detectDrift(new Map([['BITCOIN', -0.2]]), [
        { name: 'bitcoin', sentiment: 0.5, reason: 'Earlier pulse' },
      ]);

      assert.equal(result.length, 1);
      assert.equal(result[0]?.entity, 'BITCOIN');
      assert.equal(result[0]?.prior, 0.5);
      assert.equal(result[0]?.current, -0.2);
    });
  });

  describe('computeAvgSentiment', () => {
    it('computes a rounded average sentiment', () => {
      const result = computeAvgSentiment({
        entitySentiment: [{ sentiment: 0.111 }, { sentiment: 0.222 }],
      });

      assert.equal(result, 0.17);
    });

    it('returns null for an empty entity sentiment array', () => {
      const result = computeAvgSentiment({ entitySentiment: [] });
      assert.equal(result, null);
    });
  });
});
