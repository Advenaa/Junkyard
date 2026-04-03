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
// Helper: build pool for batch query pattern
// Query order: 1) CORRELATION_SQL, 2) batch trust weights, 3) batch urgencies
// ===========================================================================

function buildBatchPool(opts: {
  correlationRows: Array<{
    entity_id: string;
    entity_name: string;
    mentions: Array<{ source: string; summary_id: string; sentiment: number }>;
  }>;
  trustWeights: Record<string, number>;
  urgencies: Record<string, string>;
}) {
  // All distinct sources across all entities
  const allSources = [...new Set(opts.correlationRows.flatMap(r => r.mentions.map(m => m.source)))];
  const trustRows = allSources
    .filter(s => s in opts.trustWeights)
    .map(s => ({ source: s, trust_weight: opts.trustWeights[s] }));

  // All distinct summary IDs across all entities
  const allSummaryIds = [...new Set(opts.correlationRows.flatMap(r => r.mentions.map(m => m.summary_id)))];
  const urgencyRows = allSummaryIds
    .filter(id => id in opts.urgencies)
    .map(id => ({ id, urgency: opts.urgencies[id] }));

  return mockPool([
    { rows: opts.correlationRows },  // CORRELATION_SQL
    { rows: trustRows },              // batch trust weights
    { rows: urgencyRows },            // batch urgencies
  ]);
}

// ===========================================================================
// createCorrelator — single entity, two sources
// ===========================================================================

describe('createCorrelator.run() — single entity, two sources', () => {
  it('correlates entity from two different sources', async () => {
    const pool = buildBatchPool({
      correlationRows: [{
        entity_id: 'ent-1',
        entity_name: 'Bitcoin',
        mentions: [
          { source: 'discord', summary_id: 'sum-1', sentiment: 0.5 },
          { source: 'twitter', summary_id: 'sum-2', sentiment: 0.7 },
        ],
      }],
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
    const pool = buildBatchPool({
      correlationRows: [{
        entity_id: 'ent-1',
        entity_name: 'Bitcoin',
        mentions: [
          { source: 'discord', summary_id: 'sum-1', sentiment: 0.5 },
          { source: 'discord', summary_id: 'sum-3', sentiment: 0.6 },
          { source: 'twitter', summary_id: 'sum-2', sentiment: 0.7 },
        ],
      }],
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
    const pool = buildBatchPool({
      correlationRows: [{
        entity_id: 'ent-1',
        entity_name: 'Bitcoin',
        mentions: [
          { source: 'discord', summary_id: 'sum-1', sentiment: 0.5 },
          { source: 'discord', summary_id: 'sum-3', sentiment: 0.6 },
          { source: 'twitter', summary_id: 'sum-2', sentiment: 0.7 },
        ],
      }],
      trustWeights: { discord: 0.8, twitter: 0.6 },
      urgencies: { 'sum-1': 'routine', 'sum-3': 'routine', 'sum-2': 'routine' },
    });

    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    const discordSource = result.correlated[0].sources.find((s) => s.source === 'discord');
    assert.strictEqual(discordSource?.sourceId, 'sum-1');
  });

  it('defaults trust_weight to 0.5 when source is not found in DB', async () => {
    const pool = buildBatchPool({
      correlationRows: [{
        entity_id: 'ent-1',
        entity_name: 'Bitcoin',
        mentions: [
          { source: 'discord', summary_id: 'sum-1', sentiment: 0.5 },
          { source: 'unknown-source', summary_id: 'sum-2', sentiment: 0.7 },
        ],
      }],
      trustWeights: { discord: 0.8 }, // unknown-source not in DB
      urgencies: { 'sum-1': 'routine', 'sum-2': 'routine' },
    });

    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    const unknownSrc = result.correlated[0].sources.find((s) => s.source === 'unknown-source');
    assert.strictEqual(unknownSrc?.trustWeight, 0.5);
    assert.strictEqual(result.correlated[0].weightedSum, 1.3); // 0.8 + 0.5
  });

  it('defaults urgency to routine when summary not found', async () => {
    const pool = buildBatchPool({
      correlationRows: [{
        entity_id: 'ent-1',
        entity_name: 'Solana',
        mentions: [
          { source: 'discord', summary_id: 'sum-1', sentiment: 0.5 },
          { source: 'twitter', summary_id: 'sum-2', sentiment: 0.7 },
        ],
      }],
      trustWeights: { discord: 0.5, twitter: 0.5 },
      urgencies: {}, // no urgencies in DB
    });

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

    return buildBatchPool({
      correlationRows: [{
        entity_id: 'ent-1',
        entity_name: 'ETH',
        mentions,
      }],
      trustWeights: { discord: 0.5, twitter: 0.5 },
      urgencies,
    });
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
    const w1 = weightedSum / 2;
    const w2 = weightedSum - w1;

    return buildBatchPool({
      correlationRows: [{
        entity_id: 'ent-1',
        entity_name: 'Flash Entity',
        mentions: [
          { source: 'discord', summary_id: 'sum-1', sentiment: 0.8 },
          { source: 'twitter', summary_id: 'sum-2', sentiment: 0.9 },
        ],
      }],
      trustWeights: { discord: w1, twitter: w2 },
      urgencies: { 'sum-1': urgency, 'sum-2': urgency },
    });
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
    const pool = buildBatchPool({
      correlationRows: [
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
      trustWeights: { discord: 0.9, twitter: 0.7, rss: 0.6, news: 0.8 },
      urgencies: { 'sum-1': 'routine', 'sum-2': 'routine', 'sum-3': 'elevated', 'sum-4': 'elevated' },
    });

    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.correlated.length, 2);
    assert.strictEqual(result.correlated[0].entityName, 'Bitcoin');
    assert.strictEqual(result.correlated[1].entityName, 'Ethereum');
    assert.strictEqual(result.correlated[0].weightedSum, 1.6); // 0.9 + 0.7
    assert.strictEqual(result.correlated[1].weightedSum, 1.4); // 0.6 + 0.8
  });

  it('shouldFlash is true if ANY entity triggers flash', async () => {
    const pool = buildBatchPool({
      correlationRows: [
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
      trustWeights: { discord: 0.3, twitter: 0.3, rss: 0.8, news: 0.9 },
      urgencies: { 'sum-1': 'routine', 'sum-2': 'routine', 'sum-3': 'breaking', 'sum-4': 'breaking' },
    });

    const correlator = createCorrelator(pool as never, silentLog);
    const result = await correlator.run();

    assert.strictEqual(result.shouldFlash, true);
  });
});
