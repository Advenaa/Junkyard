import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSummarizer } from '../../src/process/summarize.js';
import type { Config } from '../../src/config.js';

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLog,
} as never;

function fakeConfig(): Config {
  return {
    anthropicApiKey: '',
    geminiApiKey: '',
    databaseUrl: '',
    discordClientId: null,
    discordClientSecret: null,
    adminUserIds: [],
    discordTokens: [],
    twitterApiKey: null,
    apiKey: 'test',
    sessionSecret: 'secret',
    port: 3000,
    dataDir: './data',
    publicUrl: null,
    alertWebhookUrl: null,
    models: { normalizer: 'haiku-test', chunk: 'haiku-test', thinkalot: 'sonnet-test' },
    secrets: [],
  };
}

function makeItem(content: string) {
  return {
    id: 'item-1',
    content,
    author: 'user1',
    engagement: 3,
    timestamp: 1_700_000_000_000,
    original_language: null,
  };
}

function makePool(items: Array<ReturnType<typeof makeItem>>) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });

      if (text.includes("SET batch_id = $1, status = 'processing'")) {
        return { rows: [], rowCount: items.length };
      }
      if (text.includes('SELECT') && text.includes('FROM items') && text.includes('batch_id')) {
        return { rows: items, rowCount: items.length };
      }
      if (text.includes('INSERT INTO summaries')) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT id, LOWER(name) AS lookup_key')) {
        return {
          rows: [
            { id: 'ent-aave', lookup_key: 'aave' },
            { id: 'ent-compound', lookup_key: 'compound' },
          ],
          rowCount: 2,
        };
      }
      if (text.includes('SELECT DISTINCT ON (ea.alias)')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO entity_relationships')) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("UPDATE items SET status = 'processed'")) {
        return { rows: [], rowCount: items.length };
      }
      if (text.includes('UPDATE items')) {
        return { rows: [], rowCount: items.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

function makeLlmResponse(body: Record<string, unknown>) {
  return {
    call: async () => ({ content: JSON.stringify(body) }),
    wrapWithNonce: (content: string) => ({ wrapped: `<nonce>${content}</nonce>`, nonce: 'test' }),
  };
}

const noopEntityManager = {
  resolveEntities: async () => {},
};

describe('summarize: inferred relationship persistence', () => {
  it('persists verified inferred relationships after summary creation', async () => {
    const pool = makePool([makeItem('Aave and Compound announced a new liquidity partnership.')]);
    const llm = makeLlmResponse({
      summary: 'Aave and Compound announced a new liquidity partnership.',
      urgency: 'routine',
      confidence: 7,
      entities: [
        { name: 'Aave', aliases: ['AAVE'], type: 'project', mentionCount: 5, sentiment: 0.2 },
        { name: 'Compound', aliases: ['COMP'], type: 'project', mentionCount: 4, sentiment: 0.1 },
      ],
      keyEvents: ['Aave and Compound announced a liquidity partnership'],
      events: [],
      relationships: [
        { entityNameA: 'Aave', entityNameB: 'Compound', relationshipType: 'partnered_with', confidence: 0.82 },
      ],
    });

    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    const result = await summarizer.runBatch('discord', 'defi', Date.now() - 3600000, Date.now());
    assert.equal(result.summaryCount, 1);

    const relationshipInsert = pool.calls.find((call) => call.text.includes('INSERT INTO entity_relationships'));
    const summaryInsert = pool.calls.find((call) => call.text.includes('INSERT INTO summaries'));
    assert.ok(relationshipInsert, 'Expected an INSERT INTO entity_relationships query');
    assert.ok(summaryInsert, 'Expected an INSERT INTO summaries query');
    assert.equal(relationshipInsert!.values[1], 'ent-aave');
    assert.equal(relationshipInsert!.values[2], 'ent-compound');
    assert.equal(relationshipInsert!.values[3], 'partnered_with');
    assert.equal(relationshipInsert!.values[4], 0.82);
    assert.equal(relationshipInsert!.values[5], 'llm_inferred');
    assert.equal(relationshipInsert!.values[6], summaryInsert!.values[0]);
  });

  it('skips inferred relationships when verified entities do not resolve to distinct IDs', async () => {
    const pool = {
      calls: [] as Array<{ text: string; values: unknown[] }>,
      query: async (text: string, values?: unknown[]) => {
        pool.calls.push({ text, values: values ?? [] });
        if (text.includes("SET batch_id = $1, status = 'processing'")) {
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('SELECT') && text.includes('FROM items') && text.includes('batch_id')) {
          return { rows: [makeItem('Aave compared against a missing project')], rowCount: 1 };
        }
        if (text.includes('INSERT INTO summaries')) {
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('SELECT id, LOWER(name) AS lookup_key')) {
          return { rows: [{ id: 'ent-aave', lookup_key: 'aave' }], rowCount: 1 };
        }
        if (text.includes('SELECT DISTINCT ON (ea.alias)')) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes("UPDATE items SET status = 'processed'")) {
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('UPDATE items')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const llm = makeLlmResponse({
      summary: 'Aave was contrasted with an unresolved project.',
      urgency: 'routine',
      confidence: 7,
      entities: [
        { name: 'Aave', aliases: ['AAVE'], type: 'project', mentionCount: 3, sentiment: 0.2 },
        { name: 'Compound', aliases: ['COMP'], type: 'project', mentionCount: 2, sentiment: 0.1 },
      ],
      keyEvents: [],
      events: [],
      relationships: [
        { entityNameA: 'Aave', entityNameB: 'Compound', relationshipType: 'competes_with', confidence: 0.75 },
      ],
    });

    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    const result = await summarizer.runBatch('discord', 'defi', Date.now() - 3600000, Date.now());
    assert.equal(result.summaryCount, 1);
    assert.ok(!pool.calls.some((call) => call.text.includes('INSERT INTO entity_relationships')));
  });
});
