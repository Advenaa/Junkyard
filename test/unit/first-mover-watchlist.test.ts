import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getRecentFirstMoverWatchlist } from '../../src/db/queries.js';

function mockPool(responses: Array<{ rows?: unknown[]; rowCount?: number }>) {
  let index = 0;
  return {
    async query() {
      const next = responses[index] ?? { rows: [], rowCount: 0 };
      index += 1;
      return { rows: next.rows ?? [], rowCount: next.rowCount ?? next.rows?.length ?? 0 };
    },
  };
}

describe('getRecentFirstMoverWatchlist', () => {
  it('returns latestTimestamp plus mapped recent first-mover entries', async () => {
    const pool = mockPool([
      { rows: [{ latest_timestamp: 1712563200000 }] },
      {
        rows: [
          {
            entity_id: 'eth',
            entity_name: 'Ethereum',
            author_id: 'auth-1',
            platform: 'twitter',
            handle: 'defidad',
            display_name: 'DeFi Dad',
            credibility_score: 0.8,
            total_calls: 5,
            correct_calls: 4,
            claim_type: 'bullish',
            claim_text: 'ETH breakout likely if ETF chatter sticks.',
            source_item_id: 'item-1',
            timestamp: 1712563200000,
            next_tracked_call_time: 1712577600000,
            lead_window_ms: 14400000,
          },
          {
            entity_id: 'sol',
            entity_name: 'Solana',
            author_id: 'auth-2',
            platform: 'discord',
            handle: 'chainwatcher',
            display_name: null,
            credibility_score: null,
            total_calls: 0,
            correct_calls: 0,
            claim_type: 'event',
            claim_text: 'SOL governance chatter is starting to broaden.',
            source_item_id: null,
            timestamp: 1712556000000,
            next_tracked_call_time: null,
            lead_window_ms: null,
          },
        ],
      },
    ]);

    const overview = await getRecentFirstMoverWatchlist(pool as never, 1711958400000, 6);

    assert.deepEqual(overview, {
      latestTimestamp: 1712563200000,
      entries: [
        {
          entityId: 'eth',
          entityName: 'Ethereum',
          authorId: 'auth-1',
          platform: 'twitter',
          handle: 'defidad',
          displayName: 'DeFi Dad',
          claimType: 'bullish',
          claimText: 'ETH breakout likely if ETF chatter sticks.',
          sourceItemId: 'item-1',
          timestamp: 1712563200000,
          nextTrackedCallTime: 1712577600000,
          leadWindowMs: 14400000,
          credibilityScore: 0.8,
          totalCalls: 5,
          correctCalls: 4,
        },
        {
          entityId: 'sol',
          entityName: 'Solana',
          authorId: 'auth-2',
          platform: 'discord',
          handle: 'chainwatcher',
          displayName: null,
          claimType: 'event',
          claimText: 'SOL governance chatter is starting to broaden.',
          sourceItemId: null,
          timestamp: 1712556000000,
          nextTrackedCallTime: null,
          leadWindowMs: null,
          credibilityScore: null,
          totalCalls: 0,
          correctCalls: 0,
        },
      ],
    });
  });

  it('returns an empty overview when no recent first-mover data exists', async () => {
    const pool = mockPool([{ rows: [{ latest_timestamp: null }] }]);

    const overview = await getRecentFirstMoverWatchlist(pool as never, 1711958400000, 6);

    assert.deepEqual(overview, { latestTimestamp: null, entries: [] });
  });
});
