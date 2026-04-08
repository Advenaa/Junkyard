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
    models: { haiku: 'haiku-test', sonnet: 'sonnet-test' },
    secrets: [],
  };
}

function makeItem(id: string, author: string, timestamp: number, content: string) {
  return {
    id,
    content,
    author,
    engagement: 3,
    timestamp,
    original_language: null,
  };
}

function makePool(
  items: Array<ReturnType<typeof makeItem>>,
  entityRows: Array<{ id: string; lookup_key: string }> = [],
  aliasRows: Array<{ id: string; lookup_key: string }> = [],
) {
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
      if (text.includes('INSERT INTO authors')) {
        return {
          rows: [
            {
              id: `author-${values?.[2] as string}`,
              platform: values?.[1],
              handle: values?.[2],
              display_name: values?.[3] ?? null,
              first_seen: values?.[4],
              last_seen: values?.[4],
              mention_count: 1,
              credibility_score: null,
              total_calls: 0,
              correct_calls: 0,
              created_at: values?.[5],
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT id, LOWER(name) AS lookup_key')) {
        return { rows: entityRows, rowCount: entityRows.length };
      }
      if (text.includes('SELECT DISTINCT ON (ea.alias)')) {
        return { rows: aliasRows, rowCount: aliasRows.length };
      }
      if (text.includes('INSERT INTO author_calls')) {
        return {
          rows: [
            {
              id: values?.[0],
              author_id: values?.[1],
              entity_id: values?.[2],
              claim_type: values?.[3],
              claim_text: values?.[4],
              confidence: values?.[5],
              source_item_id: values?.[6] ?? null,
              timestamp: values?.[7],
              resolved: false,
              outcome: null,
              resolved_at: null,
              created_at: values?.[8],
            },
          ],
          rowCount: 1,
        };
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
  resolveEntities: async () => [],
};

describe('summarize: author claim persistence', () => {
  it('persists verified author claims with resolved entity IDs and latest source item traceability', async () => {
    const pool = makePool(
      [
        makeItem('item-1', 'TraderX', 1_700_000_000_000, 'Ethereum looks strong here.'),
        makeItem('item-2', 'TraderX', 1_700_000_001_000, 'Still think ETH is ready to break higher soon.'),
      ],
      [{ id: 'ent-eth', lookup_key: 'ethereum' }],
    );
    const llm = makeLlmResponse({
      summary: 'TraderX turned constructive on Ethereum.',
      urgency: 'routine',
      confidence: 7,
      entities: [{ name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 2, sentiment: 0.6 }],
      keyEvents: ['TraderX said Ethereum looked strong'],
      events: [],
      relationships: [],
      authorClaims: [
        {
          authorHandle: 'TraderX',
          entityName: 'Ethereum',
          claimType: 'bullish',
          claimText: 'TraderX said Ethereum looked ready to break higher.',
          confidence: 0.81,
        },
      ],
    });

    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    const result = await summarizer.runBatch('discord', 'alerts', Date.now() - 3600000, Date.now());
    assert.equal(result.summaryCount, 1);

    const callInsert = pool.calls.find((call) => call.text.includes('INSERT INTO author_calls'));
    assert.ok(callInsert, 'Expected an INSERT INTO author_calls query');
    assert.equal(callInsert!.values[1], 'author-traderx');
    assert.equal(callInsert!.values[2], 'ent-eth');
    assert.equal(callInsert!.values[3], 'bullish');
    assert.equal(callInsert!.values[4], 'TraderX said Ethereum looked ready to break higher.');
    assert.equal(callInsert!.values[5], 0.81);
    assert.equal(callInsert!.values[6], 'item-2');
    assert.equal(callInsert!.values[7], 1_700_000_001_000);
  });

  it('skips author claims when the claimed author is not present in the chunk', async () => {
    const pool = makePool(
      [makeItem('item-1', 'TraderX', 1_700_000_000_000, 'Ethereum looks strong here.')],
      [{ id: 'ent-eth', lookup_key: 'ethereum' }],
    );
    const llm = makeLlmResponse({
      summary: 'Ethereum chatter was constructive.',
      urgency: 'routine',
      confidence: 7,
      entities: [{ name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 1, sentiment: 0.4 }],
      keyEvents: ['Ethereum was discussed positively'],
      events: [],
      relationships: [],
      authorClaims: [
        {
          authorHandle: 'OtherTrader',
          entityName: 'Ethereum',
          claimType: 'bullish',
          claimText: 'OtherTrader said Ethereum looked strong.',
          confidence: 0.7,
        },
      ],
    });

    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    const result = await summarizer.runBatch('discord', 'alerts', Date.now() - 3600000, Date.now());
    assert.equal(result.summaryCount, 1);
    assert.ok(!pool.calls.some((call) => call.text.includes('INSERT INTO author_calls')));
  });
});
