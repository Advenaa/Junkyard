import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedPipeline } from '../../src/embed-pipeline.js';
import type { Pool } from '../../src/db/connection.js';
import type { Logger } from '../../src/logger.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type EmbedderResult = { vector: Float32Array; dimensions: number; model: string };

function makePool(rows: Record<string, unknown>[] = []): Pool {
  return {
    query: async () => ({ rows }),
  } as unknown as Pool;
}

function makeLogger(): Logger & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const name = String(prop);
        if (name === 'calls') return calls;
        if (!calls[name]) calls[name] = [];
        return (...args: unknown[]) => {
          calls[name]!.push(args);
        };
      },
    },
  ) as Logger & { calls: Record<string, unknown[][]> };
}

function makeEmbedder(
  overrides: Partial<{
    isAvailable: () => boolean;
    embedBatch: (texts: string[]) => Promise<EmbedderResult[]>;
    prepareText: (text: string, type: string) => string;
    vectorToBytes: (v: Float32Array) => Buffer;
  }> = {},
) {
  return {
    isAvailable: () => true,
    embedBatch: async (texts: string[]) =>
      texts.map(() => ({
        vector: new Float32Array([1, 2, 3]),
        dimensions: 3,
        model: 'test-model',
      })),
    prepareText: (text: string) => text,
    vectorToBytes: () => Buffer.from([0]),
    ...overrides,
  };
}

function makeCache(): { update: () => void } {
  return { update: () => {} };
}

// ---------------------------------------------------------------------------
// P-003: overlap guard — concurrent run calls
// ---------------------------------------------------------------------------

describe('embed-pipeline overlap guard', () => {
  it('concurrent run(): second call returns 0 immediately', async () => {
    // Create a pool that returns one summary row so the first run does real work
    let queryCount = 0;
    const slowPool = {
      query: async (sql: string) => {
        queryCount++;
        // Slow down the INSERT query so the first run is still in-flight
        if (typeof sql === 'string' && sql.includes('INSERT')) {
          await new Promise((r) => setTimeout(r, 50));
        }
        // Return one summary row for the first fetchUnembedded call, empty for report
        if (typeof sql === 'string' && sql.includes('summaries')) {
          return { rows: [{ id: 'sum-1', text: 'test summary' }] };
        }
        return { rows: [] };
      },
    } as unknown as Pool;

    const pipeline = createEmbedPipeline(slowPool, makeLogger(), makeEmbedder(), makeCache());

    const [first, second] = await Promise.all([pipeline.run(), pipeline.run()]);

    // One of them should have done real work (returned >= 1), the other should be 0
    // The second call hits the guard and returns 0
    assert.strictEqual(second, 0, 'second concurrent run should return 0');
    assert.ok(first >= 0, 'first run should return a count');
  });

  it('sequential run(): both calls execute', async () => {
    let runCount = 0;
    const pool = {
      query: async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('summaries')) {
          runCount++;
          return { rows: [{ id: `sum-${runCount}`, text: 'test' }] };
        }
        if (typeof sql === 'string' && sql.includes('INSERT')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    } as unknown as Pool;

    const pipeline = createEmbedPipeline(pool, makeLogger(), makeEmbedder(), makeCache());

    const first = await pipeline.run();
    const second = await pipeline.run();

    // Both should have executed (not blocked by overlap guard)
    assert.ok(first >= 1, 'first sequential run should embed');
    assert.ok(second >= 1, 'second sequential run should embed');
  });

  it('running flag resets on error — next run executes', async () => {
    let callCount = 0;
    const embedder = makeEmbedder({
      embedBatch: async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('simulated embedder failure');
        }
        return [{ vector: new Float32Array([1, 2, 3]), dimensions: 3, model: 'test' }];
      },
    });

    const pool = {
      query: async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('summaries')) {
          return { rows: [{ id: 'sum-1', text: 'test' }] };
        }
        if (typeof sql === 'string' && sql.includes('INSERT')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    } as unknown as Pool;

    const pipeline = createEmbedPipeline(pool, makeLogger(), embedder, makeCache());

    // First run — embedBatch throws, but run() catches via try/finally
    // The error propagates out of run() since there's no internal catch
    await assert.rejects(pipeline.run(), /simulated embedder failure/);

    // Second run should NOT be blocked by the guard (running reset in finally)
    const second = await pipeline.run();
    assert.ok(second >= 1, 'run after error should execute normally');
  });

  it('returns 0 when embedder is not available', async () => {
    const embedder = makeEmbedder({ isAvailable: () => false });
    const pipeline = createEmbedPipeline(makePool(), makeLogger(), embedder, makeCache());

    const result = await pipeline.run();
    assert.strictEqual(result, 0);
  });

  it('returns 0 when nothing to embed', async () => {
    const pipeline = createEmbedPipeline(makePool(), makeLogger(), makeEmbedder(), makeCache());

    const result = await pipeline.run();
    assert.strictEqual(result, 0);
  });
});
