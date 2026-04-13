import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getNarrativeDrilldownById, getNarrativeWatchlist } from '../../src/db/queries.js';
import { makeMockPool } from '../helpers/factories.js';

function mockPool(responses: Array<{ rows?: unknown[]; rowCount?: number }>) {
  let index = 0;
  return makeMockPool(() => {
    const next = responses[index] ?? { rows: [], rowCount: 0 };
    index += 1;
    return { rows: next.rows ?? [], rowCount: next.rowCount ?? next.rows?.length ?? 0 };
  });
}

describe('getNarrativeWatchlist', () => {
  it('returns latestDate plus mapped narrative watchlist entries', async () => {
    const pool = mockPool([
      { rows: [{ latest_date: '2026-04-08' }] },
      {
        rows: [
          {
            id: 'nar-sol',
            name: 'Solana fee rebound',
            date: '2026-04-08',
            member_count: 6,
            avg_sentiment: 0.42,
            signal_strength: 'emerging',
          },
          {
            id: 'nar-btc',
            name: 'BTC treasury chatter',
            date: '2026-04-08',
            member_count: 4,
            avg_sentiment: -0.15,
            signal_strength: 'fading',
          },
        ],
      },
    ]);

    const overview = await getNarrativeWatchlist(pool as never);

    assert.deepEqual(overview, {
      latestDate: '2026-04-08',
      entries: [
        {
          id: 'nar-sol',
          name: 'Solana fee rebound',
          date: '2026-04-08',
          memberCount: 6,
          avgSentiment: 0.42,
          signalStrength: 'emerging',
        },
        {
          id: 'nar-btc',
          name: 'BTC treasury chatter',
          date: '2026-04-08',
          memberCount: 4,
          avgSentiment: -0.15,
          signalStrength: 'fading',
        },
      ],
    });
  });

  it('returns an empty overview when no narrative rows exist yet', async () => {
    const pool = mockPool([{ rows: [{ latest_date: null }] }]);

    const overview = await getNarrativeWatchlist(pool as never);

    assert.deepEqual(overview, { latestDate: null, entries: [] });
  });

  it('preserves latestDate even when the newest cluster date has no returned rows', async () => {
    const pool = mockPool([{ rows: [{ latest_date: '2026-04-08' }] }, { rows: [] }]);

    const overview = await getNarrativeWatchlist(pool as never);

    assert.deepEqual(overview, { latestDate: '2026-04-08', entries: [] });
  });
});

describe('getNarrativeDrilldownById', () => {
  it('returns narrative metadata plus recent clustered summary previews', async () => {
    const pool = mockPool([
      {
        rows: [
          {
            id: 'nar-sol',
            name: 'Solana fee rebound',
            date: '2026-04-08',
            member_count: 6,
            avg_sentiment: 0.42,
            signal_strength: 'emerging',
            summary_ids: ['sum-2', 'sum-1'],
          },
        ],
      },
      {
        rows: [
          {
            id: 'sum-2',
            source: 'twitter',
            source_id: '@solwatch',
            body: '{"summary":"CT is reviving the Solana fee rebound trade."}',
            sentiment: 0.61,
            urgency: 'elevated',
            item_count: 5,
            created_at: 1712534400000,
          },
          {
            id: 'sum-1',
            source: 'discord',
            source_id: 'chan-1',
            body: '{"summary":"Discord traders are echoing the same Solana setup."}',
            sentiment: 0.33,
            urgency: 'routine',
            item_count: 3,
            created_at: 1712530800000,
          },
        ],
      },
    ]);

    const drilldown = await getNarrativeDrilldownById(pool as never, 'nar-sol');

    assert.deepEqual(drilldown, {
      id: 'nar-sol',
      name: 'Solana fee rebound',
      date: '2026-04-08',
      memberCount: 6,
      avgSentiment: 0.42,
      signalStrength: 'emerging',
      summaries: [
        {
          id: 'sum-2',
          source: 'twitter',
          sourceId: '@solwatch',
          sentiment: 0.61,
          urgency: 'elevated',
          itemCount: 5,
          createdAt: 1712534400000,
          body: '{"summary":"CT is reviving the Solana fee rebound trade."}',
        },
        {
          id: 'sum-1',
          source: 'discord',
          sourceId: 'chan-1',
          sentiment: 0.33,
          urgency: 'routine',
          itemCount: 3,
          createdAt: 1712530800000,
          body: '{"summary":"Discord traders are echoing the same Solana setup."}',
        },
      ],
    });
  });

  it('returns null when the narrative does not exist', async () => {
    const pool = mockPool([{ rows: [] }]);

    const drilldown = await getNarrativeDrilldownById(pool as never, 'missing');

    assert.equal(drilldown, null);
  });
});
