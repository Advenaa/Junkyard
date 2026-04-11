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

function makeCapturingLog() {
  const warnings: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const log = {
    info: () => {},
    warn: (obj: Record<string, unknown>, msg: string) => {
      warnings.push({ obj, msg });
    },
    error: () => {},
    debug: () => {},
    child: () => log,
  } as never;

  return { log, warnings };
}

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

function makeItem(id: string, content: string) {
  return {
    id,
    content,
    author: 'user1',
    engagement: 5,
    timestamp: 1_700_000_000_000,
    original_language: null,
  };
}

function makePool(items: Array<ReturnType<typeof makeItem>>) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const query = async (text: string, values?: unknown[]) => {
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
            id: values?.[0] ?? 'author-1',
            platform: values?.[1] ?? 'discord',
            handle: values?.[2] ?? 'user1',
            display_name: values?.[3] ?? null,
            first_seen: values?.[4] ?? Date.now(),
            last_seen: values?.[4] ?? Date.now(),
            mention_count: 1,
            created_at: values?.[5] ?? Date.now(),
          },
        ],
        rowCount: 1,
      };
    }
    if (text.includes('UPDATE items')) {
      return { rows: [], rowCount: items.length };
    }
    return { rows: [], rowCount: 0 };
  };

  return {
    calls,
    query,
    connect: async () => ({
      query,
      release: () => {},
    }),
  };
}

function makeLlmResponse(body: Record<string, unknown>) {
  return {
    call: async () => ({ content: JSON.stringify(body) }),
    wrapWithNonce: (content: string) => ({ wrapped: `<nonce>${content}</nonce>`, nonce: 'test' }),
  };
}

describe('summarize: summary transaction', () => {
  it('rolls back the summary when entity resolution throws', async () => {
    const pool = makePool([makeItem('item-1', 'Ethereum discussion with enough signal to summarize.')]);
    const llm = makeLlmResponse({
      summary: 'Ethereum discussion summarized with a declared entity.',
      urgency: 'routine',
      confidence: 7,
      entities: [{ name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 2, sentiment: 0.3 }],
      keyEvents: ['Ethereum was discussed'],
      events: [],
      relationships: [],
      authorClaims: [],
    });
    const entityManager = {
      resolveEntities: async () => {
        throw new Error('entity resolution blew up');
      },
    };

    const summarizer = createSummarizer(pool as never, silentLog, fakeConfig(), llm as never, entityManager as never);

    const result = await summarizer.runBatch('discord', 'alerts', Date.now() - 3_600_000, Date.now());

    assert.equal(result.summaryCount, 0);
    assert.ok(
      pool.calls.some((call) => call.text === 'BEGIN'),
      'Expected summary transaction to begin',
    );
    assert.ok(
      pool.calls.some((call) => call.text.includes('INSERT INTO summaries')),
      'Expected summary insert attempt',
    );
    assert.ok(
      pool.calls.some((call) => call.text === 'ROLLBACK'),
      'Expected transaction rollback on entity failure',
    );
    assert.ok(!pool.calls.some((call) => call.text === 'COMMIT'), 'Failed summary transaction must not commit');
    assert.ok(
      !pool.calls.some((call) => call.text.includes("UPDATE items SET status = 'processed'")),
      'Failed chunk items must not be marked processed',
    );
    assert.ok(
      pool.calls.some((call) => call.text.includes('retry_count = retry_count + 1')),
      'Failed chunk items should be released for retry',
    );
  });

  it('warns when extracted entities all fail to resolve', async () => {
    const { log, warnings } = makeCapturingLog();
    const pool = makePool([makeItem('item-1', 'Ethereum discussion with enough signal to summarize.')]);
    const llm = makeLlmResponse({
      summary: 'Ethereum discussion summarized with a declared entity.',
      urgency: 'routine',
      confidence: 7,
      entities: [{ name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 2, sentiment: 0.3 }],
      keyEvents: ['Ethereum was discussed'],
      events: [],
      relationships: [],
      authorClaims: [],
    });
    const entityManager = {
      resolveEntities: async () => [],
    };

    const summarizer = createSummarizer(pool as never, log, fakeConfig(), llm as never, entityManager as never);

    const result = await summarizer.runBatch('discord', 'alerts', Date.now() - 3_600_000, Date.now());
    const resolutionWarnings = warnings.filter(
      (warning) => warning.msg === 'Summary had extracted entities but all failed to resolve',
    );

    assert.equal(result.summaryCount, 1);
    assert.equal(resolutionWarnings.length, 1);
    assert.deepEqual(resolutionWarnings[0]?.obj.extracted, ['Ethereum']);
    assert.equal(typeof resolutionWarnings[0]?.obj.summaryId, 'string');
  });

  it('does not warn when summarize extracts zero entities', async () => {
    const { log, warnings } = makeCapturingLog();
    const pool = makePool([
      makeItem('item-1', 'Macro discussion with enough signal to summarize, plus extra context on rates and flows.'),
    ]);
    const llm = makeLlmResponse({
      summary: 'Macro discussion summarized without any extracted entities.',
      urgency: 'routine',
      confidence: 6,
      entities: [],
      keyEvents: ['Macro sentiment was mixed'],
      events: [],
      relationships: [],
      authorClaims: [],
    });
    const entityManager = {
      resolveEntities: async () => {
        throw new Error('resolveEntities should not run when there are no extracted entities');
      },
    };

    const summarizer = createSummarizer(pool as never, log, fakeConfig(), llm as never, entityManager as never);

    const result = await summarizer.runBatch('discord', 'alerts', Date.now() - 3_600_000, Date.now());
    const resolutionWarnings = warnings.filter(
      (warning) => warning.msg === 'Summary had extracted entities but all failed to resolve',
    );

    assert.equal(result.summaryCount, 1);
    assert.equal(resolutionWarnings.length, 0);
  });
});
