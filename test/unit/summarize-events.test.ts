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

function makePool(
  items: Array<ReturnType<typeof makeItem>>,
  entityLookupRows: Array<{ id: string; canonical_name: string; alias: string | null }> = [],
  recentEventRows: Array<Record<string, unknown>> = [],
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
      if (text.includes('FROM entities e') && text.includes('LEFT JOIN entity_aliases')) {
        return { rows: entityLookupRows, rowCount: entityLookupRows.length };
      }
      if (text.includes('FROM events') && text.includes('ORDER BY event_time DESC')) {
        return { rows: recentEventRows, rowCount: recentEventRows.length };
      }
      if (text.includes('INSERT INTO events')) {
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

function makeLlmResponse(body: Record<string, unknown>, followUp = false) {
  return {
    call: async (params: { stage: string }) => {
      if (params.stage === 'event-link') {
        return { content: JSON.stringify({ followUp }) };
      }
      return { content: JSON.stringify(body) };
    },
    wrapWithNonce: (content: string) => ({ wrapped: `<nonce>${content}</nonce>`, nonce: 'test' }),
  };
}

const noopEntityManager = {
  resolveEntities: async () => {},
};

describe('summarize: structured event persistence', () => {
  it('persists verified structured events with resolved entity IDs', async () => {
    const pool = makePool(
      [makeItem('Wormhole bridge exploited and Wormhole team paused the bridge.')],
      [{ id: 'ent-wormhole', canonical_name: 'wormhole', alias: 'wormhole' }],
      [],
    );
    const llm = makeLlmResponse({
      summary: 'Wormhole suffered a major bridge exploit and paused operations.',
      urgency: 'breaking',
      confidence: 8,
      entities: [{ name: 'Wormhole', aliases: ['wormhole'], type: 'project', mentionCount: 4, sentiment: -0.9 }],
      keyEvents: ['Wormhole bridge exploited'],
      events: [
        { entityName: 'Wormhole', eventType: 'exploit', description: 'Wormhole bridge exploited for a large amount.' },
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

    const eventInsert = pool.calls.find((call) => call.text.includes('INSERT INTO events'));
    assert.ok(eventInsert, 'Expected an INSERT INTO events query');
    assert.equal(eventInsert!.values[1], 'ent-wormhole');
    assert.equal(eventInsert!.values[2], 'Wormhole');
    assert.equal(eventInsert!.values[3], 'exploit');
    assert.equal(eventInsert!.values[4], 'Wormhole bridge exploited for a large amount.');
    assert.equal(eventInsert!.values[6], 'discord');
    assert.equal(eventInsert!.values[7], 'alerts');
  });

  it('links follow-up events to the prior chain root when the linker agrees', async () => {
    const pool = makePool(
      [makeItem('Wormhole audit results landed after the exploit response.')],
      [{ id: 'ent-wormhole', canonical_name: 'wormhole', alias: 'wormhole' }],
      [
        {
          id: 'evt-prior',
          entity_id: 'ent-wormhole',
          entity_name: 'Wormhole',
          event_type: 'exploit',
          description: 'Wormhole bridge exploited.',
          event_time: 1_699_900_000_000,
          source: 'discord',
          source_id: 'alerts',
          summary_id: 'summary-prior',
          chain_id: 'evt-root',
          created_at: 1_699_900_000_100,
        },
      ],
    );
    const llm = makeLlmResponse(
      {
        summary: 'Wormhole published audit results after the bridge exploit.',
        urgency: 'elevated',
        confidence: 8,
        entities: [{ name: 'Wormhole', aliases: ['wormhole'], type: 'project', mentionCount: 4, sentiment: 0.1 }],
        keyEvents: ['Wormhole audit update published'],
        events: [
          {
            entityName: 'Wormhole',
            eventType: 'audit',
            description: 'Wormhole published audit findings after the exploit.',
          },
        ],
      },
      true,
    );

    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    const result = await summarizer.runBatch('discord', 'alerts', Date.now() - 3600000, Date.now());
    assert.equal(result.summaryCount, 1);

    const eventInsert = pool.calls.find((call) => call.text.includes('INSERT INTO events'));
    assert.ok(eventInsert, 'Expected an INSERT INTO events query');
    assert.equal(eventInsert!.values[9], 'evt-root');
  });

  it('rejects structured events that do not match a declared entity', async () => {
    const pool = makePool([makeItem('Bitcoin is grinding higher on ETF chatter.')], [], []);
    const llm = makeLlmResponse({
      summary: 'Bitcoin moved higher on ETF chatter.',
      urgency: 'routine',
      confidence: 7,
      entities: [{ name: 'Bitcoin', aliases: ['BTC'], type: 'token', mentionCount: 6, sentiment: 0.5 }],
      keyEvents: ['Bitcoin traded higher'],
      events: [{ entityName: 'Wormhole', eventType: 'exploit', description: 'Wormhole was exploited.' }],
    });

    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    const result = await summarizer.runBatch('discord', 'alerts', Date.now() - 3600000, Date.now());
    assert.equal(result.summaryCount, 0);
    assert.ok(!pool.calls.some((call) => call.text.includes('INSERT INTO summaries')));
    assert.ok(!pool.calls.some((call) => call.text.includes('INSERT INTO events')));
  });
});
