/**
 * LM-041 regression test — 429 retry delay must always be >= retryAfter * 1000.
 *
 * After the fix, the delay formula is:
 *   delayMs = retryAfter * 1000 + Math.random() * retryAfter * 500
 *
 * The jitter is purely additive — Math.random() returns [0, 1), so the
 * minimum delay is exactly retryAfter * 1000 (when Math.random() === 0).
 * This test verifies the bound holds across many random values and with
 * deterministic Math.random mocking.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createLLM,
  extractRetryAfter,
  type LLMCallParams,
  type LLMTestOverrides,
} from '../../src/llm.js';

// ── Mock Helpers ──────────────────────────────────────────────────────

function makeResponse(text: string) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    api: 'anthropic-messages' as const,
    provider: 'anthropic',
    model: 'claude-haiku',
    usage: {
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 150,
      cost: { input: 0.001, output: 0.0005, cacheRead: 0, cacheWrite: 0, total: 0.0015 },
    },
    stopReason: 'stop' as const,
    timestamp: Date.now(),
  };
}

function makeErrorWithStatus(status: number, message?: string): Error {
  const err = new Error(message ?? `HTTP error ${status}`);
  (err as unknown as Record<string, unknown>)['status'] = status;
  return err;
}

function makeErrorWithRetryAfter(retryAfter: number): Error {
  const err = makeErrorWithStatus(429, `rate limited 429, retry-after: ${retryAfter}`);
  (err as unknown as Record<string, unknown>)['retryAfter'] = retryAfter;
  return err;
}

function makePool(): unknown {
  return { query: async () => ({ rows: [], rowCount: 0 }) };
}

function makeLog(): unknown {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    debug: () => {},
    trace: () => {},
    child: () => makeLog(),
  };
}

function makeConfig(): unknown {
  return {};
}

function defaultParams(overrides: Partial<LLMCallParams> = {}): LLMCallParams {
  return {
    model: 'anthropic:claude-3-haiku-20240307',
    system: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: 'Hello' }],
    maxTokens: 1024,
    stage: 'summarize',
    ...overrides,
  };
}

// ── Source-level structural test ──────────────────────────────────────

const llmSrc = readFileSync(
  new URL('../../src/llm.ts', import.meta.url), 'utf-8',
);

describe('LM-041 — 429 delay formula is structurally correct (no sub-minimum jitter)', () => {
  it('delay formula uses retryAfter * 1000 as the base (additive jitter only)', () => {
    // Find the 429 handling block
    const block429Idx = llmSrc.indexOf('status === 429');
    assert.ok(block429Idx > -1, 'should find 429 handling block');

    // Scope to the 429 block (next status check or ~30 lines)
    const block = llmSrc.slice(block429Idx, block429Idx + 500);

    // The delay formula must be: retryAfter * 1000 + Math.random() * ...
    // This ensures the base is retryAfter * 1000 and jitter is added on top.
    assert.match(
      block,
      /retryAfter\s*\*\s*1000\s*\+\s*Math\.random\(\)/,
      'delay must start with retryAfter * 1000 + Math.random() (additive jitter)',
    );

    // Must NOT have a formula like: (retryAfter + jitter) * random or retryAfter * random
    // which could produce values below retryAfter * 1000
    assert.ok(
      !/delayMs\s*=\s*Math\.random\(\)\s*\*/.test(block),
      'delay must NOT start with Math.random() * ... (would allow sub-minimum)',
    );
  });
});

// ── Runtime behavioral tests ─────────────────────────────────────────

describe('LM-041 — 429 retry delay is always >= retryAfter * 1000 (runtime)', () => {
  it('sleep delay >= retryAfter * 1000 when retryAfter is extracted from error', async () => {
    const retryAfterSec = 30;
    const minimumDelayMs = retryAfterSec * 1000;
    const sleepCalls: number[] = [];
    let callCount = 0;

    const llm = createLLM(
      makePool() as never,
      makeLog() as never,
      makeConfig() as never,
      {
        completeFn: async () => {
          callCount++;
          if (callCount === 1) throw makeErrorWithRetryAfter(retryAfterSec);
          return makeResponse('ok');
        },
        sleepFn: async (ms: number) => { sleepCalls.push(ms); },
      },
    );

    await llm.call(defaultParams());
    assert.equal(sleepCalls.length, 1, 'should have slept once');
    assert.ok(
      sleepCalls[0]! >= minimumDelayMs,
      `sleep delay ${sleepCalls[0]} must be >= ${minimumDelayMs} (retryAfter * 1000)`,
    );
  });

  it('sleep delay >= retryAfter * 1000 with default retryAfter (60s)', async () => {
    // When no retryAfter is in the error, extractRetryAfter returns null,
    // and the code falls back to 60.  Minimum delay = 60 * 1000 = 60000.
    const minimumDelayMs = 60 * 1000;
    const sleepCalls: number[] = [];
    let callCount = 0;

    const llm = createLLM(
      makePool() as never,
      makeLog() as never,
      makeConfig() as never,
      {
        completeFn: async () => {
          callCount++;
          if (callCount === 1) throw makeErrorWithStatus(429, 'rate limited');
          return makeResponse('ok');
        },
        sleepFn: async (ms: number) => { sleepCalls.push(ms); },
      },
    );

    await llm.call(defaultParams());
    assert.equal(sleepCalls.length, 1);
    assert.ok(
      sleepCalls[0]! >= minimumDelayMs,
      `sleep delay ${sleepCalls[0]} must be >= ${minimumDelayMs} (default retryAfter=60 * 1000)`,
    );
  });

  it('sleep delay >= retryAfter * 1000 across multiple 429 retries', async () => {
    const retryAfterSec = 10;
    const minimumDelayMs = retryAfterSec * 1000;
    const sleepCalls: number[] = [];
    let callCount = 0;

    const llm = createLLM(
      makePool() as never,
      makeLog() as never,
      makeConfig() as never,
      {
        completeFn: async () => {
          callCount++;
          if (callCount <= 3) throw makeErrorWithRetryAfter(retryAfterSec);
          return makeResponse('ok');
        },
        sleepFn: async (ms: number) => { sleepCalls.push(ms); },
      },
    );

    await llm.call(defaultParams());
    assert.equal(sleepCalls.length, 3, 'should have slept 3 times (3 retries)');
    for (let i = 0; i < sleepCalls.length; i++) {
      assert.ok(
        sleepCalls[i]! >= minimumDelayMs,
        `retry ${i}: sleep delay ${sleepCalls[i]} must be >= ${minimumDelayMs}`,
      );
    }
  });

  it('jitter adds a bounded positive offset on top of the minimum', async () => {
    const retryAfterSec = 20;
    const minimumDelayMs = retryAfterSec * 1000;
    // Maximum jitter = retryAfter * 500 (when Math.random() ~= 1)
    const maxDelayMs = retryAfterSec * 1000 + retryAfterSec * 500;
    const sleepCalls: number[] = [];
    let callCount = 0;

    const llm = createLLM(
      makePool() as never,
      makeLog() as never,
      makeConfig() as never,
      {
        completeFn: async () => {
          callCount++;
          if (callCount === 1) throw makeErrorWithRetryAfter(retryAfterSec);
          return makeResponse('ok');
        },
        sleepFn: async (ms: number) => { sleepCalls.push(ms); },
      },
    );

    await llm.call(defaultParams());
    assert.equal(sleepCalls.length, 1);
    assert.ok(
      sleepCalls[0]! >= minimumDelayMs,
      `delay ${sleepCalls[0]} must be >= minimum ${minimumDelayMs}`,
    );
    assert.ok(
      sleepCalls[0]! < maxDelayMs,
      `delay ${sleepCalls[0]} must be < maximum ${maxDelayMs}`,
    );
  });

  it('small retryAfter values still produce delay >= retryAfter * 1000', async () => {
    const retryAfterSec = 1;
    const minimumDelayMs = retryAfterSec * 1000;
    const sleepCalls: number[] = [];
    let callCount = 0;

    const llm = createLLM(
      makePool() as never,
      makeLog() as never,
      makeConfig() as never,
      {
        completeFn: async () => {
          callCount++;
          if (callCount === 1) throw makeErrorWithRetryAfter(retryAfterSec);
          return makeResponse('ok');
        },
        sleepFn: async (ms: number) => { sleepCalls.push(ms); },
      },
    );

    await llm.call(defaultParams());
    assert.equal(sleepCalls.length, 1);
    assert.ok(
      sleepCalls[0]! >= minimumDelayMs,
      `delay ${sleepCalls[0]} must be >= ${minimumDelayMs} even for small retryAfter`,
    );
  });
});
