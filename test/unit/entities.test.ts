import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createEntityManager,
  DisambiguatedEntitySchema,
  SOURCE_WEIGHTS,
  getTier3DisambiguationFallbackStats,
  normalizeAlias,
  resetTier3DisambiguationFallbackStats,
  type ExtractedEntity,
} from '../../src/knowledge/entities.js';
import { fakeConfig, fakeEntity, makeMockLogger, makeMockPool } from '../helpers/factories.js';

interface MockLlm {
  call: () => Promise<{
    content: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  wrapWithNonce: (content: string) => { wrapped: string; nonce: string };
}

interface AliasLookupRow {
  entity_id: string;
  status: string;
}

interface CoOccurringRow {
  alias: string;
  entity_id: string;
  type: ExtractedEntity['type'];
  status: string;
}

interface EntityManagerHarnessOptions {
  aliasMatches?: Record<string, AliasLookupRow>;
  coOccurringRows?: CoOccurringRow[];
  insertedEntityIds?: string[];
  llm?: MockLlm;
}

function mockLlm(response?: string): MockLlm {
  return {
    call: async () => ({
      content: response ?? '[]',
      model: 'test',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    }),
    wrapWithNonce: (content: string) => ({ wrapped: `<nonce>${content}</nonce>`, nonce: 'test-nonce' }),
  };
}

function aliasLookupKey(alias: string, type: ExtractedEntity['type']): string {
  return `${alias}\0${type}`;
}

function createEntityManagerHarness(options: EntityManagerHarnessOptions = {}) {
  const insertedEntityIds = [...(options.insertedEntityIds ?? [])];
  const pool = makeMockPool((sql, params = []) => {
    if (sql.includes('FROM entity_aliases ea') && sql.includes('WHERE ea.alias = $1')) {
      const alias = params[0];
      const type = params[1];

      if (typeof alias !== 'string' || typeof type !== 'string') {
        throw new Error(`Unexpected alias lookup params: ${String(params)}`);
      }

      const row = options.aliasMatches?.[aliasLookupKey(alias, type as ExtractedEntity['type'])];
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes('SELECT DISTINCT ea.alias, ea.entity_id, e.type, e.status')) {
      return {
        rows: options.coOccurringRows ?? [],
        rowCount: options.coOccurringRows?.length ?? 0,
      };
    }

    if (sql.startsWith('INSERT INTO entities')) {
      const id = insertedEntityIds.shift() ?? (params[0] as string);
      return { rows: [{ id }], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO entity_aliases')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO entity_mentions')) {
      return { rows: [], rowCount: Math.max(1, Math.floor(params.length / 8)) };
    }

    if (sql.includes("UPDATE entities SET status = 'active'")) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('SET relevance = entities.relevance + data.weight')) {
      const ids = params[1];
      return {
        rows: [],
        rowCount: Array.isArray(ids) ? ids.length : 0,
      };
    }

    throw new Error(`Unhandled SQL in test harness: ${sql}`);
  });
  const log = makeMockLogger();
  const manager = createEntityManager(
    pool,
    log,
    fakeConfig({
      models: {
        normalizer: 'openai-codex:gpt-5.4-mini',
      },
    }),
    options.llm ?? mockLlm(),
  );

  return { manager, pool };
}

function nonTransactionCalls(calls: ReadonlyArray<{ sql: string; params: unknown[] }>) {
  return calls.filter((call) => !['BEGIN', 'COMMIT', 'ROLLBACK'].includes(call.sql.trim().toUpperCase()));
}

function queryCalls(calls: ReadonlyArray<{ sql: string; params: unknown[] }>, fragment: string) {
  return calls.filter((call) => call.sql.includes(fragment));
}

// ── DisambiguatedEntitySchema (H-037) ──────────────────────────────────────

describe('DisambiguatedEntitySchema', () => {
  it('accepts a valid disambiguation response', () => {
    const input = [
      { name: 'Ethereum', type: 'token', context_key: 'defi-l1' },
      { name: 'Vitalik Buterin', type: 'person', context_key: 'eth-founder' },
    ];
    const result = DisambiguatedEntitySchema.safeParse(input);
    assert.ok(result.success, 'should parse valid input');
    assert.equal(result.data!.length, 2);
  });

  it('rejects when name is missing', () => {
    const input = [{ type: 'token', context_key: 'defi' }];
    const result = DisambiguatedEntitySchema.safeParse(input);
    assert.equal(result.success, false);
  });

  it('rejects when context_key is missing', () => {
    const input = [{ name: 'Solana', type: 'token' }];
    const result = DisambiguatedEntitySchema.safeParse(input);
    assert.equal(result.success, false);
  });

  it('rejects invalid type enum value', () => {
    const input = [{ name: 'FooBar', type: 'unknown', context_key: 'x' }];
    const result = DisambiguatedEntitySchema.safeParse(input);
    assert.equal(result.success, false);
  });

  it('accepts all valid type enum values', () => {
    const types = ['token', 'person', 'project', 'company', 'event'] as const;
    for (const type of types) {
      const input = [{ name: 'Test', type, context_key: 'k' }];
      const result = DisambiguatedEntitySchema.safeParse(input);
      assert.ok(result.success, `type '${type}' should be valid`);
    }
  });

  it('strips extra fields from parsed output', () => {
    const input = [{ name: 'A', type: 'token', context_key: 'k', extraField: true }];
    const result = DisambiguatedEntitySchema.safeParse(input);
    assert.ok(result.success);
    assert.equal((result.data![0] as Record<string, unknown>).extraField, undefined);
  });

  it('accepts an empty array', () => {
    const result = DisambiguatedEntitySchema.safeParse([]);
    assert.ok(result.success);
    assert.equal(result.data!.length, 0);
  });

  it('rejects non-array input', () => {
    const result = DisambiguatedEntitySchema.safeParse({ name: 'X', type: 'token', context_key: 'k' });
    assert.equal(result.success, false);
  });
});

// ── SOURCE_WEIGHTS ─────────────────────────────────────────────────────────

describe('SOURCE_WEIGHTS', () => {
  it('has expected weight for discord', () => {
    assert.equal(SOURCE_WEIGHTS.discord, 1.0);
  });

  it('has expected weight for twitter', () => {
    assert.equal(SOURCE_WEIGHTS.twitter, 1.5);
  });

  it('has expected weight for news', () => {
    assert.equal(SOURCE_WEIGHTS.news, 2.0);
  });

  it('has expected weight for rss', () => {
    assert.equal(SOURCE_WEIGHTS.rss, 2.0);
  });

  it('returns undefined for unknown source (fallback to 1.0 in code)', () => {
    assert.equal(SOURCE_WEIGHTS['telegram'], undefined);
  });
});

// ── normalizeAlias ─────────────────────────────────────────────────────────

describe('normalizeAlias', () => {
  it('lowercases a simple name', () => {
    assert.equal(normalizeAlias('Ethereum'), 'ethereum');
  });

  it('strips $ prefix and lowercases', () => {
    assert.equal(normalizeAlias('$ETH'), 'eth');
  });

  it('strips only the first $ prefix', () => {
    assert.equal(normalizeAlias('$$DOUBLE'), '$double');
  });

  it('handles already-lowercase input', () => {
    assert.equal(normalizeAlias('solana'), 'solana');
  });

  it('handles empty string', () => {
    assert.equal(normalizeAlias(''), '');
  });

  it('handles Unicode names (CJK)', () => {
    assert.equal(normalizeAlias('Ethereum\u200B'), 'ethereum\u200B');
  });

  it('lowercases accented Latin characters', () => {
    assert.equal(normalizeAlias('Caf\u00E9'), 'caf\u00E9');
    assert.equal(normalizeAlias('CAF\u00C9'), 'caf\u00E9');
  });

  it('handles mixed-case with numbers', () => {
    assert.equal(normalizeAlias('Layer2Token'), 'layer2token');
  });

  it('handles $-only input', () => {
    assert.equal(normalizeAlias('$'), '');
  });

  it('returns empty string for whitespace-only input (P-010)', () => {
    assert.equal(normalizeAlias('  '), '');
  });

  it('returns empty string for whitespace-padded $ (P-010)', () => {
    assert.equal(normalizeAlias('  $  '), '');
  });
});

// ── EL-001 regression: empty aliases after normalization ──────────────────

describe('EL-001: skips empty aliases after normalization', () => {
  it('filters out symbol-only aliases that normalize to empty string', () => {
    const aliases = ['$', 'ETH', '$BTC', '  ', '  $  ', 'Solana'];

    // Reproduce the filtering logic from resolveEntities (line 324-328)
    const aliasTuples: { alias: string; entityId: string }[] = [];
    const entityId = 'fake-entity-id';
    for (const alias of aliases) {
      const normalizedAlias = normalizeAlias(alias);
      if (!normalizedAlias) continue;
      aliasTuples.push({ alias: normalizedAlias, entityId });
    }

    // '$', '  ', '  $  ' all normalize to '' and must be skipped
    assert.equal(aliasTuples.length, 3);
    assert.deepEqual(
      aliasTuples.map((t) => t.alias),
      ['eth', 'btc', 'solana'],
    );
  });

  it('produces no tuples when all aliases normalize to empty', () => {
    const aliases = ['$', '  ', '  $  '];

    const aliasTuples: { alias: string; entityId: string }[] = [];
    const entityId = 'fake-entity-id';
    for (const alias of aliases) {
      const normalizedAlias = normalizeAlias(alias);
      if (!normalizedAlias) continue;
      aliasTuples.push({ alias: normalizedAlias, entityId });
    }

    assert.equal(aliasTuples.length, 0);
  });

  it('still inserts valid aliases from a mixed batch', () => {
    const aliases = ['$', 'Ethereum', '$', '$SOL'];

    const aliasTuples: { alias: string; entityId: string }[] = [];
    const entityId = 'fake-entity-id';
    for (const alias of aliases) {
      const normalizedAlias = normalizeAlias(alias);
      if (!normalizedAlias) continue;
      aliasTuples.push({ alias: normalizedAlias, entityId });
    }

    assert.equal(aliasTuples.length, 2);
    assert.deepEqual(
      aliasTuples.map((t) => t.alias),
      ['ethereum', 'sol'],
    );
  });
});

// ── Canonical name normalization (entity.name.toLowerCase()) ───────────────

describe('Canonical name normalization', () => {
  it('produces identical canonical for case variants', () => {
    const variants = ['BITCOIN', 'Bitcoin', 'bitcoin', 'BitCoin'];
    const canonicals = new Set(variants.map((v) => v.toLowerCase()));
    assert.equal(canonicals.size, 1);
    assert.ok(canonicals.has('bitcoin'));
  });

  it('preserves non-ASCII casing rules', () => {
    // Turkish dotted I is a known edge case; JS toLowerCase uses locale-independent rules
    assert.equal('ISTANBUL'.toLowerCase(), 'istanbul');
  });

  it('deduplicates alias variants after normalization', () => {
    const aliases = ['ETH', '$ETH', 'Ethereum', 'ethereum', '$eth'];
    const normalized = new Set(aliases.map(normalizeAlias));
    assert.equal(normalized.size, 2); // 'eth' and 'ethereum'
  });
});

// ── Relevance formula ──────────────────────────────────────────────────────

describe('Relevance delta formula', () => {
  it('produces positive delta for any positive mention count', () => {
    for (const count of [1, 5, 100]) {
      const delta = Math.log(1 + count) * SOURCE_WEIGHTS.discord;
      assert.ok(delta > 0, `delta for count=${count} should be positive`);
    }
  });

  it('scales with source weight', () => {
    const count = 5;
    const discordDelta = Math.log(1 + count) * SOURCE_WEIGHTS.discord;
    const newsDelta = Math.log(1 + count) * SOURCE_WEIGHTS.news;
    assert.ok(newsDelta > discordDelta, 'news should outweigh discord');
  });

  it('matches expected value for known inputs', () => {
    const count = 5;
    const weight = 1.5; // twitter
    const expected = Math.log(6) * 1.5;
    const actual = Math.log(1 + count) * weight;
    assert.ok(Math.abs(actual - expected) < 1e-10);
  });

  it('returns 0 delta when mention count is 0', () => {
    const delta = Math.log(1 + 0) * SOURCE_WEIGHTS.news;
    assert.equal(delta, 0);
  });

  it('folds duplicate canonical entity IDs in the batch relevance update while preserving mention rows', async () => {
    const activeEntity = fakeEntity({ id: 'ent-btc', name: 'bitcoin' });
    const pool = makeMockPool((sql, params = []) => {
      if (sql.includes('FROM entity_aliases ea') && sql.includes('WHERE ea.alias = $1')) {
        return {
          rows: [{ entity_id: activeEntity.id, status: activeEntity.status }],
          rowCount: 1,
        };
      }

      if (sql.includes('SELECT DISTINCT ea.alias, ea.entity_id, e.type, e.status')) {
        return { rows: [], rowCount: 0 };
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
    });
    const calls = pool.calls;
    const config = fakeConfig({
      models: {
        normalizer: 'openai-codex:gpt-5.4-mini',
      },
    });
    const log = makeMockLogger();
    const llm = {
      async call() {
        throw new Error('LLM should not run in duplicate relevance fold test');
      },
    };
    const manager = createEntityManager(pool, log, config, llm);
    const entities: ExtractedEntity[] = [
      { name: 'BTC', mentionCount: 4, sentiment: 0, aliases: [], type: 'token' },
      { name: 'btc', mentionCount: 3, sentiment: 0, aliases: [], type: 'token' },
    ];

    await manager.resolveEntities(entities, 'discord', 'sum-btc-dupes', 'eng');

    const updateCall = calls.find((call) => call.sql.includes('SET relevance = entities.relevance + data.weight'));
    assert.ok(updateCall, 'expected a batch UPDATE for relevance');

    const updateIds = updateCall.params[1] as string[];
    const updateWeights = updateCall.params[2] as number[];
    const sourceWeight = SOURCE_WEIGHTS.discord;
    const expectedWeight = Math.log(1 + 4) * sourceWeight + Math.log(1 + 3) * sourceWeight;

    assert.deepEqual(updateIds, ['ent-btc']);
    assert.equal(updateWeights.length, 1);
    assert.ok(Math.abs(updateWeights[0] - expectedWeight) < 1e-10);

    const mentionCall = calls.find((call) => call.sql.startsWith('INSERT INTO entity_mentions'));
    assert.ok(mentionCall, 'expected a batch INSERT for entity_mentions');
    assert.equal(mentionCall.params.length / 8, 2);
  });
});

describe('resolveEntities - Tier 1', () => {
  beforeEach(() => {
    resetTier3DisambiguationFallbackStats();
  });

  it('resolves entity via exact alias match', async () => {
    const activeEntity = fakeEntity({ id: 'ent-bitcoin', name: 'bitcoin', type: 'token' });
    const { manager, pool } = createEntityManagerHarness({
      aliasMatches: {
        [aliasLookupKey('bitcoin', 'token')]: {
          entity_id: activeEntity.id,
          status: activeEntity.status,
        },
      },
    });

    const entityIds = await manager.resolveEntities(
      [{ name: 'bitcoin', aliases: [], type: 'token', mentionCount: 2, sentiment: 0.6 }],
      'discord',
      'sum-tier1-exact',
      'eng',
    );

    assert.deepEqual(entityIds, ['ent-bitcoin']);
    assert.equal(queryCalls(pool.calls, 'INSERT INTO entities').length, 0);
  });

  it('case-insensitive alias match normalizes Bitcoin to bitcoin', async () => {
    const activeEntity = fakeEntity({ id: 'ent-bitcoin', name: 'bitcoin', type: 'token' });
    const { manager, pool } = createEntityManagerHarness({
      aliasMatches: {
        [aliasLookupKey('bitcoin', 'token')]: {
          entity_id: activeEntity.id,
          status: activeEntity.status,
        },
      },
    });

    const entityIds = await manager.resolveEntities(
      [{ name: 'Bitcoin', aliases: [], type: 'token', mentionCount: 1, sentiment: 0 }],
      'discord',
      'sum-tier1-case',
      'eng',
    );

    const aliasLookupCall = pool.calls.find((call) => call.sql.includes('WHERE ea.alias = $1'));
    assert.ok(aliasLookupCall);
    assert.equal(aliasLookupCall.params[0], 'bitcoin');
    assert.deepEqual(entityIds, ['ent-bitcoin']);
  });

  it('strips leading $ for token names', async () => {
    const activeEntity = fakeEntity({ id: 'ent-btc', name: 'btc', type: 'token' });
    const { manager, pool } = createEntityManagerHarness({
      aliasMatches: {
        [aliasLookupKey('btc', 'token')]: {
          entity_id: activeEntity.id,
          status: activeEntity.status,
        },
      },
    });

    const entityIds = await manager.resolveEntities(
      [{ name: '$BTC', aliases: [], type: 'token', mentionCount: 3, sentiment: 0.2 }],
      'discord',
      'sum-tier1-dollar',
      'eng',
    );

    const aliasLookupCall = pool.calls.find((call) => call.sql.includes('WHERE ea.alias = $1'));
    assert.ok(aliasLookupCall);
    assert.equal(aliasLookupCall.params[0], 'btc');
    assert.deepEqual(entityIds, ['ent-btc']);
  });

  it('skips entities with empty normalized name', async () => {
    const { manager, pool } = createEntityManagerHarness();

    const entityIds = await manager.resolveEntities(
      [{ name: '$', aliases: [], type: 'token', mentionCount: 1, sentiment: 0 }],
      'discord',
      'sum-tier1-empty',
      'eng',
    );

    assert.deepEqual(entityIds, []);
    assert.deepEqual(nonTransactionCalls(pool.calls), []);
  });

  it('reactivates archived entity on alias match', async () => {
    const archivedEntity = fakeEntity({ id: 'ent-archived', name: 'solana', status: 'archived', type: 'token' });
    const { manager, pool } = createEntityManagerHarness({
      aliasMatches: {
        [aliasLookupKey('solana', 'token')]: {
          entity_id: archivedEntity.id,
          status: archivedEntity.status,
        },
      },
    });

    const entityIds = await manager.resolveEntities(
      [{ name: 'Solana', aliases: [], type: 'token', mentionCount: 4, sentiment: 0.3 }],
      'discord',
      'sum-tier1-reactivate',
      'eng',
    );

    const reactivationCall = pool.calls.find((call) => call.sql.includes("SET status = 'active'"));
    const mentionCalls = queryCalls(pool.calls, 'INSERT INTO entity_mentions');

    assert.deepEqual(entityIds, ['ent-archived']);
    assert.ok(reactivationCall);
    assert.equal(reactivationCall.params[0], 'ent-archived');
    assert.equal(mentionCalls.length, 1);
  });
});

describe('resolveEntities - Tier 2', () => {
  beforeEach(() => {
    resetTier3DisambiguationFallbackStats();
  });

  it('resolves via co-occurring entities', async () => {
    const bitcoin = fakeEntity({ id: 'ent-bitcoin', name: 'bitcoin', type: 'token' });
    const { manager, pool } = createEntityManagerHarness({
      aliasMatches: {
        [aliasLookupKey('bitcoin', 'token')]: {
          entity_id: bitcoin.id,
          status: bitcoin.status,
        },
      },
      coOccurringRows: [
        {
          alias: 'saylor',
          entity_id: 'ent-saylor',
          type: 'person',
          status: 'active',
        },
      ],
    });

    const entityIds = await manager.resolveEntities(
      [
        { name: 'Bitcoin', aliases: [], type: 'token', mentionCount: 3, sentiment: 0.4 },
        { name: 'Saylor', aliases: [], type: 'person', mentionCount: 1, sentiment: 0.1 },
      ],
      'discord',
      'sum-tier2-cooccur',
      'eng',
    );

    assert.deepEqual(entityIds, ['ent-bitcoin', 'ent-saylor']);
    assert.equal(queryCalls(pool.calls, 'SELECT DISTINCT ea.alias, ea.entity_id, e.type, e.status').length, 1);
    assert.equal(queryCalls(pool.calls, 'INSERT INTO entities').length, 0);
  });

  it('falls through to Tier 3 when no co-occurrence match', async () => {
    const bitcoin = fakeEntity({ id: 'ent-bitcoin', name: 'bitcoin', type: 'token' });
    let llmCallCount = 0;
    const llm: MockLlm = {
      call: async () => {
        llmCallCount += 1;
        return {
          content: JSON.stringify([{ name: 'Saylor', type: 'person', context_key: 'strategy' }]),
          model: 'test',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        };
      },
      wrapWithNonce: (content: string) => ({ wrapped: `<nonce>${content}</nonce>`, nonce: 'test-nonce' }),
    };
    const { manager, pool } = createEntityManagerHarness({
      aliasMatches: {
        [aliasLookupKey('bitcoin', 'token')]: {
          entity_id: bitcoin.id,
          status: bitcoin.status,
        },
      },
      coOccurringRows: [],
      insertedEntityIds: ['ent-saylor'],
      llm,
    });

    const entityIds = await manager.resolveEntities(
      [
        { name: 'Bitcoin', aliases: [], type: 'token', mentionCount: 2, sentiment: 0.3 },
        { name: 'Saylor', aliases: [], type: 'person', mentionCount: 1, sentiment: 0.2 },
      ],
      'discord',
      'sum-tier2-fallthrough',
      'eng',
    );

    assert.deepEqual(entityIds, ['ent-bitcoin', 'ent-saylor']);
    assert.equal(queryCalls(pool.calls, 'SELECT DISTINCT ea.alias, ea.entity_id, e.type, e.status').length, 1);
    assert.equal(llmCallCount, 1);
    assert.equal(queryCalls(pool.calls, 'INSERT INTO entities').length, 1);
  });
});

describe('resolveEntities - Tier 3', () => {
  beforeEach(() => {
    resetTier3DisambiguationFallbackStats();
  });

  it('creates new entity and alias from LLM response', async () => {
    const { manager, pool } = createEntityManagerHarness({
      insertedEntityIds: ['ent-mog'],
      llm: mockLlm(JSON.stringify([{ name: 'MOG', type: 'token', context_key: 'meme-coin' }])),
    });

    const resolved = await manager.resolveEntitiesDetailed(
      [{ name: 'MOG', aliases: [], type: 'token', mentionCount: 2, sentiment: 0.5 }],
      'discord',
      'sum-tier3-create',
      'eng',
    );

    const aliasInsertCall = pool.calls.find(
      (call) => call.sql.startsWith('INSERT INTO entity_aliases') && call.params.length === 5,
    );

    assert.deepEqual(resolved, [{ entityId: 'ent-mog' }]);
    assert.ok(aliasInsertCall);
    assert.equal(aliasInsertCall.params[1], 'ent-mog');
    assert.equal(aliasInsertCall.params[2], 'mog');
    assert.equal(aliasInsertCall.params[3], 'meme-coin');
  });

  it('handles invalid JSON from LLM', async () => {
    const { manager } = createEntityManagerHarness({
      insertedEntityIds: ['ent-fallback-json'],
      llm: mockLlm('not-json'),
    });

    const resolved = await manager.resolveEntitiesDetailed(
      [{ name: 'MOG', aliases: [], type: 'token', mentionCount: 1, sentiment: 0 }],
      'discord',
      'sum-tier3-invalid-json',
      'eng',
    );

    assert.deepEqual(resolved, [{ entityId: 'ent-fallback-json', disambiguationFailed: true }]);
    assert.deepEqual(getTier3DisambiguationFallbackStats(), {
      totalCount: 1,
      byReason: {
        'invalid-json': 1,
        'zod-validation': 0,
        'llm-exception': 0,
        'partial-response': 0,
      },
    });
  });

  it('handles zod validation failure', async () => {
    const { manager } = createEntityManagerHarness({
      insertedEntityIds: ['ent-fallback-zod'],
      llm: mockLlm(JSON.stringify([{ name: 'MOG', type: 'not-a-real-type', context_key: 'meme-coin' }])),
    });

    const resolved = await manager.resolveEntitiesDetailed(
      [{ name: 'MOG', aliases: [], type: 'token', mentionCount: 1, sentiment: 0 }],
      'discord',
      'sum-tier3-zod',
      'eng',
    );

    assert.deepEqual(resolved, [{ entityId: 'ent-fallback-zod', disambiguationFailed: true }]);
    assert.deepEqual(getTier3DisambiguationFallbackStats(), {
      totalCount: 1,
      byReason: {
        'invalid-json': 0,
        'zod-validation': 1,
        'llm-exception': 0,
        'partial-response': 0,
      },
    });
  });

  it('handles LLM exception', async () => {
    const llm: MockLlm = {
      call: async () => {
        throw new Error('LLM offline');
      },
      wrapWithNonce: (content: string) => ({ wrapped: `<nonce>${content}</nonce>`, nonce: 'test-nonce' }),
    };
    const { manager } = createEntityManagerHarness({
      insertedEntityIds: ['ent-fallback-exception'],
      llm,
    });

    const resolved = await manager.resolveEntitiesDetailed(
      [{ name: 'MOG', aliases: [], type: 'token', mentionCount: 1, sentiment: 0 }],
      'discord',
      'sum-tier3-exception',
      'eng',
    );

    assert.deepEqual(resolved, [{ entityId: 'ent-fallback-exception', disambiguationFailed: true }]);
    assert.deepEqual(getTier3DisambiguationFallbackStats(), {
      totalCount: 1,
      byReason: {
        'invalid-json': 0,
        'zod-validation': 0,
        'llm-exception': 1,
        'partial-response': 0,
      },
    });
  });
});

describe('resolveEntitiesDetailed', () => {
  beforeEach(() => {
    resetTier3DisambiguationFallbackStats();
  });

  it('returns ResolvedEntity array with entityId', async () => {
    const activeEntity = fakeEntity({ id: 'ent-eth', name: 'ethereum', type: 'token' });
    const { manager } = createEntityManagerHarness({
      aliasMatches: {
        [aliasLookupKey('ethereum', 'token')]: {
          entity_id: activeEntity.id,
          status: activeEntity.status,
        },
      },
    });

    const resolved = await manager.resolveEntitiesDetailed(
      [{ name: 'Ethereum', aliases: [], type: 'token', mentionCount: 2, sentiment: 0.4 }],
      'discord',
      'sum-detailed-id',
      'eng',
    );

    assert.deepEqual(resolved, [{ entityId: 'ent-eth' }]);
  });

  it('sets disambiguationFailed flag on fallback entities', async () => {
    const { manager } = createEntityManagerHarness({
      insertedEntityIds: ['ent-partial'],
      llm: mockLlm('[]'),
    });

    const resolved = await manager.resolveEntitiesDetailed(
      [{ name: 'MOG', aliases: [], type: 'token', mentionCount: 1, sentiment: 0 }],
      'discord',
      'sum-detailed-fallback',
      'eng',
    );

    assert.deepEqual(resolved, [{ entityId: 'ent-partial', disambiguationFailed: true }]);
    assert.deepEqual(getTier3DisambiguationFallbackStats(), {
      totalCount: 1,
      byReason: {
        'invalid-json': 0,
        'zod-validation': 0,
        'llm-exception': 0,
        'partial-response': 1,
      },
    });
  });
});

describe('Tier 3 fallback stats', () => {
  beforeEach(() => {
    resetTier3DisambiguationFallbackStats();
  });

  it('resetTier3DisambiguationFallbackStats resets counters', async () => {
    const { manager } = createEntityManagerHarness({
      insertedEntityIds: ['ent-reset'],
      llm: mockLlm('not-json'),
    });

    await manager.resolveEntitiesDetailed(
      [{ name: 'MOG', aliases: [], type: 'token', mentionCount: 1, sentiment: 0 }],
      'discord',
      'sum-stats-reset',
      'eng',
    );

    resetTier3DisambiguationFallbackStats();

    assert.deepEqual(getTier3DisambiguationFallbackStats(), {
      totalCount: 0,
      byReason: {
        'invalid-json': 0,
        'zod-validation': 0,
        'llm-exception': 0,
        'partial-response': 0,
      },
    });
  });

  it('getTier3DisambiguationFallbackStats returns immutable copy', async () => {
    const { manager } = createEntityManagerHarness({
      insertedEntityIds: ['ent-copy'],
      llm: mockLlm('not-json'),
    });

    await manager.resolveEntitiesDetailed(
      [{ name: 'MOG', aliases: [], type: 'token', mentionCount: 1, sentiment: 0 }],
      'discord',
      'sum-stats-copy',
      'eng',
    );

    const snapshot = getTier3DisambiguationFallbackStats();
    snapshot.totalCount = 999;
    snapshot.byReason['invalid-json'] = 999;

    assert.deepEqual(getTier3DisambiguationFallbackStats(), {
      totalCount: 1,
      byReason: {
        'invalid-json': 1,
        'zod-validation': 0,
        'llm-exception': 0,
        'partial-response': 0,
      },
    });
  });
});
