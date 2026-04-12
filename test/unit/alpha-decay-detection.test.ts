/**
 * Regression coverage for the alpha propagation dedup path.
 *
 * Verifies:
 * - Alpha tracker wiring is still present
 * - Migration/query source now enforce DB-level same-day dedup
 * - Tracker and insert helper rely on insert rowCount instead of a pre-check
 * - Concurrent same-day tracking only inserts one row per (entity, tier, day)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { insertAlphaPropagation } from '../../src/db/queries.js';
import { createAlphaTracker } from '../../src/knowledge/alpha-tracker.js';
import { readQueriesSource } from './helpers/queries-source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

function firstMentionDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function sourceKey(source: string, sourceId: string): string {
  return `${source}|${sourceId}`;
}

type QueryRow = Record<string, unknown>;

class MockAlphaPool {
  readonly queries: string[] = [];
  readonly rows: QueryRow[] = [];
  private readonly sourceTiers = new Map<string, string>();

  constructor(sourceTiers: Record<string, string> = {}) {
    for (const [key, tier] of Object.entries(sourceTiers)) {
      this.sourceTiers.set(key, tier);
    }
  }

  async query(sql: string, params: unknown[] = []): Promise<{ rows: QueryRow[]; rowCount: number }> {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    this.queries.push(normalizedSql);

    if (normalizedSql.startsWith('SELECT tier FROM sources')) {
      const source = params[0];
      const sourceId = params[1];
      if (typeof source !== 'string' || typeof sourceId !== 'string') {
        throw new Error('Expected string source/sourceId params');
      }

      const tier = this.sourceTiers.get(sourceKey(source, sourceId));
      return tier == null ? { rows: [], rowCount: 0 } : { rows: [{ tier }], rowCount: 1 };
    }

    if (normalizedSql.startsWith('INSERT INTO alpha_propagation')) {
      const id = params[0];
      const entityId = params[1];
      const eventId = params[2] ?? null;
      const tier = params[3];
      const source = params[4];
      const sourceId = params[5];
      const mentionTime = params[6];
      const itemId = params[7] ?? null;
      const createdAt = params[8];

      if (
        typeof id !== 'string' ||
        typeof entityId !== 'string' ||
        typeof tier !== 'string' ||
        typeof source !== 'string' ||
        typeof sourceId !== 'string' ||
        typeof mentionTime !== 'number' ||
        typeof createdAt !== 'number'
      ) {
        throw new Error('Unexpected alpha propagation insert params');
      }

      await Promise.resolve();

      const mentionDay = firstMentionDay(mentionTime);
      const exists = this.rows.some(
        (row) => row.entity_id === entityId && row.tier === tier && row.first_mention_day === mentionDay,
      );
      if (exists) {
        return { rows: [], rowCount: 0 };
      }

      const row = {
        id,
        entity_id: entityId,
        event_id: eventId,
        tier,
        source,
        source_id: sourceId,
        first_mention_time: mentionTime,
        first_mention_day: mentionDay,
        item_id: itemId,
        created_at: createdAt,
      };
      this.rows.push(row);
      return { rows: [row], rowCount: 1 };
    }

    throw new Error(`Unexpected query: ${normalizedSql}`);
  }
}

const noopLog = {
  info() {},
  debug() {},
  warn() {},
  error() {},
  child() {
    return noopLog;
  },
} as never;

// ═══════════════════════════════════════════════════════════════════════
// 1. Alpha tracker module shape
// ═══════════════════════════════════════════════════════════════════════

describe('Alpha tracker module shape (src/knowledge/alpha-tracker.ts)', () => {
  const src = readSrc('src/knowledge/alpha-tracker.ts');

  it('exports createAlphaTracker function', () => {
    assert.match(src, /export\s+function\s+createAlphaTracker/);
  });

  it('exports AlphaTracker interface', () => {
    assert.match(src, /export\s+interface\s+AlphaTracker/);
  });

  it('imports insertAlphaPropagation from ../db/queries.js', () => {
    assert.ok(src.includes('insertAlphaPropagation'));
    assert.match(src, /import\s+.*insertAlphaPropagation.*from\s+['"]\.\.\/db\/queries\.js['"]/);
  });

  it('imports Pool from ../db/connection.js', () => {
    assert.match(src, /import\s+.*Pool.*from\s+['"]\.\.\/db\/connection\.js['"]/);
  });

  it('queries source tier (SELECT tier FROM sources)', () => {
    assert.match(src, /SELECT\s+tier\s+FROM\s+sources/i);
  });

  it('relies on insert rowCount instead of a pre-check query', () => {
    assert.match(src, /const rowCount = await insertAlphaPropagation/);
    assert.doesNotMatch(src, /SELECT\s+DISTINCT\s+entity_id\s+FROM\s+alpha_propagation/i);
  });

  it('wraps tracking in try/catch for error resilience', () => {
    assert.match(src, /try\s*\{[\s\S]*?catch\s*\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. DB-level dedup structure
// ═══════════════════════════════════════════════════════════════════════

describe('Alpha propagation DB-level dedup structure', () => {
  const migrations = readSrc('src/db/migrations.ts');
  const queries = readQueriesSource();

  it('adds a generated first_mention_day column', () => {
    assert.match(migrations, /ADD COLUMN IF NOT EXISTS first_mention_day DATE[\s\S]*GENERATED ALWAYS AS/i);
  });

  it('deduplicates existing same-day rows before adding the unique index', () => {
    assert.match(migrations, /ROW_NUMBER\(\)\s+OVER\s*\([\s\S]*PARTITION BY entity_id, tier, first_mention_day/i);
    assert.match(migrations, /DELETE FROM alpha_propagation ap[\s\S]*WHERE ap\.id = duplicates\.id/i);
  });

  it('creates a unique index on (entity_id, tier, first_mention_day)', () => {
    assert.match(migrations, /CREATE UNIQUE INDEX IF NOT EXISTS idx_alpha_propagation_unique/i);
    assert.match(migrations, /alpha_propagation\(entity_id, tier, first_mention_day\)/i);
  });

  it('uses ON CONFLICT DO NOTHING and returns rowCount from insertAlphaPropagation', () => {
    assert.match(queries, /ON CONFLICT \(entity_id, tier, first_mention_day\) DO NOTHING/i);
    assert.match(queries, /return result\.rowCount \?\? 0/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Entity manager returns entity IDs
// ═══════════════════════════════════════════════════════════════════════

describe('Entity manager returns entity IDs (src/knowledge/entities.ts)', () => {
  const src = readSrc('src/knowledge/entities.ts');

  it('resolveEntities return type includes string[] (Promise<string[]>)', () => {
    assert.match(src, /resolveEntities[\s\S]*?Promise<string\[\]>/);
  });

  it('collects resolved entity IDs from entityIdMap', () => {
    assert.ok(src.includes('entityIdMap.values()') || (src.includes('entityIdMap') && src.includes('resolvedIds')));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Summarizer accepts alpha tracker
// ═══════════════════════════════════════════════════════════════════════

describe('Summarizer accepts alpha tracker (src/process/summarize.ts)', () => {
  const src = readSrc('src/process/summarize.ts');

  it('imports AlphaTracker from ../knowledge/alpha-tracker.js', () => {
    assert.match(src, /import\s+.*AlphaTracker.*from\s+['"]\.\.\/knowledge\/alpha-tracker\.js['"]/);
  });

  it('createSummarizer signature includes alphaTracker parameter', () => {
    assert.match(src, /createSummarizer\s*\([^)]*alphaTracker/);
  });

  it('calls alphaTracker.trackMentions after entity resolution', () => {
    assert.ok(src.includes('alphaTracker.trackMentions'));
  });

  it('alpha tracker call is wrapped in try/catch', () => {
    assert.match(src, /try\s*\{[\s\S]*?alphaTracker[\s\S]*?catch|alphaTracker[\s\S]*?try\s*\{[\s\S]*?catch/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Index.ts wiring
// ═══════════════════════════════════════════════════════════════════════

describe('Index.ts wiring (src/index.ts)', () => {
  const src = readSrc('src/index.ts');

  it('imports createAlphaTracker from ./knowledge/alpha-tracker.js', () => {
    assert.match(src, /import\s+.*createAlphaTracker.*from\s+['"]\.\/knowledge\/alpha-tracker\.js['"]/);
  });

  it('creates alphaTracker instance with createAlphaTracker(pool', () => {
    assert.match(src, /createAlphaTracker\s*\(\s*pool/);
  });

  it('passes alphaTracker to createSummarizer', () => {
    assert.match(src, /createSummarizer\s*\([^)]*alphaTracker/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Functional dedup coverage
// ═══════════════════════════════════════════════════════════════════════

describe('Alpha propagation dedup behavior', () => {
  const mentionTime = Date.UTC(2026, 3, 11, 1, 0, 0);

  it('insertAlphaPropagation returns rowCount 1 then 0 for same entity+tier on the same day', async () => {
    const pool = new MockAlphaPool();

    const firstInsert = await insertAlphaPropagation(pool as never, {
      entityId: 'entity-1',
      tier: 'alpha',
      source: 'discord',
      sourceId: 'alpha-room',
      firstMentionTime: mentionTime,
      eventId: null,
      itemId: null,
    });
    const duplicateInsert = await insertAlphaPropagation(pool as never, {
      entityId: 'entity-1',
      tier: 'alpha',
      source: 'twitter',
      sourceId: 'alpha-room-2',
      firstMentionTime: mentionTime + 60_000,
      eventId: null,
      itemId: null,
    });

    assert.equal(firstInsert, 1);
    assert.equal(duplicateInsert, 0);
    assert.equal(pool.rows.length, 1);
    assert.ok(
      pool.queries.some((query) => query.includes('ON CONFLICT (entity_id, tier, first_mention_day) DO NOTHING')),
    );
  });

  it('trackMentions returns tracked/skipped counts from insert rowCount without a pre-check query', async () => {
    const pool = new MockAlphaPool({ [sourceKey('discord', 'alpha-room')]: 'alpha' });
    const tracker = createAlphaTracker(pool as never, noopLog);

    const firstResult = await tracker.trackMentions('discord', 'alpha-room', ['entity-1', 'entity-2'], mentionTime);
    const secondResult = await tracker.trackMentions(
      'discord',
      'alpha-room',
      ['entity-1', 'entity-2'],
      mentionTime + 60_000,
    );

    assert.deepEqual(firstResult, { tracked: 2, skipped: 0 });
    assert.deepEqual(secondResult, { tracked: 0, skipped: 2 });
    assert.equal(pool.rows.length, 2);
    assert.ok(pool.queries.every((query) => !query.includes('SELECT DISTINCT entity_id FROM alpha_propagation')));
  });

  it('concurrent same-day tracking only inserts one row for the same entity+tier', async () => {
    const pool = new MockAlphaPool({ [sourceKey('discord', 'alpha-room')]: 'alpha' });
    const tracker = createAlphaTracker(pool as never, noopLog);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => tracker.trackMentions('discord', 'alpha-room', ['entity-1'], mentionTime)),
    );

    const tracked = results.reduce((sum, result) => sum + result.tracked, 0);
    const skipped = results.reduce((sum, result) => sum + result.skipped, 0);

    assert.equal(tracked, 1);
    assert.equal(skipped, 9);
    assert.equal(pool.rows.length, 1);
  });

  it('allows distinct entities and distinct tiers to coexist on the same day', async () => {
    const pool = new MockAlphaPool({
      [sourceKey('discord', 'alpha-room')]: 'alpha',
      [sourceKey('twitter', 'macro-feed')]: 'influencer',
    });
    const tracker = createAlphaTracker(pool as never, noopLog);

    await tracker.trackMentions('discord', 'alpha-room', ['entity-1'], mentionTime);
    await tracker.trackMentions('twitter', 'macro-feed', ['entity-1', 'entity-2'], mentionTime);

    assert.equal(pool.rows.length, 3);
    assert.deepEqual(pool.rows.map((row) => [row.entity_id, row.tier]).sort(), [
      ['entity-1', 'alpha'],
      ['entity-1', 'influencer'],
      ['entity-2', 'influencer'],
    ]);
  });
});
