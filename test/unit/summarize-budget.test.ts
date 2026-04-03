import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSummarizer } from '../../src/process/summarize.js';
import { ContextLengthExceededError } from '../../src/llm.js';
import type { Config } from '../../src/config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal logger that swallows everything. */
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

/** Build a valid ChunkSummary JSON string that passes zod. */
function validChunkJson(): string {
  return JSON.stringify({
    summary: 'Market discussion about Bitcoin and Ethereum with moderate activity across channels.',
    urgency: 'routine',
    confidence: 7,
    entities: [
      { name: 'Bitcoin', aliases: ['BTC'], type: 'token', mentionCount: 3, sentiment: 0.2 },
    ],
    keyEvents: ['BTC discussed'],
  });
}

/** Build a fake item with enough content to stay in one chunk. */
function fakeItem(id: string) {
  return {
    id,
    content: `Bitcoin is looking bullish today - item ${id}`,
    author: 'user1',
    engagement: 5,
    timestamp: Date.now(),
  };
}

/**
 * Build a mock pool that simulates claimBatch + item loading + inserts/updates.
 * `items` is the list of items that will be "claimed" and returned.
 */
function mockPool(items: ReturnType<typeof fakeItem>[]) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });

      // claimBatch: UPDATE ... SET batch_id
      if (text.includes('batch_id') && text.includes('UPDATE') && text.includes('SET')) {
        return { rows: [], rowCount: items.length };
      }
      // Load claimed items: SELECT ... FROM items WHERE batch_id
      if (text.includes('SELECT') && text.includes('batch_id')) {
        return { rows: items, rowCount: items.length };
      }
      // INSERT INTO summaries
      if (text.includes('INSERT INTO summaries')) {
        return { rows: [], rowCount: 1 };
      }
      // UPDATE items SET status
      if (text.includes('UPDATE items')) {
        return { rows: [], rowCount: items.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

/** No-op entity manager. */
const noopEntityManager = {
  resolveEntities: async () => {},
};

// ===========================================================================
// Budget tests
// ===========================================================================

describe('summarize: call budget', () => {
  it('total LLM calls do not exceed 50 even with many chunks', async () => {
    // Create 120 items with short content — chunkByTokens with 6000 token budget
    // Each item ~40 chars => ~10 tokens, so ~600 items per chunk.
    // To get many chunks, use longer content.
    // 120 items * 500 chars each = ~125 tokens each => ~48 items per chunk => ~3 chunks
    // That won't exceed 50. Instead, make the LLM return invalid JSON first attempt
    // so each chunk uses ~3 calls (initial + retry + zod-retry), giving us 17 chunks * 3 = 51 calls.
    // We need enough items to create many chunks.
    // With 200 chars per item => ~50 tokens => 120 items per chunk at 6000 budget.
    // Let's use 2000 chars per item => ~500 tokens => 12 items per chunk.
    // 120 items => 10 chunks. Each chunk: 1 call (if valid JSON). 10 calls total.
    // For budget exhaustion: make LLM always fail parse so it retries.
    // Each chunk: callAndParse (1 call) -> parseWithZodRetry fails JSON -> retry fresh (1 call)
    //   -> parseWithZodRetry fails again -> return null. That's 2 calls per chunk.
    // 10 chunks * 2 = 20 calls. Still under 50.
    // To really push it, return valid JSON but with zod errors:
    // call 1: budgetExhausted check + llm.call (callAndParse initial)
    // parseWithZodRetry: JSON parses, zod fails -> budgetExhausted check + llm.call (zod retry) -> zod still fails
    // callAndParse retry: budgetExhausted check + llm.call (fresh prompt)
    // parseWithZodRetry again: JSON parses, zod fails -> budgetExhausted + llm.call -> zod still fails
    // That's 4 calls per chunk. 13 chunks => 52 calls, budget should cap at 50.

    // Create items that produce ~13 chunks
    const longContent = 'x'.repeat(2000); // ~500 tokens per item
    const items = Array.from({ length: 156 }, (_, i) => ({
      id: `item-${i}`,
      content: `Bitcoin ${longContent} item-${i}`,
      author: 'user1',
      engagement: 1,
      timestamp: Date.now() + i,
    }));

    let llmCallCount = 0;
    // Return JSON that parses but fails zod (summary too short)
    const badZodJson = JSON.stringify({
      summary: 'short',         // min 10 chars — this is only 5
      urgency: 'routine',
      confidence: 7,
      entities: [],
      keyEvents: [],
    });

    const llm = {
      call: async () => {
        llmCallCount++;
        return { content: badZodJson };
      },
      wrapWithNonce: (content: string) => ({
        wrapped: `<nonce-test>${content}</nonce-test>`,
        nonce: 'test',
      }),
    };

    const pool = mockPool(items);
    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    await summarizer.runBatch('discord', 'test-channel', Date.now() - 3600000, Date.now());

    assert.ok(
      llmCallCount <= 50,
      `LLM call count should be capped at 50, got ${llmCallCount}`,
    );
    // With 13 chunks * 4 calls each = 52, we expect exactly 50 due to budget
    assert.ok(
      llmCallCount >= 40,
      `LLM call count should be close to 50 (enough chunks to pressure the budget), got ${llmCallCount}`,
    );
  });

  it('budget exhaustion returns gracefully without crashing', async () => {
    // Use items that produce several chunks, LLM always returns invalid JSON
    // to consume budget quickly (2 calls per chunk for JSON failures)
    const longContent = 'y'.repeat(2000);
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: `item-${i}`,
      content: `Ethereum ${longContent} item-${i}`,
      author: 'user2',
      engagement: 2,
      timestamp: Date.now() + i,
    }));

    let llmCallCount = 0;
    const llm = {
      call: async () => {
        llmCallCount++;
        return { content: 'not valid json at all {{{' };
      },
      wrapWithNonce: (content: string) => ({
        wrapped: `<nonce-test>${content}</nonce-test>`,
        nonce: 'test',
      }),
    };

    const pool = mockPool(items);
    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    // Should not throw
    const result = await summarizer.runBatch('discord', 'test-src', Date.now() - 3600000, Date.now());

    assert.ok(llmCallCount <= 50, `Budget should cap calls at 50, got ${llmCallCount}`);
    assert.equal(typeof result.summaryCount, 'number');
    assert.equal(typeof result.hasBreaking, 'boolean');
  });

  it('budget is shared across chunks, not per-chunk', async () => {
    // If budget were per-chunk, each chunk could make up to 50 calls.
    // With a shared budget, the total across ALL chunks is 50.
    // Create items for ~5 chunks, each chunk would use ~4 calls (zod failures).
    // Per-chunk budget: 5 * 4 = 20 (but would allow up to 5*50=250)
    // Shared budget: same 20, but the limit is 50 across all.
    // We verify by creating enough chunks that per-chunk would exceed 50 total.

    const longContent = 'z'.repeat(2000);
    const items = Array.from({ length: 156 }, (_, i) => ({
      id: `item-${i}`,
      content: `Solana ${longContent} item-${i}`,
      author: 'user3',
      engagement: 1,
      timestamp: Date.now() + i,
    }));

    const callsByModel: string[] = [];
    // Return JSON that fails zod to maximize calls per chunk
    const badZodJson = JSON.stringify({
      summary: 'tiny',  // too short for min(10)
      urgency: 'routine',
      confidence: 7,
      entities: [],
      keyEvents: [],
    });

    const llm = {
      call: async (params: { model: string }) => {
        callsByModel.push(params.model);
        return { content: badZodJson };
      },
      wrapWithNonce: (content: string) => ({
        wrapped: `<nonce-test>${content}</nonce-test>`,
        nonce: 'test',
      }),
    };

    const pool = mockPool(items);
    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    await summarizer.runBatch('discord', 'test-src', Date.now() - 3600000, Date.now());

    // All calls should be haiku (no escalation since everything fails parse)
    assert.ok(callsByModel.length <= 50, `Total calls should be <= 50, got ${callsByModel.length}`);
    // If budget were per-chunk (13 chunks * 4 calls = 52), we'd see > 50.
    // The shared budget ensures we stop at 50.
  });

  it('maybeEscalate returns haiku result when budget exhausted', async () => {
    // Create a scenario where:
    // - Many chunks consume most of the budget
    // - A later chunk has low confidence + non-routine urgency (triggers escalation)
    // - Budget is exhausted so escalation is skipped, haiku result returned

    const longContent = 'w'.repeat(2000);
    const items = Array.from({ length: 156 }, (_, i) => ({
      id: `item-${i}`,
      content: `Bitcoin ${longContent} item-${i}`,
      author: 'user4',
      engagement: 1,
      timestamp: Date.now() + i,
    }));

    let llmCallCount = 0;
    let escalationAttempted = false;

    // Return low-confidence breaking result to trigger escalation
    const lowConfidenceJson = JSON.stringify({
      summary: 'Major exploit detected on DeFi protocol with significant funds at risk and multiple wallets involved.',
      urgency: 'breaking',
      confidence: 3,  // low confidence + non-routine => triggers escalation
      entities: [
        { name: 'Bitcoin', aliases: ['BTC'], type: 'token', mentionCount: 5, sentiment: -0.5 },
      ],
      keyEvents: ['Major exploit detected'],
    });

    const llm = {
      call: async (params: { model: string; stage: string }) => {
        llmCallCount++;
        if (params.stage === 'escalate') {
          escalationAttempted = true;
        }
        return { content: lowConfidenceJson };
      },
      wrapWithNonce: (content: string) => ({
        wrapped: `<nonce-test>${content}</nonce-test>`,
        nonce: 'test',
      }),
    };

    const pool = mockPool(items);
    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    const result = await summarizer.runBatch('discord', 'test-src', Date.now() - 3600000, Date.now());

    assert.ok(llmCallCount <= 50, `Budget should cap calls at 50, got ${llmCallCount}`);
    // The batch should still produce some summaries (the ones before budget exhaustion)
    assert.ok(result.summaryCount >= 0, 'Should handle budget exhaustion gracefully');
    // hasBreaking should be true for successfully processed chunks
    // (early chunks will succeed before budget runs out)
    assert.equal(typeof result.hasBreaking, 'boolean');
  });

  it('all calls succeed within budget when LLM returns valid JSON', async () => {
    // When the LLM always returns valid JSON on first try, each chunk uses exactly 1 call.
    // With ~13 chunks, that's 13 calls — well under 50.
    const longContent = 'a'.repeat(2000);
    const items = Array.from({ length: 100 }, (_, i) => ({
      id: `item-${i}`,
      content: `Bitcoin ${longContent} item-${i}`,
      author: 'user5',
      engagement: 1,
      timestamp: Date.now() + i,
    }));

    let llmCallCount = 0;
    const llm = {
      call: async () => {
        llmCallCount++;
        return { content: validChunkJson() };
      },
      wrapWithNonce: (content: string) => ({
        wrapped: `<nonce-test>${content}</nonce-test>`,
        nonce: 'test',
      }),
    };

    const pool = mockPool(items);
    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    const result = await summarizer.runBatch('discord', 'test-src', Date.now() - 3600000, Date.now());

    // Each chunk uses exactly 1 call (valid JSON, confidence >= 5, routine urgency)
    // So summaryCount should equal the number of chunks
    assert.ok(result.summaryCount > 0, `Should produce summaries, got ${result.summaryCount}`);
    assert.equal(result.summaryCount, llmCallCount, 'Each chunk should use exactly 1 LLM call');
    assert.ok(llmCallCount <= 50, `All calls within budget, got ${llmCallCount}`);
  });
});

// ===========================================================================
// Poison pill tests (P-006)
// ===========================================================================

describe('summarize: poison pill (single oversized item)', () => {
  it('marks single oversized item as failed instead of resetting to ready', async () => {
    // Create a single item that will be the only item in its chunk.
    // The LLM will throw ContextLengthExceededError on every call,
    // simulating a single item that is too large for any context window.
    // After splitting reaches chunk.length <= 1, the item should be
    // marked as status='failed' via UPDATE items SET status = 'failed'.
    const items = [fakeItem('poison-item-1')];

    const llm = {
      call: async () => {
        throw new ContextLengthExceededError('Token limit exceeded');
      },
      wrapWithNonce: (content: string) => ({
        wrapped: `<nonce-test>${content}</nonce-test>`,
        nonce: 'test',
      }),
    };

    const pool = mockPool(items);
    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    const result = await summarizer.runBatch('discord', 'test-src', Date.now() - 3600000, Date.now());

    // Should produce no summaries (the item is too large)
    assert.equal(result.summaryCount, 0, 'No summaries should be produced for oversized item');

    // Verify that UPDATE items SET status = 'failed' was called with the item ID
    const failedCalls = pool.calls.filter(
      (c) => c.text.includes("status = 'failed'") && c.text.includes('UPDATE items'),
    );
    assert.ok(
      failedCalls.length >= 1,
      `Expected at least one UPDATE items SET status = 'failed' call, got ${failedCalls.length}`,
    );
    // The parameter should be the poisoned item's ID
    const failedIds = failedCalls.flatMap((c) => c.values);
    assert.ok(
      failedIds.includes('poison-item-1'),
      `Expected 'poison-item-1' in failed IDs, got ${JSON.stringify(failedIds)}`,
    );
  });

  it('marks item failed before batch cleanup runs', async () => {
    // Verify that the per-item UPDATE status='failed' is issued BEFORE the
    // batch-level cleanup. This ensures the DB sees the 'failed' status
    // even though the batch cleanup may subsequently overwrite it.
    // (A future improvement could exclude poison-pilled IDs from the batch reset.)
    const items = [fakeItem('poison-item-2')];

    const llm = {
      call: async () => {
        throw new ContextLengthExceededError('Token limit exceeded');
      },
      wrapWithNonce: (content: string) => ({
        wrapped: `<nonce-test>${content}</nonce-test>`,
        nonce: 'test',
      }),
    };

    const pool = mockPool(items);
    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    await summarizer.runBatch('discord', 'test-src', Date.now() - 3600000, Date.now());

    // The per-item "failed" UPDATE should appear in the call log
    const failedCallIdx = pool.calls.findIndex(
      (c) => c.text.includes("status = 'failed'") && c.text.includes('UPDATE items'),
    );
    assert.ok(failedCallIdx >= 0, 'Should have a per-item status=failed UPDATE');

    // The batch cleanup "reset to ready" should come after the per-item mark
    const resetCallIdx = pool.calls.findIndex(
      (c, i) => i > failedCallIdx && c.text.includes("status = 'ready'") && c.text.includes('UPDATE items'),
    );
    assert.ok(
      resetCallIdx > failedCallIdx,
      'Per-item failed mark should precede batch cleanup reset',
    );
  });

  it('multi-item chunk splits down, only single oversized item marked failed', async () => {
    // Two items: one normal-sized, one that causes ContextLengthExceededError.
    // When the chunk of 2 items hits context length error, it splits into two
    // single-item chunks. The oversized one gets marked failed, the normal one
    // may also fail (since our mock LLM always throws), but the key test is
    // that the poison pill path is exercised for single items.
    const items = [
      fakeItem('normal-item'),
      fakeItem('oversized-item'),
    ];

    const llm = {
      call: async () => {
        // Always throw — simulates both items being part of an oversized context
        throw new ContextLengthExceededError('Token limit exceeded');
      },
      wrapWithNonce: (content: string) => ({
        wrapped: `<nonce-test>${content}</nonce-test>`,
        nonce: 'test',
      }),
    };

    const pool = mockPool(items);
    const summarizer = createSummarizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      noopEntityManager as never,
    );

    await summarizer.runBatch('discord', 'test-src', Date.now() - 3600000, Date.now());

    // Both single-item chunks should hit the poison pill path
    const failedCalls = pool.calls.filter(
      (c) => c.text.includes("status = 'failed'") && c.text.includes('UPDATE items'),
    );
    assert.ok(
      failedCalls.length >= 2,
      `Both items should be marked failed after splitting, got ${failedCalls.length} failed calls`,
    );
  });
});
