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
      async query() {
        return {
          rows: [
            {
              id: 'report-1',
              body: JSON.stringify({
                eventChains: ['Bridge exploit chain stayed active after the governance response.'],
              }),
              created_at: '2026-04-06',
              tldr: 'The exploit timeline remained active through the week.',
              date: '2026-04-06',
              type: 'daily',
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
    assert.equal(result.sources[0]!.label, 'Daily 2026-04-06');
    assert.match(result.sources[0]!.snippet, /Type: daily \| Date: 2026-04-06/);
    assert.match(result.sources[0]!.snippet, /The exploit timeline remained active through the week/);
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
});
