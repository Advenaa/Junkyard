import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Config } from '../../src/config.js';
import type { Logger } from '../../src/logger.js';
import {
  createEntityManager,
  getTier3DisambiguationFallbackStats,
  resetTier3DisambiguationFallbackStats,
  type ExtractedEntity,
} from '../../src/knowledge/entities.js';

type EntityType = ExtractedEntity['type'];

interface QueryResultRow {
  [key: string]: unknown;
}

interface CapturedLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message?: string;
  meta?: Record<string, unknown>;
}

const config = {
  models: {
    normalizer: 'openai-codex:gpt-5.4-mini',
  },
} as Config;

function makeMockDb() {
  async function query(sql: string, params: unknown[] = []): Promise<{ rows: QueryResultRow[]; rowCount: number }> {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('FROM entity_aliases ea') && sql.includes('WHERE ea.alias = $1')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('SELECT DISTINCT ea.alias, ea.entity_id, e.type, e.status')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('INSERT INTO entities (id, name, type, status, relevance, first_seen, last_seen)')) {
      const id = params[0] as string;
      return { rows: [{ id }], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO entity_aliases')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('SET relevance = entities.relevance + data.weight')) {
      const ids = params[1] as string[];
      return { rows: [], rowCount: ids.length };
    }

    if (sql.startsWith('INSERT INTO entity_mentions')) {
      return { rows: [], rowCount: params.length / 8 };
    }

    throw new Error(`Unhandled SQL in test harness: ${sql}`);
  }

  const client = { query, release: () => {} };
  const pool = {
    connect: async () => client,
    query,
  };

  return { pool };
}

function makeLogCapture() {
  const entries: CapturedLogEntry[] = [];

  const push = (level: CapturedLogEntry['level'], metaOrMessage?: unknown, maybeMessage?: string): void => {
    if (typeof metaOrMessage === 'string') {
      entries.push({ level, message: metaOrMessage });
      return;
    }

    entries.push({
      level,
      meta: (metaOrMessage as Record<string, unknown> | undefined) ?? undefined,
      message: maybeMessage,
    });
  };

  const logger: Logger = {
    debug(metaOrMessage?: unknown, maybeMessage?: string) {
      push('debug', metaOrMessage, maybeMessage);
    },
    info(metaOrMessage?: unknown, maybeMessage?: string) {
      push('info', metaOrMessage, maybeMessage);
    },
    warn(metaOrMessage?: unknown, maybeMessage?: string) {
      push('warn', metaOrMessage, maybeMessage);
    },
    error(metaOrMessage?: unknown, maybeMessage?: string) {
      push('error', metaOrMessage, maybeMessage);
    },
    child() {
      return logger;
    },
  } as unknown as Logger;

  return { entries, logger };
}

function makeEntity(name: string, type: EntityType): ExtractedEntity {
  return {
    name,
    aliases: [name],
    type,
    mentionCount: 1,
    sentiment: 0.1,
  };
}

function findWarn(entries: CapturedLogEntry[], message: string, reason?: string): CapturedLogEntry | undefined {
  return entries.find(
    (entry) =>
      entry.level === 'warn' &&
      entry.message === message &&
      (reason === undefined || entry.meta?.['reason'] === reason),
  );
}

beforeEach(() => {
  resetTier3DisambiguationFallbackStats();
});

describe('Tier 3 disambiguation fallback tracking', () => {
  it('tracks JSON parse failures, flags fallback entities, and logs entity names', async () => {
    const { pool } = makeMockDb();
    const { entries, logger } = makeLogCapture();
    const manager = createEntityManager(pool as never, logger, config, {
      async call() {
        return {
          content: '{not valid json',
          usage: { input_tokens: 1, output_tokens: 1 },
          cost: 0,
        };
      },
    });

    const resolved = await manager.resolveEntitiesDetailed([makeEntity('FTX', 'token')], 'discord', 'sum-json', 'eng');

    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.disambiguationFailed, true);

    const stats = getTier3DisambiguationFallbackStats();
    assert.equal(stats.totalCount, 1);
    assert.equal(stats.byReason['invalid-json'], 1);

    const warnEntry = findWarn(entries, 'Tier 3 disambiguation fell back to default entity types', 'invalid-json');
    assert.ok(warnEntry);
    assert.deepEqual(warnEntry.meta?.['entityNames'], ['FTX']);
  });

  it('tracks zod validation failures, flags fallback entities, and logs entity names', async () => {
    const { pool } = makeMockDb();
    const { entries, logger } = makeLogCapture();
    const manager = createEntityManager(pool as never, logger, config, {
      async call() {
        return {
          content: JSON.stringify([{ name: 'FTX', type: 'company' }]),
          usage: { input_tokens: 1, output_tokens: 1 },
          cost: 0,
        };
      },
    });

    const resolved = await manager.resolveEntitiesDetailed([makeEntity('FTX', 'token')], 'discord', 'sum-zod', 'eng');

    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.disambiguationFailed, true);

    const stats = getTier3DisambiguationFallbackStats();
    assert.equal(stats.totalCount, 1);
    assert.equal(stats.byReason['zod-validation'], 1);

    const warnEntry = findWarn(entries, 'Tier 3 disambiguation fell back to default entity types', 'zod-validation');
    assert.ok(warnEntry);
    assert.deepEqual(warnEntry.meta?.['entityNames'], ['FTX']);
  });

  it('tracks LLM exceptions, flags fallback entities, and logs entity names', async () => {
    const { pool } = makeMockDb();
    const { entries, logger } = makeLogCapture();
    const manager = createEntityManager(pool as never, logger, config, {
      async call() {
        throw new Error('tier3 exploded');
      },
    });

    const resolved = await manager.resolveEntitiesDetailed([makeEntity('FTX', 'token')], 'discord', 'sum-llm', 'eng');

    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.disambiguationFailed, true);

    const stats = getTier3DisambiguationFallbackStats();
    assert.equal(stats.totalCount, 1);
    assert.equal(stats.byReason['llm-exception'], 1);

    const warnEntry = findWarn(entries, 'Tier 3 disambiguation fell back to default entity types', 'llm-exception');
    assert.ok(warnEntry);
    assert.deepEqual(warnEntry.meta?.['entityNames'], ['FTX']);
  });

  it('emits a batch warning when more than half the batch falls back', async () => {
    const { pool } = makeMockDb();
    const { entries, logger } = makeLogCapture();
    const manager = createEntityManager(pool as never, logger, config, {
      async call() {
        return {
          content: JSON.stringify([{ name: 'Ethereum', type: 'token', context_key: 'l1' }]),
          usage: { input_tokens: 1, output_tokens: 1 },
          cost: 0,
        };
      },
    });

    const resolved = await manager.resolveEntitiesDetailed(
      [makeEntity('FTX', 'token'), makeEntity('Ethereum', 'token'), makeEntity('Circle', 'company')],
      'discord',
      'sum-batch-high',
      'eng',
    );

    assert.equal(
      resolved.filter((entity) => entity.disambiguationFailed === true).length,
      2,
      'two entities should carry fallback metadata',
    );

    const stats = getTier3DisambiguationFallbackStats();
    assert.equal(stats.totalCount, 2);
    assert.equal(stats.byReason['partial-response'], 2);

    const batchWarn = findWarn(entries, 'Tier 3 disambiguation fallback rate exceeded 50% of batch');
    assert.ok(batchWarn);
    assert.equal(batchWarn.meta?.['batchSize'], 3);
    assert.equal(batchWarn.meta?.['fallbackCount'], 2);
    assert.deepEqual(batchWarn.meta?.['fallbackEntityNames'], ['FTX', 'Circle']);
  });

  it('does not emit a batch warning when half or less of the batch falls back', async () => {
    const { pool } = makeMockDb();
    const { entries, logger } = makeLogCapture();
    const manager = createEntityManager(pool as never, logger, config, {
      async call() {
        return {
          content: JSON.stringify([
            { name: 'Ethereum', type: 'token', context_key: 'l1' },
            { name: 'Circle', type: 'company', context_key: 'stablecoin-issuer' },
          ]),
          usage: { input_tokens: 1, output_tokens: 1 },
          cost: 0,
        };
      },
    });

    const resolved = await manager.resolveEntitiesDetailed(
      [makeEntity('FTX', 'token'), makeEntity('Ethereum', 'token'), makeEntity('Circle', 'company')],
      'discord',
      'sum-batch-low',
      'eng',
    );

    assert.equal(
      resolved.filter((entity) => entity.disambiguationFailed === true).length,
      1,
      'one entity should carry fallback metadata',
    );

    const batchWarn = findWarn(entries, 'Tier 3 disambiguation fallback rate exceeded 50% of batch');
    assert.equal(batchWarn, undefined);
  });
});
