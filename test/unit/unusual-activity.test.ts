import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getUnusualActivityOverview } from '../../src/db/queries.js';
import { makeMockPool } from '../helpers/factories.js';

function mockPool(responses: Array<{ rows?: unknown[]; rowCount?: number }>) {
  let index = 0;
  return makeMockPool(() => {
    const next = responses[index] ?? { rows: [], rowCount: 0 };
    index += 1;
    return { rows: next.rows ?? [], rowCount: next.rowCount ?? next.rows?.length ?? 0 };
  });
}

describe('getUnusualActivityOverview', () => {
  it('returns latestDate plus mapped unusual-activity entries', async () => {
    const pool = mockPool([
      { rows: [{ latest_date: '2026-04-08' }] },
      {
        rows: [
          {
            entity_id: 'ent-omni',
            entity_name: 'Omni',
            relevance_score: 1.4,
            date: '2026-04-08',
            mention_count: 18,
            avg_sentiment: 0.62,
            momentum: 0.31,
            baseline_mentions: 4.5,
            baseline_peak_mentions: 7,
            baseline_days: 6,
            spike_ratio: 4,
          },
        ],
      },
      {
        rows: [
          {
            entity_id: 'ent-omni',
            item_id: 'item-1',
            author: 'alice',
            source: 'twitter',
            source_id: 'sol-watch',
            duplicate_content: 'Omni is ripping higher and every breakout trader is rotating in now.',
          },
          {
            entity_id: 'ent-omni',
            item_id: 'item-2',
            author: 'bob',
            source: 'twitter',
            source_id: 'sol-watch',
            duplicate_content: 'Omni is ripping higher, and every breakout trader is rotating in right now.',
          },
          {
            entity_id: 'ent-omni',
            item_id: 'item-3',
            author: 'carol',
            source: 'discord',
            source_id: 'trading-floor',
            duplicate_content: 'OMNI is ripping higher and every breakout trader is rotating in now',
          },
        ],
      },
    ]);

    const overview = await getUnusualActivityOverview(pool as never);

    assert.equal(overview.latestDate, '2026-04-08');
    assert.deepEqual(overview.entries, [
      {
        entityId: 'ent-omni',
        entityName: 'Omni',
        date: '2026-04-08',
        mentionCount: 18,
        baselineMentionCount: 4.5,
        baselinePeakMentionCount: 7,
        baselineDays: 6,
        avgSentiment: 0.62,
        momentum: 0.31,
        spikeRatio: 4,
        relevanceScore: 1.4,
        lowRelevance: true,
        duplicateClusterSize: 3,
        duplicateAuthorCount: 3,
        duplicateSourceCount: 2,
      },
    ]);
  });

  it('returns an empty overview when no daily rollups exist yet', async () => {
    const pool = mockPool([{ rows: [{ latest_date: null }] }]);

    const overview = await getUnusualActivityOverview(pool as never);

    assert.deepEqual(overview, { latestDate: null, entries: [] });
  });

  it('preserves latestDate even when no entities clear the heuristic thresholds', async () => {
    const pool = mockPool([{ rows: [{ latest_date: '2026-04-08' }] }, { rows: [] }]);

    const overview = await getUnusualActivityOverview(pool as never);

    assert.deepEqual(overview, { latestDate: '2026-04-08', entries: [] });
  });

  it('ignores weak duplicate clusters that do not span enough posts or authors', async () => {
    const pool = mockPool([
      { rows: [{ latest_date: '2026-04-08' }] },
      {
        rows: [
          {
            entity_id: 'ent-omni',
            entity_name: 'Omni',
            relevance_score: 12.8,
            date: '2026-04-08',
            mention_count: 18,
            avg_sentiment: 0.62,
            momentum: 0.31,
            baseline_mentions: 4.5,
            baseline_peak_mentions: 7,
            baseline_days: 6,
            spike_ratio: 4,
          },
        ],
      },
      {
        rows: [
          {
            entity_id: 'ent-omni',
            item_id: 'item-1',
            author: 'alice',
            source: 'twitter',
            source_id: 'sol-watch',
            duplicate_content: 'Omni is ripping higher and every breakout trader is rotating in now.',
          },
          {
            entity_id: 'ent-omni',
            item_id: 'item-2',
            author: 'alice',
            source: 'twitter',
            source_id: 'sol-watch',
            duplicate_content: 'Omni is ripping higher, every breakout trader is rotating in now.',
          },
        ],
      },
    ]);

    const overview = await getUnusualActivityOverview(pool as never);

    assert.equal(overview.entries[0]?.duplicateClusterSize, null);
    assert.equal(overview.entries[0]?.duplicateAuthorCount, null);
    assert.equal(overview.entries[0]?.duplicateSourceCount, null);
    assert.equal(overview.entries[0]?.relevanceScore, 12.8);
    assert.equal(overview.entries[0]?.lowRelevance, false);
  });

  it('flags lower-relevance breakout entries for roadmap-aligned watchlisting', async () => {
    const pool = mockPool([
      { rows: [{ latest_date: '2026-04-08' }] },
      {
        rows: [
          {
            entity_id: 'ent-new',
            entity_name: 'FreshFi',
            relevance_score: 2.2,
            date: '2026-04-08',
            mention_count: 13,
            avg_sentiment: 0.44,
            momentum: 0.27,
            baseline_mentions: 3.1,
            baseline_peak_mentions: 5,
            baseline_days: 6,
            spike_ratio: 4.19,
          },
          {
            entity_id: 'ent-btc',
            entity_name: 'Bitcoin',
            relevance_score: 42.5,
            date: '2026-04-08',
            mention_count: 40,
            avg_sentiment: 0.35,
            momentum: 0.12,
            baseline_mentions: 21.5,
            baseline_peak_mentions: 29,
            baseline_days: 6,
            spike_ratio: 1.86,
          },
        ],
      },
      { rows: [] },
    ]);

    const overview = await getUnusualActivityOverview(pool as never);

    assert.equal(overview.entries[0]?.entityName, 'FreshFi');
    assert.equal(overview.entries[0]?.lowRelevance, true);
    assert.equal(overview.entries[0]?.relevanceScore, 2.2);
    assert.equal(overview.entries[1]?.entityName, 'Bitcoin');
    assert.equal(overview.entries[1]?.lowRelevance, false);
    assert.equal(overview.entries[1]?.relevanceScore, 42.5);
  });
});
