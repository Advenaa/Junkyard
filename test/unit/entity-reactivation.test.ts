import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Config } from '../../src/config.js';
import type { Logger } from '../../src/logger.js';
import { createEntityManager, type ExtractedEntity } from '../../src/knowledge/entities.js';
import { computeDailySentiment, getEntityDivergence } from '../../src/db/queries.js';

type EntityType = ExtractedEntity['type'];

interface StoredEntity {
  id: string;
  name: string;
  type: EntityType;
  status: 'active' | 'archived';
  relevance: number;
  lastSeen?: number;
}

interface AliasSeed {
  alias: string;
  entityId: string;
  type: EntityType;
}

interface MentionSeed {
  entityId: string;
  source: string;
  summaryId: string;
  sentiment: number | null;
  mentionCount: number;
  createdAt: number;
  language: string | null;
}

interface MockDbSeed {
  aliases: AliasSeed[];
  entities: StoredEntity[];
  mentions?: MentionSeed[];
  coOccurringRows?: Array<{ alias: string; entity_id: string; type: EntityType; status: 'active' | 'archived' }>;
}

interface QueryResultRow {
  [key: string]: unknown;
}

function makeCapturingLog() {
  const warnings: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const log: Logger = {
    info: () => {},
    warn: (obj: Record<string, unknown>, msg: string) => {
      warnings.push({ obj, msg });
    },
    error: () => {},
    debug: () => {},
    child: () => log,
  } as unknown as Logger;

  return { log, warnings };
}

function makeMockDb(seed: MockDbSeed) {
  const entities = new Map(seed.entities.map((entity) => [entity.id, { ...entity }]));
  const mentions = [...(seed.mentions ?? [])];
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  function aggregateSentimentRows(start: number, end: number) {
    const grouped = new Map<string, { sum: number; count: number }>();
    for (const mention of mentions) {
      if (mention.sentiment == null) continue;
      if (mention.createdAt < start || mention.createdAt >= end) continue;
      const current = grouped.get(mention.entityId) ?? { sum: 0, count: 0 };
      current.sum += mention.sentiment;
      current.count += 1;
      grouped.set(mention.entityId, current);
    }
    return [...grouped.entries()].map(([entity_id, value]) => ({
      entity_id,
      avg_sentiment: value.sum / value.count,
      mention_count: value.count,
    }));
  }

  function aggregateEntityDivergence(entityId: string, start: number, end: number) {
    const byLanguage = new Map<string, { sum: number; count: number }>();
    for (const mention of mentions) {
      if (mention.entityId !== entityId) continue;
      if (mention.sentiment == null) continue;
      if (mention.createdAt < start || mention.createdAt > end) continue;
      if (mention.language !== 'eng' && mention.language !== 'ind') continue;
      const current = byLanguage.get(mention.language) ?? { sum: 0, count: 0 };
      current.sum += mention.sentiment;
      current.count += 1;
      byLanguage.set(mention.language, current);
    }

    const eng = byLanguage.get('eng');
    const ind = byLanguage.get('ind');
    return {
      eng_sentiment: eng ? eng.sum / eng.count : null,
      eng_mentions: eng?.count ?? 0,
      ind_sentiment: ind ? ind.sum / ind.count : null,
      ind_mentions: ind?.count ?? 0,
      divergence: eng && ind ? Math.abs(eng.sum / eng.count - ind.sum / ind.count) : null,
    };
  }

  async function query(sql: string, params: unknown[] = []): Promise<{ rows: QueryResultRow[]; rowCount: number }> {
    calls.push({ sql, params });

    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('FROM entity_aliases ea') && sql.includes('WHERE ea.alias = $1')) {
      const alias = params[0] as string;
      const type = params[1] as EntityType;
      const rows = seed.aliases
        .filter((entry) => entry.alias === alias && entry.type === type)
        .map((entry) => ({
          entity_id: entry.entityId,
          status: entities.get(entry.entityId)?.status ?? 'active',
        }));
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('SELECT DISTINCT ea.alias, ea.entity_id, e.type, e.status')) {
      return { rows: seed.coOccurringRows ?? [], rowCount: seed.coOccurringRows?.length ?? 0 };
    }

    if (sql.startsWith("UPDATE entities SET status = 'active'")) {
      const entityId = params[0] as string;
      const entity = entities.get(entityId);
      if (entity) {
        entity.status = 'active';
        entity.relevance = Math.max(entity.relevance, 0.5);
      }
      return { rows: [], rowCount: entity ? 1 : 0 };
    }

    if (sql.startsWith('INSERT INTO entities (id, name, type, status, relevance, first_seen, last_seen)')) {
      const id = params[0] as string;
      const name = params[1] as string;
      const type = params[2] as EntityType;
      const now = params[3] as number;
      entities.set(id, { id, name, type, status: 'active', relevance: 0, lastSeen: now });
      return { rows: [{ id }], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO entity_aliases')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('SET relevance = entities.relevance + data.weight')) {
      const now = params[0] as number;
      const ids = params[1] as string[];
      const weights = params[2] as number[];
      for (let i = 0; i < ids.length; i += 1) {
        const entity = entities.get(ids[i]);
        if (!entity) continue;
        entity.relevance += weights[i] ?? 0;
        entity.lastSeen = now;
      }
      return { rows: [], rowCount: ids.length };
    }

    if (sql.startsWith('INSERT INTO entity_mentions')) {
      for (let i = 0; i < params.length; i += 8) {
        mentions.push({
          entityId: params[i + 1] as string,
          source: params[i + 2] as string,
          summaryId: params[i + 3] as string,
          sentiment: params[i + 4] as number | null,
          mentionCount: params[i + 5] as number,
          createdAt: params[i + 6] as number,
          language: (params[i + 7] as string | null) ?? null,
        });
      }
      return { rows: [], rowCount: params.length / 8 };
    }

    if (sql.includes('AVG(sentiment) AS avg_sentiment') && sql.includes('GROUP BY entity_id')) {
      const start = params[0] as number;
      const end = params[1] as number;
      const rows = aggregateSentimentRows(start, end);
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('WITH per_lang AS') && sql.includes('WHERE entity_id = $1')) {
      const row = aggregateEntityDivergence(params[0] as string, params[1] as number, params[2] as number);
      return { rows: [row], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in test harness: ${sql}`);
  }

  const client = { query, release: () => {} };
  const pool = {
    connect: async () => client,
    query,
  };

  return { pool, calls, mentions };
}

const noopLog: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLog,
} as unknown as Logger;

const config = {
  models: {
    normalizer: 'openai-codex:gpt-5.4-mini',
  },
} as Config;

const llm = {
  async call() {
    throw new Error('LLM should not run in entity reactivation tests');
  },
};

function mentionInsertParams(calls: Array<{ sql: string; params: unknown[] }>): unknown[][] {
  return calls.filter((call) => call.sql.startsWith('INSERT INTO entity_mentions')).map((call) => call.params);
}

describe('entity reactivation sentiment handling', () => {
  it('Tier 1 alias reactivation inserts one sentiment-bearing mention row', async () => {
    const { pool, calls, mentions } = makeMockDb({
      aliases: [{ alias: 'ethereum', entityId: 'ent-eth', type: 'token' }],
      entities: [{ id: 'ent-eth', name: 'ethereum', type: 'token', status: 'archived', relevance: 0.1 }],
    });
    const manager = createEntityManager(pool as never, noopLog, config, llm);

    await manager.resolveEntities(
      [{ name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 3, sentiment: 0.7 }],
      'discord',
      'sum-tier1',
      'eng',
    );

    assert.equal(mentionInsertParams(calls).length, 1, 'reactivation should not duplicate the mention insert');
    assert.equal(mentions.length, 1);
    assert.equal(mentions[0]?.sentiment, 0.7);
    assert.equal(mentions[0]?.mentionCount, 3);
    assert.equal(mentions[0]?.summaryId, 'sum-tier1');
  });

  it('Tier 2 co-occurrence reactivation inserts one sentiment-bearing mention row', async () => {
    const { pool, calls, mentions } = makeMockDb({
      aliases: [{ alias: 'ethereum', entityId: 'ent-eth', type: 'token' }],
      entities: [
        { id: 'ent-eth', name: 'ethereum', type: 'token', status: 'active', relevance: 1.2 },
        { id: 'ent-op', name: 'optimism', type: 'project', status: 'archived', relevance: 0.2 },
      ],
      coOccurringRows: [{ alias: 'optimism', entity_id: 'ent-op', type: 'project', status: 'archived' }],
    });
    const manager = createEntityManager(pool as never, noopLog, config, llm);

    await manager.resolveEntities(
      [
        { name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 2, sentiment: 0.4 },
        { name: 'Optimism', aliases: ['OP'], type: 'project', mentionCount: 5, sentiment: -0.3 },
      ],
      'twitter',
      'sum-tier2',
      'eng',
    );

    const optimismMentions = mentions.filter((mention) => mention.entityId === 'ent-op');
    assert.equal(optimismMentions.length, 1, 'Tier 2 reactivation should emit one mention row');
    assert.equal(optimismMentions[0]?.sentiment, -0.3);
    assert.equal(optimismMentions[0]?.mentionCount, 5);
    assert.equal(
      mentionInsertParams(calls).length,
      2,
      'one batch insert should cover the active entity and one direct insert should cover the reactivated entity',
    );
  });

  it('keeps the normal batch mention insertion path unchanged for active matches', async () => {
    const { pool, calls, mentions } = makeMockDb({
      aliases: [{ alias: 'ethereum', entityId: 'ent-eth', type: 'token' }],
      entities: [{ id: 'ent-eth', name: 'ethereum', type: 'token', status: 'active', relevance: 1.1 }],
    });
    const manager = createEntityManager(pool as never, noopLog, config, llm);

    await manager.resolveEntities(
      [{ name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 4, sentiment: 0.25 }],
      'rss',
      'sum-normal',
      'eng',
    );

    assert.equal(mentionInsertParams(calls).length, 1);
    assert.equal(mentions.length, 1);
    assert.equal(mentions[0]?.sentiment, 0.25);
    assert.equal(mentions[0]?.mentionCount, 4);
  });

  it('reactivated mentions remain visible to downstream sentiment queries', async () => {
    const { pool } = makeMockDb({
      aliases: [{ alias: 'ethereum', entityId: 'ent-eth', type: 'token' }],
      entities: [{ id: 'ent-eth', name: 'ethereum', type: 'token', status: 'archived', relevance: 0.2 }],
    });
    const manager = createEntityManager(pool as never, noopLog, config, llm);

    await manager.resolveEntities(
      [{ name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 1, sentiment: 0.8 }],
      'discord',
      'sum-eng',
      'eng',
    );
    await manager.resolveEntities(
      [{ name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 1, sentiment: -0.2 }],
      'discord',
      'sum-ind',
      'ind',
    );

    const today = new Date().toISOString().slice(0, 10);
    const daily = await computeDailySentiment(pool as never, today);
    assert.equal(daily.length, 1);
    assert.equal(daily[0]?.entity_id, 'ent-eth');
    assert.equal(daily[0]?.mention_count, 2);

    const divergence = await getEntityDivergence(pool as never, 'ent-eth', 0, Date.now() + 1_000);
    assert.equal(divergence.engMentions, 1);
    assert.equal(divergence.indMentions, 1);
    assert.equal(divergence.engSentiment, 0.8);
    assert.equal(divergence.indSentiment, -0.2);
    assert.equal(divergence.divergence, 1);
  });
});

describe('entity resolution empty-result warnings', () => {
  it('warns when non-empty input resolves to zero entities', async () => {
    const { pool } = makeMockDb({ aliases: [], entities: [] });
    const { log, warnings } = makeCapturingLog();
    const manager = createEntityManager(pool as never, log, config, llm);

    const resolvedIds = await manager.resolveEntities(
      [
        { name: '$', aliases: ['$'], type: 'token', mentionCount: 1, sentiment: 0.1 },
        { name: '  ', aliases: ['  '], type: 'project', mentionCount: 1, sentiment: -0.2 },
      ],
      'discord',
      'sum-empty',
      'eng',
    );

    assert.deepEqual(resolvedIds, []);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.msg, 'Entity resolution returned zero results from non-empty input');
    assert.deepEqual(warnings[0]?.obj.inputNames, ['$', '  ']);
    assert.equal(warnings[0]?.obj.reason, 'all_filtered_or_failed');
    assert.equal(warnings[0]?.obj.summaryId, 'sum-empty');
  });

  it('does not warn when there are no input entities', async () => {
    const { pool } = makeMockDb({ aliases: [], entities: [] });
    const { log, warnings } = makeCapturingLog();
    const manager = createEntityManager(pool as never, log, config, llm);

    const resolvedIds = await manager.resolveEntities([], 'discord', 'sum-no-input', 'eng');

    assert.deepEqual(resolvedIds, []);
    assert.equal(warnings.length, 0);
  });
});
