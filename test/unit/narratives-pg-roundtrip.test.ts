import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import type { Config } from '../../src/config.js';
import type { Pool } from '../../src/db/connection.js';
import type { Logger } from '../../src/logger.js';
import { createNarrativeDetector, decrementDate, midnightEpoch } from '../../src/process/narratives.js';

function vectorToBuffer(values: number[]): Buffer {
  const f32 = new Float32Array(values);
  return Buffer.from(f32.buffer);
}

const noopLog = {
  info() {},
  debug() {},
  warn() {},
  error() {},
  child() {
    return noopLog;
  },
} as unknown as Logger;

const defaultConfig = {
  models: { normalizer: 'test-haiku', chunk: 'test-haiku', thinkalot: 'test-sonnet' },
} as unknown as Config;

const enabledEmbedder = { isAvailable: () => true };

function buildSeparatedClusterVectors(): number[][] {
  return [
    [0.625, 0, 0, 0],
    [0.75, 0, 0, 0],
    [0.875, 0, 0, 0],
    [0, 0.625, 0, 0],
    [0, 0.75, 0, 0],
    [0, 0.875, 0, 0],
    [0, 0, 0.625, 0],
    [0, 0, 0.75, 0],
    [0, 0, 0.875, 0],
  ];
}

describe('createNarrativeDetector pg-backed round trip', () => {
  it('writes and reads back summary_ids as a populated text[] array', async () => {
    const db = newDb();
    db.public.none(`
      CREATE TABLE app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE summaries (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        sentiment REAL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE embeddings (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        vector BYTEA NOT NULL,
        dimensions INTEGER NOT NULL
      );

      CREATE TABLE narratives (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        date DATE NOT NULL,
        member_count INTEGER NOT NULL,
        avg_sentiment REAL,
        signal_strength TEXT NOT NULL,
        summary_ids TEXT[] NOT NULL,
        created_at BIGINT NOT NULL
      );
    `);

    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    try {
      await pool.query(`INSERT INTO app_config (key, value) VALUES ('timezone', 'Asia/Jakarta')`);

      const timezone = 'Asia/Jakarta';
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
      const yesterdayStr = decrementDate(todayStr);
      const baseCreatedAt = midnightEpoch(yesterdayStr, timezone) + 1_000;

      const vectors = buildSeparatedClusterVectors();
      for (let i = 0; i < vectors.length; i++) {
        const summaryId = `sum-${i}`;
        await pool.query(`INSERT INTO summaries (id, body, sentiment, created_at) VALUES ($1, $2, $3, $4)`, [
          summaryId,
          `Summary ${i} for cluster ${Math.floor(i / 3)}`,
          i % 2 === 0 ? 0.7 : -0.1,
          baseCreatedAt + i,
        ]);
        await pool.query(
          `INSERT INTO embeddings (id, target_type, target_id, vector, dimensions) VALUES ($1, $2, $3, $4, $5)`,
          [`emb-${i}`, 'summary', summaryId, vectorToBuffer(vectors[i]), vectors[i].length],
        );
      }

      let callCount = 0;
      const llm = {
        async call() {
          callCount++;
          return { content: `Narrative ${callCount}` };
        },
      };

      const detector = createNarrativeDetector(pool as unknown as Pool, noopLog, defaultConfig, llm, enabledEmbedder);
      const detected = await detector.detectNarratives();

      assert.ok(detected.length > 0, 'Expected at least one detected narrative');

      const { rows } = await pool.query<{ id: string; summary_ids: string[] }>(
        `SELECT id, summary_ids FROM narratives ORDER BY id`,
      );

      assert.equal(rows.length, detected.length, 'Inserted narrative row count should match detector output');

      const insertedSummarySets = new Set(rows.map((row) => row.summary_ids.slice().sort().join(',')));
      for (const row of rows) {
        assert.ok(Array.isArray(row.summary_ids), 'summary_ids should round-trip as a JS array');
        assert.ok(row.summary_ids.length >= 3, 'each stored narrative should keep its clustered summary IDs');
        for (const summaryId of row.summary_ids) {
          assert.match(summaryId, /^sum-\d+$/, 'stored summary IDs should round-trip as text[] elements');
        }
      }

      for (const narrative of detected) {
        const expectedSet = narrative.summaryIds.slice().sort().join(',');
        assert.ok(insertedSummarySets.has(expectedSet), 'stored summary_ids should match detector output');
      }
    } finally {
      await pool.end();
    }
  });
});
