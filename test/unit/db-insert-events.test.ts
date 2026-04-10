import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';
import { insertEvents, type EventRow } from '../../src/db/queries.js';

type InsertEventInput = {
  id: string;
  entityId: string | null;
  entityName: string;
  eventType: EventRow['event_type'];
  description: string;
  eventTime: number;
  source: string;
  sourceId: string;
  summaryId: string;
  chainId?: string | null;
  createdAt: number;
};

function makeEvent(index: number): InsertEventInput {
  return {
    id: `evt-${index}`,
    entityId: `ent-${index}`,
    entityName: `Entity ${index}`,
    eventType: 'exploit',
    description: `Event ${index} description`,
    eventTime: 1_700_000_000_000 + index,
    source: 'discord',
    sourceId: 'alerts',
    summaryId: 'summary-1',
    chainId: index === 0 ? null : 'evt-0',
    createdAt: 1_700_000_100_000 + index,
  };
}

function makeRecordingPool() {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      return { rows: [], rowCount: 1 };
    },
  };
}

function makeDelayedPool(delayMs: number) {
  return {
    calls: 0,
    query: async () => {
      await delay(delayMs);
      return { rows: [], rowCount: 1 };
    },
  };
}

async function insertEventsBaseline(
  pool: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  events: InsertEventInput[],
) {
  for (const event of events) {
    await pool.query(
      `INSERT INTO events (
        id, entity_id, entity_name, event_type, description, event_time,
        source, source_id, summary_id, chain_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        event.entityId,
        event.entityName,
        event.eventType,
        event.description,
        event.eventTime,
        event.source,
        event.sourceId,
        event.summaryId,
        event.chainId ?? null,
        event.createdAt,
      ],
    );
  }
}

describe('insertEvents', () => {
  it('uses one parameterized multi-row insert for multiple events', async () => {
    const pool = makeRecordingPool();
    const events = [makeEvent(0), makeEvent(1), makeEvent(2)];

    await insertEvents(pool as never, events);

    assert.equal(pool.calls.length, 1);
    assert.match(
      pool.calls[0]!.text,
      /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11\), \(\$12, \$13, \$14, \$15, \$16, \$17, \$18, \$19, \$20, \$21, \$22\), \(\$23, \$24, \$25, \$26, \$27, \$28, \$29, \$30, \$31, \$32, \$33\)/,
    );
    assert.equal(pool.calls[0]!.values.length, 33);
    assert.equal(pool.calls[0]!.values[0], 'evt-0');
    assert.equal(pool.calls[0]!.values[10], 1_700_000_100_000);
    assert.equal(pool.calls[0]!.values[11], 'evt-1');
    assert.equal(pool.calls[0]!.values[20], 'evt-0');
  });

  it('skips the query when there are no events', async () => {
    const pool = makeRecordingPool();

    await insertEvents(pool as never, []);

    assert.equal(pool.calls.length, 0);
  });

  it('benchmarks at least a 10x speedup for 1000 events versus the old loop', async () => {
    const events = Array.from({ length: 1000 }, (_, index) => makeEvent(index));
    const baselinePool = makeDelayedPool(1);
    const batchedPool = makeDelayedPool(1);

    const baselineStart = performance.now();
    await insertEventsBaseline(baselinePool, events);
    const baselineDuration = performance.now() - baselineStart;

    const batchedStart = performance.now();
    await insertEvents(batchedPool as never, events);
    const batchedDuration = performance.now() - batchedStart;

    assert.ok(
      baselineDuration / batchedDuration >= 10,
      `Expected >=10x speedup for 1000 events, got ${(baselineDuration / batchedDuration).toFixed(2)}x (${baselineDuration.toFixed(1)}ms vs ${batchedDuration.toFixed(1)}ms)`,
    );
  });
});
