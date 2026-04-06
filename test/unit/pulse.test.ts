import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createPulse } from '../../src/process/pulse.js';
import { MarketReportLLMSchema } from '../../src/process/schemas.js';

// ── Stubs ───────────────────────────────────────────────────────────

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  child: () => noopLog,
} as any;

const baseConfig = {
  models: { haiku: 'haiku-test', sonnet: 'sonnet-test' },
} as any;

const mockSentimentTracker = {
  getMomentumContext: async (_ids: string[]) => [],
};

const mockDivergenceTracker = {
  getDivergence: async (_start: number, _end: number) => [],
};

// ── Helpers ─────────────────────────────────────────────────────────

function makeValidReport() {
  return {
    tldr: 'Market is quiet today, nothing major.',
    keyEvents: ['BTC sideways', 'ETH gas low'],
    marketCatalysts: ['Friday options expiry keeps BTC vol risk elevated.'],
    eventChains: ['Bitcoin exploit chain remains unresolved after the audit follow-up.'],
    entitySentiment: [
      { name: 'Bitcoin', sentiment: 0.2, reason: 'Stable price action' },
      { name: 'Ethereum', sentiment: -0.1, reason: 'Slight dip' },
    ],
    sections: [{ title: 'Crypto', body: 'All quiet on the western front.' }],
    newProjects: [],
  };
}

function makeSummaryBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    summary: 'Bitcoin trading sideways around 60k with low volume.',
    urgency: 'routine',
    entities: [{ name: 'Bitcoin', type: 'token', sentiment: 0.3, mentionCount: 5 }],
    keyEvents: ['BTC consolidation'],
    confidence: 7,
    ...overrides,
  });
}

function makeSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'summary-1',
    source: 'discord',
    source_id: 'defi-general',
    window_start: Date.now() - 2 * 60 * 60 * 1000,
    window_end: Date.now() - 1 * 60 * 60 * 1000,
    body: makeSummaryBody(),
    sentiment: 0.3,
    urgency: 'routine',
    item_count: 10,
    created_at: Date.now() - 1 * 60 * 60 * 1000,
    ...overrides,
  };
}

/** Build a mock pool that returns configurable query results. */
function makePool(
  opts: {
    summaries?: any[];
    priorPulse?: any[];
    existingPulse?: any[];
    appConfig?: any[];
    entityRows?: any[];
    eventSentimentShift?: any[];
    eventChains?: any[];
  } = {},
) {
  return {
    query: async (sql: string, _params?: any[]) => {
      // getSummariesByTimeWindow: SELECT * FROM summaries WHERE created_at >= $1 ...
      if (sql.includes('FROM summaries')) {
        return { rows: opts.summaries ?? [] };
      }
      // getPriorPulse: SELECT body FROM reports WHERE type = 'pulse' ORDER BY created_at DESC LIMIT 1
      if (sql.includes("type = 'pulse'") && sql.includes('ORDER BY')) {
        return { rows: opts.priorPulse ?? [] };
      }
      // Duplicate guard: SELECT id FROM reports WHERE type = 'pulse' AND created_at > $1 LIMIT 1
      if (sql.includes("type = 'pulse'") && sql.includes('created_at >')) {
        return { rows: opts.existingPulse ?? [] };
      }
      // getAppConfig: SELECT value FROM app_config WHERE key = $1
      if (sql.includes('app_config')) {
        return { rows: opts.appConfig ?? [{ value: 'Asia/Jakarta' }] };
      }
      // Entity ID lookup: SELECT id FROM entities WHERE LOWER(name) = ANY($1)
      if (sql.includes('FROM entities')) {
        return { rows: opts.entityRows ?? [] };
      }
      if (sql.includes('FROM entity_mentions')) {
        return {
          rows: opts.eventSentimentShift ?? [
            {
              pre_avg_sentiment: null,
              pre_mention_count: 0,
              post_avg_sentiment: null,
              post_mention_count: 0,
            },
          ],
        };
      }
      if (sql.includes('FROM events') && sql.includes('GROUP BY COALESCE(chain_id, id)')) {
        return { rows: opts.eventChains ?? [] };
      }
      // insertReport: INSERT INTO reports ... RETURNING *
      if (sql.includes('INSERT INTO reports')) {
        return {
          rows: [
            {
              id: 'report-1',
              date: '2024-01-01',
              type: 'pulse',
              body: JSON.stringify(makeValidReport()),
              tldr: makeValidReport().tldr,
              sentiment: 0.3,
              delivery_status: 'pending',
              delivered_at: null,
              created_at: Date.now(),
            },
          ],
        };
      }
      return { rows: [] };
    },
  } as any;
}

function makeLlm(reportOverrides: Record<string, unknown> = {}) {
  const report = { ...makeValidReport(), ...reportOverrides };
  return {
    call: async () => ({ content: JSON.stringify(report) }),
    wrapWithNonce: (content: string) => ({ wrapped: `<nonce>${content}</nonce>`, nonce: 'abc123' }),
  };
}

// ═════════════════════════════════════════════════════════════════════
// All pulse tests — sequential to avoid Date.now() concurrency issues
// ═════════════════════════════════════════════════════════════════════

describe('pulse', { concurrency: 1 }, () => {
  // ═════════════════════════════════════════════════════════════════════
  // MarketReportLLMSchema validation
  // ═════════════════════════════════════════════════════════════════════

  describe('MarketReportLLMSchema', () => {
    it('accepts a valid market report', () => {
      const result = MarketReportLLMSchema.safeParse(makeValidReport());
      assert.ok(result.success);
    });

    it('defaults optional arrays to empty', () => {
      const result = MarketReportLLMSchema.safeParse({ tldr: 'Short update.' });
      assert.ok(result.success);
      assert.deepStrictEqual(result.data!.keyEvents, []);
      assert.deepStrictEqual(result.data!.marketCatalysts, []);
      assert.deepStrictEqual(result.data!.eventChains, []);
      assert.deepStrictEqual(result.data!.entitySentiment, []);
      assert.deepStrictEqual(result.data!.sections, []);
      assert.deepStrictEqual(result.data!.newProjects, []);
    });

    it('rejects sentiment outside -1 to 1', () => {
      const report = makeValidReport();
      report.entitySentiment = [{ name: 'BTC', sentiment: 1.5, reason: 'Too high' }];
      const result = MarketReportLLMSchema.safeParse(report);
      assert.ok(!result.success);
    });

    it('caps keyEvents at max 10', () => {
      const report = makeValidReport();
      report.keyEvents = Array.from({ length: 11 }, (_, i) => `Event ${i}`);
      const result = MarketReportLLMSchema.safeParse(report);
      assert.ok(!result.success);
    });

    it('caps marketCatalysts at max 6', () => {
      const report = makeValidReport();
      report.marketCatalysts = Array.from({ length: 7 }, (_, i) => `Catalyst ${i}`);
      const result = MarketReportLLMSchema.safeParse(report);
      assert.ok(!result.success);
    });

    it('caps eventChains at max 5', () => {
      const report = makeValidReport();
      report.eventChains = Array.from({ length: 6 }, (_, i) => `Chain ${i}`);
      const result = MarketReportLLMSchema.safeParse(report);
      assert.ok(!result.success);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // runPulse — no summaries (quality gate)
  // ═════════════════════════════════════════════════════════════════════

  describe('runPulse — quality gates', () => {
    it('returns null when no summaries exist in the window', async () => {
      const pool = makePool({ summaries: [] });
      const { runPulse } = createPulse(
        pool,
        noopLog,
        baseConfig,
        makeLlm(),
        mockSentimentTracker,
        mockDivergenceTracker,
      );
      const result = await runPulse();
      assert.equal(result, null);
    });

    it('returns null when all summaries fail to parse', async () => {
      const badRow = makeSummaryRow({ body: 'not valid json at all' });
      const pool = makePool({ summaries: [badRow] });
      const { runPulse } = createPulse(
        pool,
        noopLog,
        baseConfig,
        makeLlm(),
        mockSentimentTracker,
        mockDivergenceTracker,
      );
      const result = await runPulse();
      assert.equal(result, null);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // runPulse — successful report generation
  // ═════════════════════════════════════════════════════════════════════

  describe('runPulse — successful generation', () => {
    it('returns a valid ReportRow on success', async () => {
      const pool = makePool({ summaries: [makeSummaryRow()] });
      const { runPulse } = createPulse(
        pool,
        noopLog,
        baseConfig,
        makeLlm(),
        mockSentimentTracker,
        mockDivergenceTracker,
      );
      const result = await runPulse();
      assert.ok(result !== null);
      assert.ok(typeof result!.tldr === 'string');
      assert.ok(typeof result!.id === 'string');
      assert.ok(typeof result!.body === 'string');
      assert.strictEqual(result!.type, 'pulse');
    });

    it('injects upcoming calendar events into the pulse prompt', async () => {
      const llm = {
        calls: [] as unknown[],
        call: async (params: unknown) => {
          llm.calls.push(params);
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: `<nonce>${content}</nonce>`, nonce: 'abc123' }),
      };
      const pool = makePool({ summaries: [makeSummaryRow()] });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker, {
        getRecentEvents: async () => [],
        getUpcomingEvents: async () => [
          {
            id: 'cal-1',
            name: 'ARB token unlock',
            category: 'unlock',
            description: 'Large circulating supply increase expected.',
            recurrenceRule: null,
            nextOccurrence: Date.now() + 12 * 60 * 60 * 1000,
          },
        ],
      });

      const result = await runPulse();
      assert.equal(result?.type, 'pulse');
      const call = llm.calls[0] as { messages: Array<{ content: string }> };
      assert.match(call.messages[0]!.content, /<upcoming_calendar_events>/);
      assert.match(call.messages[0]!.content, /ARB token unlock/);
      assert.match(call.messages[0]!.content, /Large circulating supply increase expected\./);
    });

    it('injects recent calendar events into the pulse prompt', async () => {
      const llm = {
        calls: [] as unknown[],
        call: async (params: unknown) => {
          llm.calls.push(params);
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: `<nonce>${content}</nonce>`, nonce: 'abc123' }),
      };
      const pool = makePool({ summaries: [makeSummaryRow()] });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker, {
        getUpcomingEvents: async () => [],
        getRecentEvents: async () => [
          {
            id: 'cal-2',
            name: 'Token unlock completed',
            category: 'unlock',
            description: 'No meaningful sell pressure followed.',
            recurrenceRule: null,
            nextOccurrence: Date.now() - 2 * 60 * 60 * 1000,
          },
        ],
      });

      const result = await runPulse();
      assert.equal(result?.type, 'pulse');
      const call = llm.calls[0] as { messages: Array<{ content: string }> };
      assert.match(call.messages[0]!.content, /<recent_calendar_events>/);
      assert.match(call.messages[0]!.content, /No meaningful sell pressure followed\./);
    });

    it('injects recent event analysis into the pulse prompt', async () => {
      const llm = {
        calls: [] as unknown[],
        call: async (params: unknown) => {
          llm.calls.push(params);
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: `<nonce>${content}</nonce>`, nonce: 'abc123' }),
      };
      const pool = makePool({
        summaries: [makeSummaryRow()],
        eventSentimentShift: [
          {
            pre_avg_sentiment: -0.1,
            pre_mention_count: 14,
            post_avg_sentiment: 0.25,
            post_mention_count: 7,
          },
        ],
      });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker, {
        getUpcomingEvents: async () => [],
        getRecentEvents: async () => [
          {
            id: 'cal-2',
            name: 'Token unlock completed',
            category: 'unlock',
            description: 'Sell pressure stayed contained.',
            recurrenceRule: null,
            entityId: 'ent-arb',
            entityName: 'Arbitrum',
            nextOccurrence: Date.now() - 2 * 60 * 60 * 1000,
          },
        ],
      });

      const result = await runPulse();
      assert.equal(result?.type, 'pulse');
      const call = llm.calls[0] as { messages: Array<{ content: string }> };
      assert.match(call.messages[0]!.content, /<recent_event_analysis>/);
      assert.match(call.messages[0]!.content, /pre-48h avg=-0\.10 \(14 mentions\)/);
      assert.match(call.messages[0]!.content, /post-so-far avg=0\.25 \(7 mentions\)/);
      assert.match(call.messages[0]!.content, /delta=\+0\.35/);
      assert.match(call.messages[0]!.content, /\[entity: Arbitrum\]/);
    });

    it('injects recent event chains into the pulse prompt', async () => {
      const llm = {
        calls: [] as unknown[],
        call: async (params: unknown) => {
          llm.calls.push(params);
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: `<nonce>${content}</nonce>`, nonce: 'abc123' }),
      };
      const pool = makePool({
        summaries: [makeSummaryRow()],
        entityRows: [{ id: 'ent-btc' }],
        eventChains: [
          {
            chain_root_id: 'evt-root',
            entity_id: 'ent-btc',
            entity_name: 'Bitcoin',
            event_count: 2,
            first_event_time: Date.now() - 4 * 24 * 60 * 60 * 1000,
            latest_event_time: Date.now() - 90 * 60 * 1000,
            event_types: ['hack', 'audit'],
            descriptions: ['Wallet exploit surfaced.', 'Audit update narrowed the blast radius.'],
          },
        ],
      });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);

      const result = await runPulse();
      assert.equal(result?.type, 'pulse');
      const call = llm.calls[0] as { messages: Array<{ content: string }> };
      assert.match(call.messages[0]!.content, /<recent_event_chains>/);
      assert.match(call.messages[0]!.content, /Bitcoin: 2 linked events/);
      assert.match(call.messages[0]!.content, /chain=hack -> audit/);
      assert.match(call.messages[0]!.content, /latest=Audit update narrowed the blast radius\./);
    });

    it('passes correct maxTokens to LLM based on summary count', async () => {
      let capturedMaxTokens = 0;
      const llm = {
        call: async (params: any) => {
          capturedMaxTokens = params.maxTokens;
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'n' }),
      };

      // 2 summaries, routine = 500 tokens (PL-004: raised from 300)
      const rows = [makeSummaryRow({ id: 's1' }), makeSummaryRow({ id: 's2' })];
      const pool = makePool({ summaries: rows });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);
      await runPulse();
      assert.equal(capturedMaxTokens, 500);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Activity-scaled maxTokens
  // ═════════════════════════════════════════════════════════════════════

  describe('runPulse — activity scaling', () => {
    async function runWithSummaries(count: number, urgency = 'routine') {
      let capturedMaxTokens = 0;
      const llm = {
        call: async (params: any) => {
          capturedMaxTokens = params.maxTokens;
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'n' }),
      };

      const rows = Array.from({ length: count }, (_, i) => makeSummaryRow({ id: `s${i}`, urgency }));
      const pool = makePool({ summaries: rows });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);
      await runPulse();
      return capturedMaxTokens;
    }

    it('uses 500 tokens for quiet periods (< 4 summaries, routine)', async () => {
      const tokens = await runWithSummaries(2);
      assert.equal(tokens, 500);
    });

    it('uses 800 tokens for moderate activity (4-10 summaries)', async () => {
      const tokens = await runWithSummaries(5);
      assert.equal(tokens, 800);
    });

    it('uses 1500 tokens for high activity (> 10 summaries)', async () => {
      const tokens = await runWithSummaries(12);
      assert.equal(tokens, 1500);
    });

    it('uses 1500 tokens when breaking urgency is present', async () => {
      const tokens = await runWithSummaries(2, 'breaking');
      assert.equal(tokens, 1500);
    });

    it('uses 800 tokens when elevated urgency is present (even with few summaries)', async () => {
      const tokens = await runWithSummaries(2, 'elevated');
      assert.equal(tokens, 800);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Prior pulse context
  // ═════════════════════════════════════════════════════════════════════

  describe('runPulse — prior pulse handling', () => {
    it('includes prior pulse tldr in the LLM prompt', async () => {
      let capturedMessage = '';
      const llm = {
        call: async (params: any) => {
          capturedMessage = params.messages[0].content;
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'n' }),
      };

      const priorBody = JSON.stringify({
        tldr: 'Markets were bullish earlier.',
        entitySentiment: [{ name: 'Bitcoin', sentiment: 0.8, reason: 'Rally' }],
      });
      const pool = makePool({
        summaries: [makeSummaryRow()],
        priorPulse: [{ body: priorBody }],
      });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);
      await runPulse();
      assert.ok(capturedMessage.includes('Markets were bullish earlier.'));
    });

    it('works correctly when no prior pulse exists', async () => {
      let capturedMessage = '';
      const llm = {
        call: async (params: any) => {
          capturedMessage = params.messages[0].content;
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'n' }),
      };

      const pool = makePool({ summaries: [makeSummaryRow()], priorPulse: [] });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);
      await runPulse();
      assert.ok(!capturedMessage.includes('prior_pulse_tldr'));
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Sentiment drift detection
  // ═════════════════════════════════════════════════════════════════════

  describe('runPulse — sentiment drift', () => {
    it('includes drift flags in prompt when entity sentiment shifts > 0.4', async () => {
      let capturedMessage = '';
      const llm = {
        call: async (params: any) => {
          capturedMessage = params.messages[0].content;
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'n' }),
      };

      // Current summary has Bitcoin at 0.3
      const summaryBody = makeSummaryBody({
        entities: [{ name: 'Bitcoin', type: 'token', sentiment: -0.5, mentionCount: 3 }],
      });
      // Prior pulse had Bitcoin at 0.8 — delta of 1.3
      const priorBody = JSON.stringify({
        tldr: 'BTC pumping.',
        entitySentiment: [{ name: 'Bitcoin', sentiment: 0.8, reason: 'Rally' }],
      });

      const pool = makePool({
        summaries: [makeSummaryRow({ body: summaryBody })],
        priorPulse: [{ body: priorBody }],
      });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);
      await runPulse();
      assert.ok(capturedMessage.includes('sentiment_drift'));
      assert.ok(capturedMessage.includes('Bitcoin'));
    });

    it('does not include drift flags when sentiment change is small', async () => {
      let capturedMessage = '';
      const llm = {
        call: async (params: any) => {
          capturedMessage = params.messages[0].content;
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'n' }),
      };

      // Current: Bitcoin at 0.3, Prior: Bitcoin at 0.2 — delta 0.1
      const priorBody = JSON.stringify({
        tldr: 'Stable.',
        entitySentiment: [{ name: 'Bitcoin', sentiment: 0.2, reason: 'Stable' }],
      });

      const pool = makePool({
        summaries: [makeSummaryRow()],
        priorPulse: [{ body: priorBody }],
      });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);
      await runPulse();
      assert.ok(!capturedMessage.includes('sentiment_drift'));
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Summary cap (P-004)
  // ═════════════════════════════════════════════════════════════════════

  describe('runPulse — summary cap at 50', () => {
    it('caps summaries to 50 when more are returned from DB', async () => {
      let capturedMessage = '';
      const llm = {
        call: async (params: any) => {
          capturedMessage = params.messages[0].content;
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'n' }),
      };

      // Create 60 summaries, each with a unique marker in the body
      const rows = Array.from({ length: 60 }, (_, i) =>
        makeSummaryRow({
          id: `s${i}`,
          body: makeSummaryBody({ summary: `Summary number ${i}` }),
          created_at: Date.now() - (60 - i) * 60 * 1000, // ascending order
        }),
      );
      const pool = makePool({ summaries: rows });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);
      await runPulse();

      // The oldest 10 (indices 0-9) should be trimmed; newest 50 (indices 10-59) kept
      assert.ok(!capturedMessage.includes('Summary number 0'), 'oldest summary should be excluded');
      assert.ok(!capturedMessage.includes('Summary number 9'), 'summary at index 9 should be excluded');
      assert.ok(capturedMessage.includes('Summary number 10'), 'summary at index 10 should be included');
      assert.ok(capturedMessage.includes('Summary number 59'), 'newest summary should be included');
    });

    it('includes all summaries when count is under the cap', async () => {
      let capturedMessage = '';
      const llm = {
        call: async (params: any) => {
          capturedMessage = params.messages[0].content;
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'n' }),
      };

      const rows = Array.from({ length: 10 }, (_, i) =>
        makeSummaryRow({
          id: `s${i}`,
          body: makeSummaryBody({ summary: `Summary number ${i}` }),
        }),
      );
      const pool = makePool({ summaries: rows });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);
      await runPulse();

      // All 10 should be present
      for (let i = 0; i < 10; i++) {
        assert.ok(capturedMessage.includes(`Summary number ${i}`), `summary ${i} should be included`);
      }
    });

    it('includes exactly 50 summaries when given exactly 50', async () => {
      let capturedMessage = '';
      const llm = {
        call: async (params: any) => {
          capturedMessage = params.messages[0].content;
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'n' }),
      };

      const rows = Array.from({ length: 50 }, (_, i) =>
        makeSummaryRow({
          id: `s${i}`,
          body: makeSummaryBody({ summary: `Summary number ${i}` }),
        }),
      );
      const pool = makePool({ summaries: rows });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);
      await runPulse();

      // All 50 should be present (no trimming at boundary)
      assert.ok(capturedMessage.includes('Summary number 0'), 'first summary should be included');
      assert.ok(capturedMessage.includes('Summary number 49'), 'last summary should be included');
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // LLM retry and error handling
  // ═════════════════════════════════════════════════════════════════════

  describe('runPulse — LLM error handling', () => {
    it('retries once on LLM parse failure and succeeds', async () => {
      let callCount = 0;
      const llm = {
        call: async () => {
          callCount++;
          if (callCount === 1) return { content: 'not json' };
          return { content: JSON.stringify(makeValidReport()) };
        },
        wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'n' }),
      };

      const pool = makePool({ summaries: [makeSummaryRow()] });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);
      const result = await runPulse();
      assert.ok(result !== null);
      assert.equal(callCount, 2);
    });

    it('returns null after both LLM attempts fail', async () => {
      const llm = {
        call: async () => ({ content: 'garbage output' }),
        wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'n' }),
      };

      const pool = makePool({ summaries: [makeSummaryRow()] });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);
      const result = await runPulse();
      assert.equal(result, null);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Duplicate guard
  // ═════════════════════════════════════════════════════════════════════

  describe('runPulse — duplicate guard', () => {
    it('returns null if a pulse already exists in this 3-hour window', async () => {
      const pool = makePool({
        summaries: [makeSummaryRow()],
        existingPulse: [{ id: 'existing-pulse-id' }],
      });
      const { runPulse } = createPulse(
        pool,
        noopLog,
        baseConfig,
        makeLlm(),
        mockSentimentTracker,
        mockDivergenceTracker,
      );
      const result = await runPulse();
      assert.equal(result, null);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // LLM response parsing (code fence stripping)
  // ═════════════════════════════════════════════════════════════════════

  describe('runPulse — code fence stripping', () => {
    it('handles LLM response wrapped in code fences', async () => {
      const report = makeValidReport();
      const fencedContent = '```json\n' + JSON.stringify(report) + '\n```';
      const llm = {
        call: async () => ({ content: fencedContent }),
        wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'n' }),
      };

      const pool = makePool({ summaries: [makeSummaryRow()] });
      const { runPulse } = createPulse(pool, noopLog, baseConfig, llm, mockSentimentTracker, mockDivergenceTracker);
      const result = await runPulse();
      assert.ok(result !== null);
      assert.ok(typeof result!.tldr === 'string');
      assert.ok(result!.tldr.length > 0);
    });
  });
}); // end describe('pulse')
