import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatDate, parseDateFromFilename } from '../../src/ops/backup.js';
import { createRetention } from '../../src/ops/retention.js';
import type { RetentionResult } from '../../src/ops/retention.js';

// ---------------------------------------------------------------------------
// Backup helpers
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('formats a date as YYYYMMDD in UTC', () => {
    const date = new Date(Date.UTC(2024, 0, 15)); // Jan 15 2024
    assert.equal(formatDate(date), '20240115');
  });

  it('zero-pads single-digit month and day', () => {
    const date = new Date(Date.UTC(2024, 2, 3)); // Mar 3 2024
    assert.equal(formatDate(date), '20240303');
  });

  it('handles end of year', () => {
    const date = new Date(Date.UTC(2024, 11, 31)); // Dec 31 2024
    assert.equal(formatDate(date), '20241231');
  });

  it('handles start of year', () => {
    const date = new Date(Date.UTC(2025, 0, 1)); // Jan 1 2025
    assert.equal(formatDate(date), '20250101');
  });

  it('handles double-digit months', () => {
    const date = new Date(Date.UTC(2024, 10, 25)); // Nov 25 2024
    assert.equal(formatDate(date), '20241125');
  });
});

describe('parseDateFromFilename', () => {
  it('parses a valid backup filename', () => {
    const result = parseDateFromFilename('podders_20240115.sql.gz');
    assert.ok(result);
    assert.equal(result.getUTCFullYear(), 2024);
    assert.equal(result.getUTCMonth(), 0); // January
    assert.equal(result.getUTCDate(), 15);
  });

  it('parses December 31st correctly', () => {
    const result = parseDateFromFilename('podders_20241231.sql.gz');
    assert.ok(result);
    assert.equal(result.getUTCFullYear(), 2024);
    assert.equal(result.getUTCMonth(), 11); // December
    assert.equal(result.getUTCDate(), 31);
  });

  it('returns null for non-matching filename', () => {
    assert.equal(parseDateFromFilename('backup_20240115.sql.gz'), null);
  });

  it('returns null for missing .sql.gz extension', () => {
    assert.equal(parseDateFromFilename('podders_20240115.tar.gz'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseDateFromFilename(''), null);
  });

  it('returns null for wrong date length', () => {
    assert.equal(parseDateFromFilename('podders_2024011.sql.gz'), null);
  });

  it('returns null for filename with path prefix', () => {
    assert.equal(parseDateFromFilename('/data/podders_20240115.sql.gz'), null);
  });
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

function createMockPool(rowCounts: number[]) {
  let callIndex = 0;
  const calls: Array<{ text: string; params?: unknown[] }> = [];

  const pool = {
    query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      const rowCount = rowCounts[callIndex] ?? 0;
      callIndex++;
      return Promise.resolve({ rowCount, rows: [] });
    },
  };

  return { pool, calls };
}

function createMockLogger() {
  return {
    info: mock.fn(),
    error: mock.fn(),
    warn: mock.fn(),
    debug: mock.fn(),
    fatal: mock.fn(),
    child: mock.fn(),
  };
}

describe('retention run()', () => {
  it('deletes old items, mentions, summaries, sentiment daily, orphaned embeddings, and expired sessions', async () => {
    // Order: items, summaries, mentions, sentimentDaily, emb(item,r1), emb(item,r2=0), emb(summary,r1), emb(summary,r2=0), sessions
    const rowCounts = [10, 5, 3, 7, 2, 0, 1, 0, 4];
    const { pool, calls } = createMockPool(rowCounts);
    const log = createMockLogger();

    const retention = createRetention(pool as any, log as any);
    const result = await retention.run();

    // items(1) + summaries(1) + mentions(1) + sentimentDaily(1) + emb_items(2) + emb_summaries(2) + sessions(1) = 9
    assert.equal(calls.length, 9);

    // Verify query order
    assert.ok(calls[0].text.includes('DELETE FROM items'));
    assert.ok(calls[0].text.includes("status = 'processed'"));
    assert.ok(calls[1].text.includes('DELETE FROM summaries'));
    assert.ok(calls[2].text.includes('DELETE FROM entity_mentions'));
    assert.ok(calls[3].text.includes('DELETE FROM entity_sentiment_daily'));

    // RT-002: embeddings delete in batched loop (LIMIT 1000)
    assert.ok(calls[4].text.includes('DELETE FROM embeddings'));
    assert.ok(calls[4].text.includes('LIMIT 1000'));
  });

  it('uses NOT EXISTS (not NOT IN) for orphaned embeddings', async () => {
    const rowCounts = [0, 0, 0, 0, 0, 0];
    const { pool, calls } = createMockPool(rowCounts);
    const log = createMockLogger();

    const retention = createRetention(pool as any, log as any);
    await retention.run();

    // Embedding queries start at index 4 (after items, summaries, mentions, sentimentDaily)
    const embItemsQuery = calls[4].text;
    const embSummariesQuery = calls[5].text;

    assert.ok(embItemsQuery.includes('NOT EXISTS'), 'item embeddings query should use NOT EXISTS');
    assert.ok(!embItemsQuery.includes('NOT IN'), 'item embeddings query should not use NOT IN');
    assert.ok(embItemsQuery.includes('LIMIT 1000'), 'item embeddings query should batch with LIMIT');

    assert.ok(embSummariesQuery.includes('NOT EXISTS'), 'summary embeddings query should use NOT EXISTS');
    assert.ok(!embSummariesQuery.includes('NOT IN'), 'summary embeddings query should not use NOT IN');
  });

  it('returns correct counts from rowCount values', async () => {
    // Order: items, summaries, mentions, sentimentDaily, emb(item,r1), emb(item,r2=0), emb(summary,r1), emb(summary,r2=0), sessions
    const rowCounts = [10, 3, 5, 7, 2, 0, 1, 0, 4];
    const { pool } = createMockPool(rowCounts);
    const log = createMockLogger();

    const retention = createRetention(pool as any, log as any);
    const result = await retention.run();

    const expected: RetentionResult = {
      itemsDeleted: 10,
      summariesDeleted: 3,
      mentionsDeleted: 5,
      sentimentDailyDeleted: 7,
      embeddingsDeleted: 3, // 2 + 1
      sessionsDeleted: 4,
    };

    assert.deepStrictEqual(result, expected);
  });

  it('returns zeros when nothing is deleted', async () => {
    const rowCounts = [0, 0, 0, 0, 0, 0];
    const { pool } = createMockPool(rowCounts);
    const log = createMockLogger();

    const retention = createRetention(pool as any, log as any);
    const result = await retention.run();

    assert.equal(result.itemsDeleted, 0);
    assert.equal(result.summariesDeleted, 0);
    assert.equal(result.mentionsDeleted, 0);
    assert.equal(result.sentimentDailyDeleted, 0);
    assert.equal(result.embeddingsDeleted, 0);
    assert.equal(result.sessionsDeleted, 0);
  });

  it('deletes expired sessions using current time', async () => {
    // items, summaries, mentions, sentimentDaily, emb(item,r1=0), emb(summary,r1=0), sessions
    const rowCounts = [0, 0, 0, 0, 0, 0, 7];
    const { pool, calls } = createMockPool(rowCounts);
    const log = createMockLogger();

    const before = Date.now();
    const retention = createRetention(pool as any, log as any);
    await retention.run();
    const after = Date.now();

    // Sessions query is the last one
    const sessionsQuery = calls[calls.length - 1];
    assert.ok(sessionsQuery.text.includes('DELETE FROM sessions'));
    assert.ok(sessionsQuery.text.includes('expires_at'));

    // The timestamp param should be approximately now
    const ts = sessionsQuery.params![0] as number;
    assert.ok(ts >= before, 'sessions timestamp should be >= test start time');
    assert.ok(ts <= after, 'sessions timestamp should be <= test end time');
  });

  it('uses 30-day cutoff for items and 90-day cutoff for mentions/summaries', async () => {
    const rowCounts = [0, 0, 0, 0, 0, 0];
    const { pool, calls } = createMockPool(rowCounts);
    const log = createMockLogger();

    const before = Date.now();
    const retention = createRetention(pool as any, log as any);
    await retention.run();

    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;

    // Items use 30-day cutoff
    const itemsTs = calls[0].params![0] as number;
    assert.ok(
      Math.abs(itemsTs - (before - thirtyDays)) < 100,
      'items cutoff should be ~30 days ago',
    );

    // Mentions use 90-day cutoff
    const mentionsTs = calls[1].params![0] as number;
    assert.ok(
      Math.abs(mentionsTs - (before - ninetyDays)) < 100,
      'mentions cutoff should be ~90 days ago',
    );

    // Summaries use 90-day cutoff
    const summariesTs = calls[2].params![0] as number;
    assert.ok(
      Math.abs(summariesTs - (before - ninetyDays)) < 100,
      'summaries cutoff should be ~90 days ago',
    );
  });
});

// ---------------------------------------------------------------------------
// BK-001: Structural regression — backup minimum size check
// ---------------------------------------------------------------------------

describe('BK-001: backup minimum size check (structural)', () => {
  const src = readFileSync(
    new URL('../../src/ops/backup.ts', import.meta.url),
    'utf-8',
  );

  it('imports stat from node:fs/promises', () => {
    assert.ok(
      src.includes("stat") && src.includes("node:fs/promises"),
      'backup.ts must import stat from node:fs/promises',
    );
  });

  it('calls stat() after rename()', () => {
    const renameIdx = src.indexOf('rename(tmpPath, filePath)');
    const statIdx = src.indexOf('stat(filePath)');
    assert.ok(renameIdx > -1, 'rename(tmpPath, filePath) must be present');
    assert.ok(statIdx > -1, 'stat(filePath) must be present');
    assert.ok(
      statIdx > renameIdx,
      'stat() must appear after rename() — check file after finalization',
    );
  });

  it('checks file size against 1024 byte threshold', () => {
    assert.ok(
      src.includes('< 1024'),
      'backup.ts must check fileInfo.size < 1024',
    );
  });

  it('deletes undersized backup files', () => {
    // After the size check, unlink must be called to remove the bad file
    const sizeCheckIdx = src.indexOf('< 1024');
    const unlinkAfterCheck = src.indexOf('unlink(filePath)', sizeCheckIdx);
    assert.ok(
      unlinkAfterCheck > sizeCheckIdx,
      'unlink(filePath) must appear after the < 1024 size check',
    );
  });

  it('throws an error for suspiciously small backups', () => {
    assert.ok(
      src.includes('suspiciously small'),
      'backup.ts must throw an error mentioning "suspiciously small"',
    );
  });
});
