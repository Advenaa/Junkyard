import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLLM,
  ContextLengthExceededError,
  LLMHaltedError,
  extractHttpStatus,
  isContextLengthError,
  extractRetryAfter,
  parseModel,
  type LLMCallParams,
  type LLMTestOverrides,
} from '../../src/llm.js';

// ── Mock Helpers ──────────────────────────────────────────────────────

function makeResponse(text: string, overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function makeErrorWithStatus(status: number, message?: string): Error {
  const err = new Error(message ?? `HTTP error ${status}`);
  (err as unknown as Record<string, unknown>)['status'] = status;
  return err;
}

const noopSleep = async (_ms: number): Promise<void> => {};

function makePool(): unknown {
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
  };
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

function makeLLM(completeFn: LLMTestOverrides['completeFn']) {
  return createLLM(
    makePool() as never,
    makeLog() as never,
    makeConfig() as never,
    { completeFn, sleepFn: noopSleep },
  );
}

// ── parseModel ────────────────────────────────────────────────────────

describe('parseModel', () => {
  it('splits provider:model', () => {
    assert.deepEqual(parseModel('anthropic:claude-3-haiku-20240307'), {
      provider: 'anthropic',
      modelId: 'claude-3-haiku-20240307',
    });
  });

  it('defaults to anthropic when no colon', () => {
    assert.deepEqual(parseModel('claude-3-haiku-20240307'), {
      provider: 'anthropic',
      modelId: 'claude-3-haiku-20240307',
    });
  });

  it('handles openai provider', () => {
    assert.deepEqual(parseModel('openai:gpt-4o'), {
      provider: 'openai',
      modelId: 'gpt-4o',
    });
  });

  it('handles model with multiple colons', () => {
    const result = parseModel('google:gemini:1.5-pro');
    assert.equal(result.provider, 'google');
    assert.equal(result.modelId, 'gemini:1.5-pro');
  });
});

// ── extractHttpStatus ─────────────────────────────────────────────────

describe('extractHttpStatus', () => {
  it('extracts status from error.status property', () => {
    const err = new Error('fail');
    (err as unknown as Record<string, unknown>)['status'] = 429;
    assert.equal(extractHttpStatus(err), 429);
  });

  it('extracts status from error.statusCode property', () => {
    const err = new Error('fail');
    (err as unknown as Record<string, unknown>)['statusCode'] = 503;
    assert.equal(extractHttpStatus(err), 503);
  });

  it('extracts status from error message', () => {
    assert.equal(extractHttpStatus(new Error('Request failed with 401 Unauthorized')), 401);
  });

  it('returns null for non-HTTP errors', () => {
    assert.equal(extractHttpStatus(new Error('something went wrong')), null);
  });

  it('returns null for non-Error values', () => {
    assert.equal(extractHttpStatus('string error'), null);
    assert.equal(extractHttpStatus(42), null);
    assert.equal(extractHttpStatus(null), null);
  });
});

// ── isContextLengthError ──────────────────────────────────────────────

describe('isContextLengthError', () => {
  for (const msg of [
    'context length exceeded',
    'Too Many Tokens in request',
    'maximum context window',
    'token limit reached',
  ]) {
    it(`detects "${msg}"`, () => {
      assert.equal(isContextLengthError(new Error(msg)), true);
    });
  }

  it('returns false for unrelated errors', () => {
    assert.equal(isContextLengthError(new Error('rate limited')), false);
  });

  it('returns false for non-Error values', () => {
    assert.equal(isContextLengthError('context length'), false);
  });
});

// ── extractRetryAfter ─────────────────────────────────────────────────

describe('extractRetryAfter', () => {
  it('extracts from retryAfter property', () => {
    const err = new Error('rate limited');
    (err as unknown as Record<string, unknown>)['retryAfter'] = 30;
    assert.equal(extractRetryAfter(err), 30);
  });

  it('extracts from message "retry-after: 60"', () => {
    assert.equal(extractRetryAfter(new Error('retry-after: 60')), 60);
  });

  it('extracts from message "Retry After 120"', () => {
    assert.equal(extractRetryAfter(new Error('Retry After 120')), 120);
  });

  it('returns null when not found', () => {
    assert.equal(extractRetryAfter(new Error('some error')), null);
  });

  it('returns null for non-Error', () => {
    assert.equal(extractRetryAfter(null), null);
  });
});

// ── sanitizeForPrompt ─────────────────────────────────────────────────

describe('sanitizeForPrompt', () => {
  let llm: ReturnType<typeof createLLM>;

  beforeEach(() => {
    llm = makeLLM(async () => makeResponse('ok'));
  });

  it('strips zero-width characters', () => {
    const input = 'he\u200Bllo\u200Cwo\u200Drld\uFEFF\u2060';
    assert.equal(llm.sanitizeForPrompt(input), 'helloworld');
  });

  it('strips RTL/LTR overrides', () => {
    const input = 'hello\u202Aworld\u202E\u2066test\u2069';
    assert.equal(llm.sanitizeForPrompt(input), 'helloworldtest');
  });

  it('applies NFKC normalization', () => {
    // Fullwidth A (U+FF21) normalizes to regular A
    assert.equal(llm.sanitizeForPrompt('\uFF21'), 'A');
  });

  it('escapes angle brackets', () => {
    assert.equal(llm.sanitizeForPrompt('<script>alert("xss")</script>'), '&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  it('handles empty string', () => {
    assert.equal(llm.sanitizeForPrompt(''), '');
  });

  it('handles combined edge cases', () => {
    const input = '<\u200Btag\u200C>';
    assert.equal(llm.sanitizeForPrompt(input), '&lt;tag&gt;');
  });
});

// ── wrapWithNonce ─────────────────────────────────────────────────────

describe('wrapWithNonce', () => {
  let llm: ReturnType<typeof createLLM>;

  beforeEach(() => {
    llm = makeLLM(async () => makeResponse('ok'));
  });

  it('wraps content with nonce-based XML tags', () => {
    const { wrapped, nonce } = llm.wrapWithNonce('test content');
    assert.match(nonce, /^[0-9a-f]{16}$/);
    assert.equal(wrapped, `<scraped_content_${nonce}>test content</scraped_content_${nonce}>`);
  });

  it('sanitizes content before wrapping', () => {
    const { wrapped, nonce } = llm.wrapWithNonce('<injection>');
    assert.ok(wrapped.includes('&lt;injection&gt;'));
    assert.ok(wrapped.startsWith(`<scraped_content_${nonce}>`));
  });

  it('generates unique nonces', () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 50; i++) {
      nonces.add(llm.wrapWithNonce('x').nonce);
    }
    assert.equal(nonces.size, 50, 'all nonces should be unique');
  });
});

// ── estimateTokens ────────────────────────────────────────────────────

describe('estimateTokens', () => {
  let llm: ReturnType<typeof createLLM>;

  beforeEach(() => {
    llm = makeLLM(async () => makeResponse('ok'));
  });

  it('estimates tokens as ceil(length / 4)', () => {
    assert.equal(llm.estimateTokens('hello'), 2); // 5 / 4 = 1.25 → 2
    assert.equal(llm.estimateTokens('hi'), 1);     // 2 / 4 = 0.5 → 1
    assert.equal(llm.estimateTokens('abcd'), 1);   // 4 / 4 = 1 → 1
    assert.equal(llm.estimateTokens('abcde'), 2);  // 5 / 4 = 1.25 → 2
  });

  it('returns 0 for empty string', () => {
    assert.equal(llm.estimateTokens(''), 0);
  });
});

// ── getBudgetHint ─────────────────────────────────────────────────────

describe('getBudgetHint', () => {
  let llm: ReturnType<typeof createLLM>;

  beforeEach(() => {
    llm = makeLLM(async () => makeResponse('ok'));
  });

  it('returns sparse hint for <30% of budget', () => {
    assert.match(llm.getBudgetHint(100, 1000), /sparse/i);
  });

  it('returns concise hint for 30-60% of budget', () => {
    const hint = llm.getBudgetHint(400, 1000);
    assert.match(hint, /concise/i);
  });

  it('returns empty string for >=60% of budget', () => {
    assert.equal(llm.getBudgetHint(700, 1000), '');
  });
});

// ── Retry Logic (call function) ───────────────────────────────────────

describe('call — happy path', () => {
  it('returns content and usage on success', async () => {
    const llm = makeLLM(async () => makeResponse('The market is bullish.'));
    const result = await llm.call(defaultParams());
    assert.equal(result.content, 'The market is bullish.');
    assert.equal(result.usage.input_tokens, 100);
    assert.equal(result.usage.output_tokens, 50);
    assert.equal(result.cost, 0.0015);
  });
});

describe('call — L1: context length exceeded', () => {
  it('throws ContextLengthExceededError without retrying', async () => {
    let callCount = 0;
    const llm = makeLLM(async () => {
      callCount++;
      throw new Error('context length exceeded for this model');
    });

    await assert.rejects(
      () => llm.call(defaultParams()),
      (err: unknown) => {
        assert.ok(err instanceof ContextLengthExceededError);
        return true;
      },
    );
    assert.equal(callCount, 1, 'should not retry on context length error');
  });
});

describe('call — L2: 400 bad request', () => {
  it('throws immediately without retrying', async () => {
    let callCount = 0;
    const llm = makeLLM(async () => {
      callCount++;
      throw makeErrorWithStatus(400, 'bad request 400');
    });

    await assert.rejects(() => llm.call(defaultParams()), { message: 'bad request 400' });
    assert.equal(callCount, 1);
  });
});

describe('call — L3: 401 unauthorized halts all calls', () => {
  it('throws LLMHaltedError on 401', async () => {
    const llm = makeLLM(async () => {
      throw makeErrorWithStatus(401, 'HTTP error 401');
    });

    await assert.rejects(
      () => llm.call(defaultParams()),
      (err: unknown) => {
        assert.ok(err instanceof LLMHaltedError);
        return true;
      },
    );
  });

  it('rejects all subsequent calls after 401', async () => {
    let callCount = 0;
    const llm = makeLLM(async () => {
      callCount++;
      throw makeErrorWithStatus(401, 'HTTP error 401');
    });

    // First call triggers halt
    await assert.rejects(() => llm.call(defaultParams()));
    assert.equal(callCount, 1);

    // Second call should fail immediately without calling completeFn
    await assert.rejects(
      () => llm.call(defaultParams()),
      (err: unknown) => {
        assert.ok(err instanceof LLMHaltedError);
        assert.match((err as Error).message, /halted/i);
        return true;
      },
    );
    assert.equal(callCount, 1, 'completeFn should not be called again after halt');
  });
});

describe('call — L4: 429 rate limit', () => {
  it('retries after 429 and succeeds', async () => {
    let callCount = 0;
    const llm = makeLLM(async () => {
      callCount++;
      if (callCount <= 2) throw makeErrorWithStatus(429, 'rate limited 429');
      return makeResponse('ok after retry');
    });

    const result = await llm.call(defaultParams());
    assert.equal(result.content, 'ok after retry');
    assert.equal(callCount, 3);
  });

  it('exhausts retries and throws on persistent 429', async () => {
    let callCount = 0;
    const llm = makeLLM(async () => {
      callCount++;
      throw makeErrorWithStatus(429, 'rate limited 429');
    });

    await assert.rejects(() => llm.call(defaultParams()), { message: 'rate limited 429' });
    // MAX_RETRIES = 3, loop runs attempt 0..3 = 4 calls total
    assert.equal(callCount, 4);
  });
});

describe('call — L5: 529 overloaded', () => {
  it('retries after 529 and succeeds', async () => {
    let callCount = 0;
    const llm = makeLLM(async () => {
      callCount++;
      if (callCount <= 1) throw makeErrorWithStatus(529, 'overloaded 529');
      return makeResponse('recovered');
    });

    const result = await llm.call(defaultParams());
    assert.equal(result.content, 'recovered');
    assert.equal(callCount, 2);
  });

  it('exhausts retries on persistent 529', async () => {
    let callCount = 0;
    const llm = makeLLM(async () => {
      callCount++;
      throw makeErrorWithStatus(529, 'overloaded 529');
    });

    await assert.rejects(() => llm.call(defaultParams()), { message: 'overloaded 529' });
    assert.equal(callCount, 4);
  });
});

describe('call — L6: 500/502/503 server errors', () => {
  for (const status of [500, 502, 503]) {
    it(`retries on ${status} with exponential backoff and succeeds`, async () => {
      let callCount = 0;
      const llm = makeLLM(async () => {
        callCount++;
        if (callCount <= 2) throw makeErrorWithStatus(status, `server error ${status}`);
        return makeResponse('recovered from server error');
      });

      const result = await llm.call(defaultParams());
      assert.equal(result.content, 'recovered from server error');
      assert.equal(callCount, 3);
    });

    it(`exhausts retries on persistent ${status}`, async () => {
      let callCount = 0;
      const llm = makeLLM(async () => {
        callCount++;
        throw makeErrorWithStatus(status, `server error ${status}`);
      });

      await assert.rejects(() => llm.call(defaultParams()));
      assert.equal(callCount, 4);
    });
  }
});

describe('call — L7: empty response retry', () => {
  it('retries once on empty response and succeeds', async () => {
    let callCount = 0;
    const llm = makeLLM(async () => {
      callCount++;
      if (callCount === 1) return makeResponse('');
      return makeResponse('non-empty on retry');
    });

    const result = await llm.call(defaultParams());
    assert.equal(result.content, 'non-empty on retry');
    assert.equal(callCount, 2);
  });

  it('retries once on whitespace-only response', async () => {
    let callCount = 0;
    const llm = makeLLM(async () => {
      callCount++;
      if (callCount === 1) return makeResponse('   \n\t  ');
      return makeResponse('actual content');
    });

    const result = await llm.call(defaultParams());
    assert.equal(result.content, 'actual content');
    assert.equal(callCount, 2);
  });

  it('accepts empty response on second occurrence (only retries once)', async () => {
    let callCount = 0;
    const llm = makeLLM(async () => {
      callCount++;
      return makeResponse('');
    });

    // Second empty response should be accepted (returns empty string)
    const result = await llm.call(defaultParams());
    assert.equal(result.content, '');
    assert.equal(callCount, 2, 'should only retry empty once');
  });
});

describe('call — L8: refusal', () => {
  it('throws on refusal in stopReason=error response', async () => {
    const llm = makeLLM(async () =>
      makeResponse('', {
        stopReason: 'error',
        errorMessage: 'Content refused by safety filter',
      }),
    );

    await assert.rejects(() => llm.call(defaultParams()), {
      message: /refused/i,
    });
  });

  it('throws on content_filter in stopReason=error response', async () => {
    const llm = makeLLM(async () =>
      makeResponse('', {
        stopReason: 'error',
        errorMessage: 'content_filter triggered',
      }),
    );

    await assert.rejects(() => llm.call(defaultParams()), {
      message: /content_filter/i,
    });
  });

  it('throws on refusal string in thrown error', async () => {
    let callCount = 0;
    const llm = makeLLM(async () => {
      callCount++;
      throw new Error('The model refused to complete the request');
    });

    await assert.rejects(() => llm.call(defaultParams()), {
      message: /refused/i,
    });
    assert.equal(callCount, 1, 'should not retry on refusal');
  });
});

describe('call — unknown errors', () => {
  it('does not retry on unknown errors', async () => {
    let callCount = 0;
    const llm = makeLLM(async () => {
      callCount++;
      throw new Error('some unexpected error');
    });

    await assert.rejects(() => llm.call(defaultParams()), {
      message: 'some unexpected error',
    });
    assert.equal(callCount, 1);
  });
});

describe('call — sleep is called on retries', () => {
  it('calls sleepFn on 429 retries', async () => {
    let sleepCalls: number[] = [];
    let callCount = 0;

    const llm = createLLM(
      makePool() as never,
      makeLog() as never,
      makeConfig() as never,
      {
        completeFn: async () => {
          callCount++;
          if (callCount <= 1) throw makeErrorWithStatus(429, 'rate limited 429');
          return makeResponse('ok');
        },
        sleepFn: async (ms: number) => { sleepCalls.push(ms); },
      },
    );

    await llm.call(defaultParams());
    assert.equal(sleepCalls.length, 1);
    assert.ok(sleepCalls[0]! > 0, 'sleep duration should be positive');
  });

  it('calls sleepFn with exponential backoff on 500', async () => {
    let sleepCalls: number[] = [];
    let callCount = 0;

    const llm = createLLM(
      makePool() as never,
      makeLog() as never,
      makeConfig() as never,
      {
        completeFn: async () => {
          callCount++;
          if (callCount <= 2) throw makeErrorWithStatus(500, 'server error 500');
          return makeResponse('ok');
        },
        sleepFn: async (ms: number) => { sleepCalls.push(ms); },
      },
    );

    await llm.call(defaultParams());
    assert.equal(sleepCalls.length, 2);
    // Backoff base is 2000*2^attempt: attempt 0 → 2000, attempt 1 → 4000
    // With jitter (0.5-1.5x), ranges: [1000,3000] and [2000,6000]
    assert.ok(sleepCalls[0]! >= 1000 && sleepCalls[0]! <= 3000, `first backoff ${sleepCalls[0]} should be ~2000`);
    assert.ok(sleepCalls[1]! >= 2000 && sleepCalls[1]! <= 6000, `second backoff ${sleepCalls[1]} should be ~4000`);
  });
});

describe('call — typed error passthrough', () => {
  it('rethrows ContextLengthExceededError directly', async () => {
    const llm = makeLLM(async () => {
      throw new ContextLengthExceededError('already typed');
    });

    await assert.rejects(
      () => llm.call(defaultParams()),
      (err: unknown) => {
        assert.ok(err instanceof ContextLengthExceededError);
        assert.equal((err as Error).message, 'already typed');
        return true;
      },
    );
  });

  it('rethrows LLMHaltedError directly', async () => {
    const llm = makeLLM(async () => {
      throw new LLMHaltedError('already halted');
    });

    await assert.rejects(
      () => llm.call(defaultParams()),
      (err: unknown) => {
        assert.ok(err instanceof LLMHaltedError);
        return true;
      },
    );
  });
});
