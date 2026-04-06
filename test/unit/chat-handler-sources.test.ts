import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChatHandler } from '../../src/chat/handler.js';
import type { Embedder } from '../../src/chat/tools.js';
import type { SearchResult, VectorCache } from '../../src/vector-cache.js';

const noopLog = {
  info() {},
  debug() {},
  warn() {},
  error() {},
  child() {
    return noopLog;
  },
} as any;

function stubVectorCache(results: SearchResult[]): VectorCache {
  return {
    async load() {},
    async search() {
      return results;
    },
    update() {},
    prune() {
      return 0;
    },
    getSize() {
      return { summaries: 0, reports: 0 };
    },
  };
}

const stubEmbedder: Embedder = {
  async embed() {
    return { vector: new Float32Array([1, 0, 0]) };
  },
  prepareText(text: string, type: 'item' | 'summary' | 'entity' | 'report') {
    return `${type}: ${text}`;
  },
};

describe('createChatHandler sources', () => {
  it('returns report citations from semantic_search report results', async () => {
    const pool = {
      async query(text: string) {
        if (text.includes('FROM reports')) {
          return {
            rows: [
              {
                id: 'report-1',
                body: JSON.stringify({
                  eventChains: ['Bridge exploit chain stayed active after the governance response.'],
                  entitySentiment: [{ name: 'Bridge' }],
                }),
                created_at: String(Date.UTC(2026, 3, 6, 12, 0, 0)),
                tldr: 'The exploit timeline remained active through the week.',
                date: '2026-04-06',
                type: 'daily',
              },
            ],
          };
        }

        if (text.includes('WITH matching_events AS')) {
          return {
            rows: [
              {
                chain_root_id: 'chain-root-1',
                entity_name: 'Bridge',
                event_count: 3,
                first_event_time: Date.UTC(2026, 3, 4, 8, 0, 0),
                latest_event_time: Date.UTC(2026, 3, 6, 9, 30, 0),
                event_types: ['exploit', 'audit', 'governance'],
                latest_summary_id: 'summary-9',
                latest_event_type: 'governance',
                latest_event_description: 'Governance response kept the chain active.',
                total_chain_count: 1,
              },
            ],
          };
        }

        return { rows: [] };
      },
    } as any;

    let chatCall = 0;
    const llm = {
      async call(params: { stage: string }) {
        if (params.stage === 'chat' && chatCall === 0) {
          chatCall++;
          return {
            content:
              '<tool_call>{"name":"semantic_search","args":{"query":"Give me the exploit timeline and what changed over time"}}</tool_call>',
          };
        }

        return {
          content: 'The exploit timeline stayed active into the governance response.',
        };
      },
      wrapWithNonce(content: string) {
        return { wrapped: `<wrapped>${content}</wrapped>`, nonce: 'nonce' };
      },
      sanitizeForPrompt(content: string) {
        return content;
      },
    } as any;

    const handler = createChatHandler(
      pool,
      noopLog,
      { models: { haiku: 'haiku', sonnet: 'sonnet' } } as any,
      llm,
      stubVectorCache([{ targetId: 'report-1', score: 0.91 }]),
      stubEmbedder,
    );

    const result = await handler.handle('Give me the exploit timeline and what changed over time', 'conv-1', 'user-1');

    assert.equal(result.toolsUsed[0], 'semantic_search:report');
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0]!.type, 'report');
    assert.equal(result.sources[0]!.id, 'report-1');
    assert.equal(result.sources[0]!.chainRootId, 'chain-root-1');
    assert.equal(result.sources[0]!.chainLabel, 'Bridge · Governance');
    assert.equal(result.sources[0]!.dateLabel, '2026-04-06');
    assert.equal(result.sources[0]!.label, 'Daily 2026-04-06');
    assert.match(result.sources[0]!.snippet, /Type: daily \| Date: 2026-04-06/);
    assert.match(result.sources[0]!.snippet, /The exploit timeline remained active through the week/);
    assert.doesNotMatch(result.sources[0]!.snippet, /Focused report chain:/);
  });

  it('returns raw item citations from read_raw results', async () => {
    const pool = {
      async query() {
        return {
          rows: [
            {
              id: 'item-1',
              content: 'Original governance reply confirmed remediation steps.',
              author: 'alice',
              created_at: '2026-04-06T08:00:00Z',
            },
          ],
        };
      },
    } as any;

    let chatCall = 0;
    const llm = {
      async call(params: { stage: string }) {
        if (params.stage === 'chat' && chatCall === 0) {
          chatCall++;
          return {
            content: '<tool_call>{"name":"read_raw","args":{"itemId":"item-1"}}</tool_call>',
          };
        }

        return {
          content: 'The original message confirmed remediation steps directly from governance.',
        };
      },
      wrapWithNonce(content: string) {
        return { wrapped: `<wrapped>${content}</wrapped>`, nonce: 'nonce' };
      },
      sanitizeForPrompt(content: string) {
        return content;
      },
    } as any;

    const handler = createChatHandler(
      pool,
      noopLog,
      { models: { haiku: 'haiku', sonnet: 'sonnet' } } as any,
      llm,
      stubVectorCache([]),
      stubEmbedder,
    );

    const result = await handler.handle('Show me the original governance reply', 'conv-2', 'user-2');

    assert.equal(result.toolsUsed[0], 'read_raw');
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0]!.type, 'item');
    assert.equal(result.sources[0]!.id, 'item-1');
    assert.equal(result.sources[0]!.label, 'Item item-1');
    assert.match(result.sources[0]!.snippet, /Original governance reply confirmed remediation steps/);
  });

  it('returns focused summary citations from semantic_search summary results when chain context exists', async () => {
    const pool = {
      async query(text: string) {
        if (text.includes('FROM summaries')) {
          return {
            rows: [
              {
                id: 'summary-1',
                body: 'Governance discussion accelerated around the exploit response.',
                created_at: String(Date.UTC(2026, 3, 6, 9, 5, 0)),
              },
            ],
          };
        }

        if (text.includes('WITH summary_events AS')) {
          return {
            rows: [
              {
                id: 'event-1',
                entity_name: 'Solana',
                event_type: 'governance',
                description: 'Governance discussion accelerated around the exploit response.',
                event_time: Date.UTC(2026, 3, 6, 8, 40, 0),
                summary_id: 'summary-1',
                chain_root_id: 'event-root-1',
                chain_event_count: 3,
                chain_position: 2,
                chain_first_event_time: Date.UTC(2026, 3, 5, 14, 0, 0),
                chain_latest_event_time: Date.UTC(2026, 3, 7, 10, 30, 0),
                chain_event_types: ['exploit', 'audit', 'governance'],
                previous_summary_id: 'summary-older',
                previous_event_type: 'audit',
                previous_event_description: 'Audit prep started after the first exploit disclosure.',
                previous_event_time: Date.UTC(2026, 3, 5, 18, 30, 0),
                next_summary_id: 'summary-newer',
                next_event_type: 'governance',
                next_event_description: 'The next summary tracked governance follow-through on the response.',
                next_event_time: Date.UTC(2026, 3, 7, 10, 30, 0),
              },
            ],
          };
        }

        return { rows: [] };
      },
    } as any;

    let chatCall = 0;
    const llm = {
      async call(params: { stage: string }) {
        if (params.stage === 'chat' && chatCall === 0) {
          chatCall++;
          return {
            content:
              '<tool_call>{"name":"semantic_search","args":{"query":"Show me the governance summary details","type":"summary"}}</tool_call>',
          };
        }

        return {
          content: 'The summary showed governance follow-through around the exploit response.',
        };
      },
      wrapWithNonce(content: string) {
        return { wrapped: `<wrapped>${content}</wrapped>`, nonce: 'nonce' };
      },
      sanitizeForPrompt(content: string) {
        return content;
      },
    } as any;

    const handler = createChatHandler(
      pool,
      noopLog,
      { models: { haiku: 'haiku', sonnet: 'sonnet' } } as any,
      llm,
      stubVectorCache([{ targetId: 'summary-1', score: 0.87 }]),
      stubEmbedder,
    );

    const result = await handler.handle('Show me the governance summary details', 'conv-3', 'user-3');

    assert.equal(result.toolsUsed[0], 'semantic_search:summary');
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0]!.type, 'summary');
    assert.equal(result.sources[0]!.id, 'summary-1');
    assert.equal(result.sources[0]!.chainRootId, 'event-root-1');
    assert.equal(result.sources[0]!.chainLabel, 'Solana · Governance');
    assert.equal(result.sources[0]!.dateLabel, '2026-04-06');
    assert.equal(result.sources[0]!.label, 'Summary summary-');
    assert.match(result.sources[0]!.snippet, /Governance discussion accelerated around the exploit response/);
    assert.doesNotMatch(result.sources[0]!.snippet, /Focused summary chain:/);
  });
});
