import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCorrelator, type CorrelatedEntity } from '../../src/process/correlate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Pool whose .query() returns responses in order. */
function mockPool(responses: Array<{ rows?: unknown[]; rowCount?: number }> = []) {
  let callIndex = 0;
  const calls: Array<{ text: string; values: unknown[] }> = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      const resp = responses[callIndex] ?? { rows: [], rowCount: 0 };
      callIndex++;
      return { rows: resp.rows ?? [], rowCount: resp.rowCount ?? 0 };
    },
  };
}

/** Silent logger that swallows everything. */
const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLog,
} as never;

// ===========================================================================
// CorrelatedEntity interface shape
// ===========================================================================

describe('CorrelatedEntity interface', () => {
  it('has the expected shape with all required fields', () => {
    const entity: CorrelatedEntity = {
      entityName: 'Bitcoin',
      sources: [{ source: 'discord', sourceId: 'sum-1', trustWeight: 0.8 }],
      weightedSum: 0.8,
      urgency: 'routine',
    };

    assert.strictEqual(entity.entityName, 'Bitcoin');
    assert.strictEqual(entity.sources.length, 1);
    assert.strictEqual(entity.weightedSum, 0.8);
    assert.strictEqual(entity.urgency, 'routine');
  });

  it('sources array contains source, sourceId, and trustWeight', () => {
    const entity: CorrelatedEntity = {
      entityName: 'Ethereum',
      sources: [
        { source: 'discord', sourceId: 'sum-1', trustWeight: 0.9 },
        { source: 'twitter', sourceId: 'sum-2', trustWeight: 0.7 },
      ],
      weightedSum: 1.6,
      urgency: 'elevated',
    };

    assert.strictEqual(entity.sources[0].source, 'discord');
    assert.strictEqual(entity.sources[0].sourceId, 'sum-1');
    assert.strictEqual(entity.sources[0].trustWeight, 0.9);
    assert.strictEqual(entity.sources[1].source, 'twitter');
  });
});

// ===========================================================================
// createCorrelator — no cross-source correlations
// ===========================================================================

describe('createCorrelator.run() — no correlations', () => {
  it('returns empty correlated array and shouldFlash=false when no rows', async () => {
    const pool = mockPool([
      { rows: [] }, // CORRELATION_SQL returns nothing
    ]);
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.deepStrictEqual(result.correlated, []);
    assert.strictEqual(result.shouldFlash, false);
  });

  it('passes a cutoff timestamp (24h ago) to the correlation query', async () => {
    const before = Date.now() - 24 * 60 * 60 * 1000;
    const pool = mockPool([{ rows: [] }]);
    const correlator = createCorrelator(pool as never, silentLog);
    await correlator.run();
    const after = Date.now() - 24 * 60 * 60 * 1000;

    const cutoff = pool.calls[0].values[0] as number;
    assert.ok(cutoff >= before, 'cutoff should be >= 24h before start');
    assert.ok(cutoff <= after, 'cutoff should be <= 24h before end');
  });
});

// ===========================================================================
// createCorrelator — single entity, two sources
// ===========================================================================

describe('createCorrelator.run() — single entity, two sources', () => {
  function buildPool(opts: {
    trustWeights: Record<string, number>;
    urgencies: Record<string, string>;
    mentions: Array<{ source: string; summary_id: string; sentiment: number }>;
    entityName?: string;
  }) {
    const responses: Array<{ rows?: unknown[] }> = [];

    // 1st call: CORRELATION_SQL
    responses.push({
      rows: [
        {
          entity_id: 'ent-1',
          entity_name: opts.entityName ?? 'Bitcoin',
          mentions: opts.mentions,
        },
      ],
    });

    // Subsequent calls: trust weights and urgencies interleaved
    // The code loops: for each distinct source -> getTrustWeight
    // Then for each unique summary_id -> getUrgency
    const distinctSources = [...new Set(opts.mentions.map((m) => m.source))];
    for (const src of distinctSources) {
      const tw = opts.trustWeights[src] ?? undefined;
      responses.push({
        rows: tw !== undefined ? [{ source: src, trust_weight: tw }] : [],
      });
    }

    const uniqueSummaryIds = [...new Set(opts.mentions.map((m) => m.summary_id))];
    for (const sid of uniqueSummaryIds) {
      const urg = opts.urgencies[sid] ?? undefined;
      responses.push({
        rows: urg !== undefined ? [{ urgency: urg }] : [],
      });
    }

    return mockPool(responses);
  }

  it('correlates entity from two different sources', async () => {
    const pool = buildPool({
      mentions: [
        { source: 'discord', summary_id: 'sum-1', sentiment: 0.5 },
        { source: 'twitter', summary_id: 'sum-2', sentiment: 0.7 },
      ],
      trustWeights: { discord: 0.8, twitter: 0.6 },
      urgencies: { 'sum-1': 'routine', 'sum-2': 'routine' },
    });

    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.correlated.length, 1);
    assert.strictEqual(result.correlated[0].entityName, 'Bitcoin');
    assert.strictEqual(result.correlated[0].sources.length, 2);
    assert.strictEqual(result.correlated[0].weightedSum, 1.4); // 0.8 + 0.6
    assert.strictEqual(result.correlated[0].urgency, 'routine');
  });

  it('deduplicates multiple mentions from the same source', async () => {
    const pool = buildPool({
      mentions: [
        { source: 'discord', summary_id: 'sum-1', sentiment: 0.5 },
        { source: 'discord', summary_id: 'sum-3', sentiment: 0.6 },
        { source: 'twitter', summary_id: 'sum-2', sentiment: 0.7 },
      ],
      trustWeights: { discord: 0.8, twitter: 0.6 },
      urgencies: { 'sum-1': 'routine', 'sum-3': 'routine', 'sum-2': 'routine' },
    });

    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    // Discord appears once in sources even though 2 mentions
    assert.strictEqual(result.correlated[0].sources.length, 2);
    // weightedSum only counts each source once
    assert.strictEqual(result.correlated[0].weightedSum, 1.4);
  });

  it('uses the first summary_id as representative sourceId for a source', async () => {
    const pool = buildPool({
      mentions: [
        { source: 'discord', summary_id: 'sum-1', sentiment: 0.5 },
        { source: 'discord', summary_id: 'sum-3', sentiment: 0.6 },
        { source: 'twitter', summary_id: 'sum-2', sentiment: 0.7 },
      ],
      trustWeights: { discord: 0.8, twitter: 0.6 },
      urgencies: { 'sum-1': 'routine', 'sum-3': 'routine', 'sum-2': 'routine' },
    });

    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    const discordSource = result.correlated[0].sources.find((s) => s.source === 'discord');
    assert.strictEqual(discordSource?.sourceId, 'sum-1');
  });

  it('defaults trust_weight to 0.5 when source is not found in DB', async () => {
    const responses: Array<{ rows?: unknown[] }> = [
      // CORRELATION_SQL
      {
        rows: [
          {
            entity_id: 'ent-1',
            entity_name: 'Bitcoin',
            mentions: [
              { source: 'discord', summary_id: 'sum-1', sentiment: 0.5 },
              { source: 'unknown-source', summary_id: 'sum-2', sentiment: 0.7 },
            ],
          },
        ],
      },
      // getTrustWeight for discord
      { rows: [{ source: 'discord', trust_weight: 0.8 }] },
      // getTrustWeight for unknown-source — empty
      { rows: [] },
      // getUrgency for sum-1
      { rows: [{ urgency: 'routine' }] },
      // getUrgency for sum-2
      { rows: [{ urgency: 'routine' }] },
    ];
    const pool = mockPool(responses);
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    const unknownSrc = result.correlated[0].sources.find((s) => s.source === 'unknown-source');
    assert.strictEqual(unknownSrc?.trustWeight, 0.5);
    assert.strictEqual(result.correlated[0].weightedSum, 1.3); // 0.8 + 0.5
  });

  it('defaults urgency to routine when summary not found', async () => {
    const responses: Array<{ rows?: unknown[] }> = [
      {
        rows: [
          {
            entity_id: 'ent-1',
            entity_name: 'Solana',
            mentions: [
              { source: 'discord', summary_id: 'sum-1', sentiment: 0.5 },
              { source: 'twitter', summary_id: 'sum-2', sentiment: 0.7 },
            ],
          },
        ],
      },
      { rows: [{ source: 'discord', trust_weight: 0.5 }] },
      { rows: [{ source: 'twitter', trust_weight: 0.5 }] },
      // getUrgency for sum-1 — not found
      { rows: [] },
      // getUrgency for sum-2 — not found
      { rows: [] },
    ];
    const pool = mockPool(responses);
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.correlated[0].urgency, 'routine');
  });
});

// ===========================================================================
// Urgency resolution — highestUrgency logic
// ===========================================================================

describe('createCorrelator.run() — urgency resolution', () => {
  function singleEntityPool(urgencies: Record<string, string>) {
    const summaryIds = Object.keys(urgencies);
    const mentions = summaryIds.map((sid, i) => ({
      source: i === 0 ? 'discord' : 'twitter',
      summary_id: sid,
      sentiment: 0.5,
    }));

    const responses: Array<{ rows?: unknown[] }> = [
      {
        rows: [
          { entity_id: 'ent-1', entity_name: 'ETH', mentions },
        ],
      },
    ];

    // trust weights for distinct sources
    const distinctSources = [...new Set(mentions.map((m) => m.source))];
    for (const src of distinctSources) {
      responses.push({ rows: [{ source: src, trust_weight: 0.5 }] });
    }

    // urgencies
    for (const sid of summaryIds) {
      responses.push({ rows: [{ urgency: urgencies[sid] }] });
    }

    return mockPool(responses);
  }

  it('picks breaking when one source is breaking and another is routine', async () => {
    const pool = singleEntityPool({ 'sum-1': 'routine', 'sum-2': 'breaking' });
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.correlated[0].urgency, 'breaking');
  });

  it('picks elevated when sources are elevated and routine', async () => {
    const pool = singleEntityPool({ 'sum-1': 'routine', 'sum-2': 'elevated' });
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.correlated[0].urgency, 'elevated');
  });

  it('stays routine when all sources are routine', async () => {
    const pool = singleEntityPool({ 'sum-1': 'routine', 'sum-2': 'routine' });
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.correlated[0].urgency, 'routine');
  });

  it('ignores unrecognized urgency levels and defaults to routine', async () => {
    const pool = singleEntityPool({ 'sum-1': 'catastrophic', 'sum-2': 'mild' });
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.correlated[0].urgency, 'routine');
  });
});

// ===========================================================================
// Flash trigger conditions
// ===========================================================================

describe('createCorrelator.run() — flash trigger', () => {
  function flashPool(weightedSum: number, urgency: string) {
    // We need 2 sources to make the weighted sum work
    // Split the weightedSum between two sources
    const w1 = weightedSum / 2;
    const w2 = weightedSum - w1;

    const responses: Array<{ rows?: unknown[] }> = [
      {
        rows: [
          {
            entity_id: 'ent-1',
            entity_name: 'Flash Entity',
            mentions: [
              { source: 'discord', summary_id: 'sum-1', sentiment: 0.8 },
              { source: 'twitter', summary_id: 'sum-2', sentiment: 0.9 },
            ],
          },
        ],
      },
      // trust weights
      { rows: [{ source: 'discord', trust_weight: w1 }] },
      { rows: [{ source: 'twitter', trust_weight: w2 }] },
      // urgencies
      { rows: [{ urgency }] },
      { rows: [{ urgency }] },
    ];
    return mockPool(responses);
  }

  it('triggers flash when weightedSum >= 1.5 and urgency is breaking', async () => {
    const pool = flashPool(1.6, 'breaking');
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.shouldFlash, true);
  });

  it('triggers flash when weightedSum >= 1.5 and urgency is elevated', async () => {
    const pool = flashPool(1.5, 'elevated');
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.shouldFlash, true);
  });

  it('does NOT trigger flash when urgency is routine even with high weightedSum', async () => {
    const pool = flashPool(2.0, 'routine');
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.shouldFlash, false);
  });

  it('does NOT trigger flash when weightedSum < 1.5 even with breaking urgency', async () => {
    const pool = flashPool(1.4, 'breaking');
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.shouldFlash, false);
  });

  it('triggers flash at exact boundary: weightedSum=1.5, urgency=breaking', async () => {
    const pool = flashPool(1.5, 'breaking');
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.shouldFlash, true);
  });
});

// ===========================================================================
// Multiple entities
// ===========================================================================

describe('createCorrelator.run() — multiple entities', () => {
  it('processes multiple correlated entities independently', async () => {
    const responses: Array<{ rows?: unknown[] }> = [
      {
        rows: [
          {
            entity_id: 'ent-1',
            entity_name: 'Bitcoin',
            mentions: [
              { source: 'discord', summary_id: 'sum-1', sentiment: 0.5 },
              { source: 'twitter', summary_id: 'sum-2', sentiment: 0.7 },
            ],
          },
          {
            entity_id: 'ent-2',
            entity_name: 'Ethereum',
            mentions: [
              { source: 'rss', summary_id: 'sum-3', sentiment: 0.3 },
              { source: 'news', summary_id: 'sum-4', sentiment: 0.6 },
            ],
          },
        ],
      },
      // Trust weights: discord, twitter (for Bitcoin), rss, news (for Ethereum)
      { rows: [{ source: 'discord', trust_weight: 0.9 }] },
      { rows: [{ source: 'twitter', trust_weight: 0.7 }] },
      // Urgencies for Bitcoin: sum-1, sum-2
      { rows: [{ urgency: 'routine' }] },
      { rows: [{ urgency: 'routine' }] },
      // Trust weights for Ethereum
      { rows: [{ source: 'rss', trust_weight: 0.6 }] },
      { rows: [{ source: 'news', trust_weight: 0.8 }] },
      // Urgencies for Ethereum: sum-3, sum-4
      { rows: [{ urgency: 'elevated' }] },
      { rows: [{ urgency: 'elevated' }] },
    ];

    const pool = mockPool(responses);
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.correlated.length, 2);
    assert.strictEqual(result.correlated[0].entityName, 'Bitcoin');
    assert.strictEqual(result.correlated[1].entityName, 'Ethereum');
    assert.strictEqual(result.correlated[0].weightedSum, 1.6); // 0.9 + 0.7
    assert.strictEqual(result.correlated[1].weightedSum, 1.4); // 0.6 + 0.8
  });

  it('shouldFlash is true if ANY entity triggers flash', async () => {
    const responses: Array<{ rows?: unknown[] }> = [
      {
        rows: [
          {
            entity_id: 'ent-1',
            entity_name: 'Bitcoin',
            mentions: [
              { source: 'discord', summary_id: 'sum-1', sentiment: 0.5 },
              { source: 'twitter', summary_id: 'sum-2', sentiment: 0.7 },
            ],
          },
          {
            entity_id: 'ent-2',
            entity_name: 'Ethereum',
            mentions: [
              { source: 'rss', summary_id: 'sum-3', sentiment: 0.3 },
              { source: 'news', summary_id: 'sum-4', sentiment: 0.6 },
            ],
          },
        ],
      },
      // Bitcoin: low trust, routine — no flash
      { rows: [{ source: 'discord', trust_weight: 0.3 }] },
      { rows: [{ source: 'twitter', trust_weight: 0.3 }] },
      { rows: [{ urgency: 'routine' }] },
      { rows: [{ urgency: 'routine' }] },
      // Ethereum: high trust, breaking — triggers flash
      { rows: [{ source: 'rss', trust_weight: 0.8 }] },
      { rows: [{ source: 'news', trust_weight: 0.9 }] },
      { rows: [{ urgency: 'breaking' }] },
      { rows: [{ urgency: 'breaking' }] },
    ];

    const pool = mockPool(responses);
    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.shouldFlash, true);
  });
});
