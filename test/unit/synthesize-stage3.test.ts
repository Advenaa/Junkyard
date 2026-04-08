import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSynthesizer } from '../../src/process/synthesize.js';
import type { Config } from '../../src/config.js';

// ---------------------------------------------------------------------------
// Helpers: minimal mocks (following auth.test.ts pattern)
// ---------------------------------------------------------------------------

/** Build a mock Pool whose .query() returns the given rows/rowCount. */
function mockPool(responses: Array<{ rows?: unknown[]; rowCount?: number }> = []) {
  let callIndex = 0;
  const calls: Array<{ text: string; values: unknown[] }> = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      const resp = responses[callIndex] ?? { rows: [], rowCount: 0 };
      callIndex++;
      return { rows: resp.rows ?? [], rowCount: resp.rowCount ?? 0 };
    },
  };
}

/** Minimal logger that swallows everything. */
const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLog,
} as never;

/** Partial Config for synthesizer tests. */
function fakeConfig(overrides: Partial<Config> = {}): Config {
  return {
    anthropicApiKey: '',
    geminiApiKey: '',
    databaseUrl: '',
    discordClientId: null,
    discordClientSecret: null,
    adminUserIds: [],
    discordTokens: [],
    twitterApiKey: null,
    apiKey: 'test-api-key',
    sessionSecret: 'secret',
    port: 3000,
    dataDir: './data',
    publicUrl: null,
    alertWebhookUrl: null,
    models: { haiku: 'haiku-test', sonnet: 'sonnet-test' },
    secrets: [],
    ...overrides,
  };
}

/** Build a valid parsed summary body (JSON string). */
function makeSummaryBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: 'BTC rallied to 70k on ETF inflows',
    urgency: 'routine',
    entities: [{ name: 'Bitcoin', type: 'token', sentiment: 0.6, mentionCount: 5 }],
    keyEvents: ['BTC breaks 70k resistance'],
    confidence: 0.85,
    ...overrides,
  });
}

/** Build a SummaryRow with reasonable defaults. */
function makeSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'summary-1',
    source: 'discord',
    source_id: 'src-1',
    window_start: Date.now() - 3600000,
    window_end: Date.now(),
    body: makeSummaryBody(),
    sentiment: 0.5,
    urgency: 'routine',
    item_count: 10,
    created_at: Date.now(),
    ...overrides,
  };
}

/** Build a valid MarketReport JSON string (LLM response). */
function makeReportJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tldr: 'Bitcoin rallied on ETF flows. Market sentiment is bullish.',
    keyEvents: ['BTC breaks 70k', 'ETF inflows hit record'],
    marketCatalysts: ['Friday options expiry remains the next volatility check.'],
    eventChains: ['Bitcoin exploit chain: audit follow-up kept the recovery narrative alive.'],
    entitySentiment: [{ name: 'Bitcoin', sentiment: 0.7, reason: 'ETF demand' }],
    sections: [{ title: 'ETF Impact', body: 'Analysis of the ETF-driven rally.' }],
    newProjects: [],
    ...overrides,
  });
}

/**
 * Build standard mock pool responses for runDaily.
 * Query order: getAppConfig, dailyReportExists, getSummariesByTimeWindow,
 *              getYesterdayTldr, narratives, chain entity lookup, recent event chains,
 *              getUnusualActivityOverview(latest date), latest macro snapshots,
 *              insertReport, insertMacroRegime
 */
function dailyPoolResponses(
  summaryRows: unknown[],
  opts: { timezone?: string; alreadyExists?: boolean; yesterdayTldr?: string | null } = {},
) {
  return [
    { rows: [{ value: opts.timezone ?? 'UTC' }] }, // getAppConfig(timezone)
    { rows: [{ exists: opts.alreadyExists ?? false }] }, // dailyReportExists
    { rows: summaryRows }, // getSummariesByTimeWindow
    { rows: opts.yesterdayTldr ? [{ tldr: opts.yesterdayTldr }] : [] }, // getYesterdayTldr
    { rows: [] }, // narratives query
    { rows: [] }, // chain entity lookup
    { rows: [] }, // recent event chains query
    { rows: [{ latest_date: null }] }, // getUnusualActivityOverview -> no daily rollup yet
    { rows: [] }, // latest macro snapshots query
    {
      rows: [
        {
          // insertReport RETURNING *
          id: 'report-1',
          date: '2024-01-01',
          type: 'daily',
          body: makeReportJson(),
          tldr: 'Bitcoin rallied on ETF flows. Market sentiment is bullish.',
          sentiment: 0.7,
          delivery_status: 'pending',
          delivered_at: null,
          created_at: Date.now(),
        },
      ],
    },
    { rows: [], rowCount: 1 }, // insertMacroRegime
  ];
}

/** Build a mock correlator that returns empty results by default. */
function mockCorrelator(correlated: unknown[] = [], shouldFlash = false) {
  return {
    run: async () => ({ correlated, shouldFlash }),
  };
}

/** Build a mock sentiment tracker that returns empty momentum by default. */
function mockSentimentTracker(momentum: unknown[] = []) {
  return {
    runDaily: async () => {},
    getMomentumContext: async () => momentum,
  };
}

function mockDivergenceTracker(divergence: unknown[] = []) {
  return {
    getDivergence: async () => divergence,
  };
}

function mockCalendarTracker(events: unknown[] = []) {
  return {
    getUpcomingEvents: async () => events,
    getRecentEvents: async () => [],
  };
}

/** Build a mock LLM that returns a given response. */
function mockLlm(response: string = makeReportJson()) {
  const calls: unknown[] = [];
  return {
    calls,
    call: async (params: unknown) => {
      calls.push(params);
      return { content: response };
    },
    wrapWithNonce: (content: string) => ({
      wrapped: `<nonce-abc>${content}</nonce-abc>`,
      nonce: 'abc',
    }),
  };
}

// ===========================================================================
// runDaily — skips when report already exists
// ===========================================================================

describe('synthesize: runDaily', () => {
  it('skips when daily report already exists', async () => {
    const pool = mockPool([{ rows: [{ value: 'Asia/Jakarta' }] }, { rows: [{ exists: true }] }]);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      mockLlm() as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runDaily();
    assert.strictEqual(result, null);
  });

  it('generates quiet-day report when no summaries found in the time window', async () => {
    const pool = mockPool(dailyPoolResponses([]));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      mockLlm() as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runDaily();
    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.type, 'daily');
  });

  it('injects upcoming calendar events into the daily synthesis prompt', async () => {
    const pool = mockPool(dailyPoolResponses([makeSummaryRow()]));
    const llm = mockLlm();
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
      mockCalendarTracker([
        {
          id: 'cal-1',
          name: 'FOMC rate decision',
          category: 'macro',
          description: 'Market expects a hawkish hold.',
          recurrenceRule: null,
          nextOccurrence: Date.now() + 6 * 60 * 60 * 1000,
        },
      ]) as never,
    );

    const result = await synth.runDaily();
    assert.notStrictEqual(result, null);
    const call = llm.calls[0] as { messages: Array<{ content: string }> };
    assert.match(call.messages[0]!.content, /<upcoming_calendar_events>/);
    assert.match(call.messages[0]!.content, /FOMC rate decision/);
    assert.match(call.messages[0]!.content, /Market expects a hawkish hold\./);
  });

  it('injects recent calendar events into the daily synthesis prompt', async () => {
    const responses = dailyPoolResponses([makeSummaryRow()]);
    responses.splice(5, 0, {
      rows: [
        {
          pre_avg_sentiment: null,
          pre_mention_count: 0,
          post_avg_sentiment: null,
          post_mention_count: 0,
        },
      ],
    });
    const pool = mockPool(responses);
    const llm = mockLlm();
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
      {
        getUpcomingEvents: async () => [],
        getRecentEvents: async () => [
          {
            id: 'cal-1',
            name: 'FOMC rate decision',
            category: 'macro',
            description: 'The event passed without a surprise hike.',
            recurrenceRule: null,
            nextOccurrence: Date.now() - 3 * 60 * 60 * 1000,
          },
        ],
      } as never,
    );

    const result = await synth.runDaily();
    assert.notStrictEqual(result, null);
    const call = llm.calls[0] as { messages: Array<{ content: string }> };
    assert.match(call.messages[0]!.content, /<recent_calendar_events>/);
    assert.match(call.messages[0]!.content, /The event passed without a surprise hike\./);
  });

  it('injects recent event analysis into the daily synthesis prompt', async () => {
    const responses = dailyPoolResponses([makeSummaryRow()]);
    responses.splice(5, 0, {
      rows: [
        {
          pre_avg_sentiment: 0.2,
          pre_mention_count: 12,
          post_avg_sentiment: 0.55,
          post_mention_count: 9,
        },
      ],
    });
    const pool = mockPool(responses);
    const llm = mockLlm();
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
      {
        getUpcomingEvents: async () => [],
        getRecentEvents: async () => [
          {
            id: 'cal-1',
            name: 'FOMC rate decision',
            category: 'macro',
            description: 'Macro catalyst just passed.',
            recurrenceRule: null,
            entityId: 'ent-btc',
            entityName: 'Bitcoin',
            nextOccurrence: Date.now() - 3 * 60 * 60 * 1000,
          },
        ],
      } as never,
    );

    const result = await synth.runDaily();
    assert.notStrictEqual(result, null);
    const call = llm.calls[0] as { messages: Array<{ content: string }> };
    assert.match(call.messages[0]!.content, /<recent_event_analysis>/);
    assert.match(call.messages[0]!.content, /pre-48h avg=0\.20 \(12 mentions\)/);
    assert.match(call.messages[0]!.content, /post-so-far avg=0\.55 \(9 mentions\)/);
    assert.match(call.messages[0]!.content, /delta=\+0\.35/);
    assert.match(call.messages[0]!.content, /\[entity: Bitcoin\]/);
  });

  it('injects recent event chains into the daily synthesis prompt', async () => {
    const responses = dailyPoolResponses([makeSummaryRow()]);
    responses[5] = { rows: [{ id: 'ent-btc' }] };
    responses[6] = {
      rows: [
        {
          chain_root_id: 'evt-root',
          entity_id: 'ent-btc',
          entity_name: 'Bitcoin',
          event_count: 3,
          first_event_time: Date.now() - 5 * 24 * 60 * 60 * 1000,
          latest_event_time: Date.now() - 2 * 60 * 60 * 1000,
          event_types: ['exploit', 'audit', 'governance'],
          descriptions: [
            'Bridge exploit disclosed.',
            'Audit remediation update published.',
            'Governance vote opened on the response plan.',
          ],
        },
      ],
    };
    const pool = mockPool(responses);
    const llm = mockLlm();
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );

    const result = await synth.runDaily();
    assert.notStrictEqual(result, null);
    const call = llm.calls[0] as { messages: Array<{ content: string }> };
    assert.match(call.messages[0]!.content, /<recent_event_chains>/);
    assert.match(call.messages[0]!.content, /Bitcoin: 3 linked events/);
    assert.match(call.messages[0]!.content, /chain=exploit -> audit -> governance/);
    assert.match(call.messages[0]!.content, /latest=Governance vote opened on the response plan\./);
  });

  it('injects macro context into the daily synthesis prompt', async () => {
    const responses = dailyPoolResponses([makeSummaryRow()]);
    responses[8] = {
      rows: [
        {
          id: 'macro-vix',
          date: '2026-04-08',
          indicator: 'vix',
          value: 22.4,
          change_1d: 1.2,
          change_7d: 4.6,
          source: 'fred',
          created_at: Date.now(),
        },
        {
          id: 'macro-spx',
          date: '2026-04-08',
          indicator: 'spx',
          value: 5234.6,
          change_1d: -35.4,
          change_7d: -102.1,
          source: 'fred',
          created_at: Date.now(),
        },
        {
          id: 'macro-gold',
          date: '2026-04-08',
          indicator: 'gold',
          value: 2331.45,
          change_1d: 18.2,
          change_7d: 44.6,
          source: 'fred',
          created_at: Date.now(),
        },
      ],
    };
    const pool = mockPool(responses);
    const llm = mockLlm();
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );

    const result = await synth.runDaily();
    assert.notStrictEqual(result, null);
    const call = llm.calls[0] as { messages: Array<{ content: string }> };
    assert.match(call.messages[0]!.content, /<macro_context>/);
    assert.match(call.messages[0]!.content, /macro bias: risk-off/i);
    assert.match(call.messages[0]!.content, /crypto sentiment: bullish/i);
    assert.match(call.messages[0]!.content, /VIX/);
    assert.match(call.messages[0]!.content, /S&P 500/);
    assert.match(call.messages[0]!.content, /Gold/);
  });

  it('persists daily macro regime history when the report includes macroRegime', async () => {
    const pool = mockPool(dailyPoolResponses([makeSummaryRow()]));
    const llm = mockLlm(
      makeReportJson({
        macroRegime: {
          classification: 'risk-off',
          confidence: 0.82,
          rationale: 'Dollar, yields, and gold all leaned defensive while crypto breadth stayed mixed.',
        },
      }),
    );
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );

    const result = await synth.runDaily();
    assert.notStrictEqual(result, null);
    assert.ok(pool.calls.some((call) => call.text.includes('INSERT INTO macro_regimes')));
  });

  it('skips when all summary bodies fail to parse', async () => {
    const badRow = makeSummaryRow({ body: 'not-json{{{' });
    const pool = mockPool(dailyPoolResponses([badRow]));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      mockLlm() as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runDaily();
    assert.strictEqual(result, null);
  });

  it('produces a report with valid summaries', async () => {
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const llm = mockLlm();
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runDaily();

    assert.notStrictEqual(result, null);
    assert.ok(typeof result!.tldr === 'string');
    assert.ok(result!.tldr.length > 0);
    assert.strictEqual(result!.type, 'daily');
    assert.ok(llm.calls.length >= 1, 'LLM should have been called at least once');
  });

  it('calls LLM with sonnet model', async () => {
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const llm = mockLlm();
    const config = fakeConfig({ models: { haiku: 'h', sonnet: 'my-sonnet-model' } });
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      config,
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    const llmCall = llm.calls[0] as Record<string, unknown>;
    assert.strictEqual(llmCall.model, 'my-sonnet-model');
    assert.strictEqual(llmCall.stage, 'synthesize');
  });

  it('retries malformed daily JSON without changing the original prompt payload', async () => {
    const llmCalls: Array<{ system: string; messages: Array<{ content: string }> }> = [];
    let callCount = 0;
    const llm = {
      call: async (params: { system: string; messages: Array<{ content: string }> }) => {
        llmCalls.push(params);
        callCount++;
        if (callCount === 1) return { content: 'not valid json!!!' };
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runDaily();

    assert.strictEqual(callCount, 2, 'Should have retried once');
    assert.notStrictEqual(result, null);
    assert.strictEqual(
      llmCalls[1]!.system,
      llmCalls[0]!.system,
      'Malformed JSON retries should reuse the original system prompt',
    );
    assert.ok(
      !/validation errors/i.test(llmCalls[1]!.system),
      'Malformed JSON retries should not append schema-validation feedback',
    );
    assert.strictEqual(
      llmCalls[1]!.messages[0]!.content,
      llmCalls[0]!.messages[0]!.content,
      'Malformed JSON retries should preserve the original wrapped user payload',
    );
  });

  it('retries once with validation feedback when the daily report JSON fails schema validation', async () => {
    const llmCalls: Array<{ system: string; messages: Array<{ content: string }> }> = [];
    let callCount = 0;
    const llm = {
      call: async (params: { system: string; messages: Array<{ content: string }> }) => {
        llmCalls.push(params);
        callCount++;
        if (callCount === 1) {
          return { content: makeReportJson({ tldr: 123 }) };
        }
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runDaily();

    assert.strictEqual(callCount, 2, 'Should retry once after schema validation failure');
    assert.notStrictEqual(result, null);
    assert.match(llmCalls[1]!.system, /validation errors/i);
    assert.match(llmCalls[1]!.system, /tldr/);
    assert.strictEqual(
      llmCalls[1]!.messages[0]!.content,
      llmCalls[0]!.messages[0]!.content,
      'Schema-guided retries should preserve the original wrapped user payload',
    );
  });

  it('retries once with validation feedback when the daily report contains a whitespace-only catalyst line', async () => {
    const llmCalls: Array<{ system: string }> = [];
    let callCount = 0;
    const llm = {
      call: async (params: { system: string }) => {
        llmCalls.push(params);
        callCount++;
        if (callCount === 1) {
          return { content: makeReportJson({ marketCatalysts: ['   '] }) };
        }
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runDaily();

    assert.strictEqual(callCount, 2, 'Should retry once after blank-string validation failure');
    assert.notStrictEqual(result, null);
    assert.match(llmCalls[1]!.system, /validation errors/i);
    assert.match(llmCalls[1]!.system, /marketCatalysts\.0/);
  });

  it('returns null when both LLM attempts fail', async () => {
    const llm = {
      call: async () => ({ content: '<<<broken>>>' }),
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runDaily();
    assert.strictEqual(result, null);
  });

  it('uses Asia/Jakarta as default timezone when config missing', async () => {
    const pool = mockPool([
      { rows: [] }, // getAppConfig → null (defaults to Asia/Jakarta)
      { rows: [{ exists: false }] }, // dailyReportExists
      { rows: [] }, // getSummariesByTimeWindow → empty (quiet day)
      { rows: [] }, // getYesterdayTldr
      { rows: [] }, // narratives query
      { rows: [] }, // chain entity lookup
      { rows: [] }, // recent event chains query
      { rows: [{ latest_date: null }] }, // getUnusualActivityOverview -> no daily rollup yet
      { rows: [] }, // latest macro snapshots query
      {
        rows: [
          {
            // insertReport RETURNING *
            id: 'report-tz',
            date: '2024-01-01',
            type: 'daily',
            body: makeReportJson(),
            tldr: 'Quiet day.',
            sentiment: null,
            delivery_status: 'pending',
            delivered_at: null,
            created_at: Date.now(),
          },
        ],
      },
    ]);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      mockLlm() as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runDaily();
    // Quiet day still produces a report (not null)
    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.type, 'daily');
  });
});

// ===========================================================================
// runFlash — flash report trigger logic
// ===========================================================================

describe('synthesize: runFlash', () => {
  it('skips when no correlated entities provided', async () => {
    const pool = mockPool([]);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      mockLlm() as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runFlash([]);
    assert.strictEqual(result, null);
  });

  it('skips when no recent summaries exist', async () => {
    const entity = {
      entityName: 'Bitcoin',
      sources: [{ source: 'discord', sourceId: 'src-1', trustWeight: 1 }],
      weightedSum: 5.0,
      urgency: 'breaking',
    };
    const pool = mockPool([
      { rows: [] }, // getSummariesByTimeWindow → empty
    ]);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      mockLlm() as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runFlash([entity]);
    assert.strictEqual(result, null);
  });

  it('skips when summaries parse but none mention correlated entities', async () => {
    const entity = {
      entityName: 'Solana',
      sources: [{ source: 'twitter', sourceId: 'src-2', trustWeight: 1 }],
      weightedSum: 4.0,
      urgency: 'breaking',
    };
    // Summary mentions Bitcoin, not Solana
    const row = makeSummaryRow({
      body: makeSummaryBody({
        entities: [{ name: 'Bitcoin', type: 'token', sentiment: 0.3, mentionCount: 2 }],
      }),
    });
    const pool = mockPool([
      { rows: [row] }, // getSummariesByTimeWindow
    ]);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      mockLlm() as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runFlash([entity]);
    assert.strictEqual(result, null);
  });

  it('produces a flash report when entities match summaries', async () => {
    const entity = {
      entityName: 'Bitcoin',
      sources: [{ source: 'discord', sourceId: 'src-1', trustWeight: 1 }],
      weightedSum: 6.0,
      urgency: 'breaking',
    };
    const row = makeSummaryRow();
    const pool = mockPool([
      { rows: [row] }, // getSummariesByTimeWindow
      { rows: [] }, // flash duplicate check (created_at > fourHoursAgo)
      { rows: [{ value: 'UTC' }] }, // getAppConfig(timezone) for dateString
      {
        rows: [
          {
            // insertReport RETURNING *
            id: 'report-2',
            date: '2024-01-01',
            type: 'flash',
            body: makeReportJson(),
            tldr: 'Bitcoin rallied on ETF flows. Market sentiment is bullish.',
            sentiment: 0.7,
            delivery_status: 'pending',
            delivered_at: null,
            created_at: Date.now(),
          },
        ],
      },
    ]);
    const llm = mockLlm();
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runFlash([entity]);

    assert.notStrictEqual(result, null);
    assert.ok(typeof result!.tldr === 'string');
    assert.strictEqual(result!.type, 'flash');
  });

  it('matches entity names case-insensitively', async () => {
    const entity = {
      entityName: 'BITCOIN', // uppercase
      sources: [{ source: 'discord', sourceId: 'src-1', trustWeight: 1 }],
      weightedSum: 6.0,
      urgency: 'breaking',
    };
    // Summary has "Bitcoin" (title case)
    const row = makeSummaryRow();
    const pool = mockPool([
      { rows: [row] },
      { rows: [] },
      { rows: [{ value: 'UTC' }] },
      {
        rows: [
          {
            id: 'report-3',
            date: '2024-01-01',
            type: 'flash',
            body: makeReportJson(),
            tldr: 'Bitcoin rallied on ETF flows. Market sentiment is bullish.',
            sentiment: 0.7,
            delivery_status: 'pending',
            delivered_at: null,
            created_at: Date.now(),
          },
        ],
      },
    ]);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      mockLlm() as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runFlash([entity]);
    assert.notStrictEqual(result, null);
  });

  it('skips when flash report already exists in last 4h', async () => {
    const entity = {
      entityName: 'Bitcoin',
      sources: [{ source: 'discord', sourceId: 'src-1', trustWeight: 1 }],
      weightedSum: 6.0,
      urgency: 'breaking',
    };
    const row = makeSummaryRow();
    const pool = mockPool([
      { rows: [row] }, // getSummariesByTimeWindow
      { rows: [{ id: 'existing-flash' }] }, // flash duplicate check (created_at > fourHoursAgo) → exists
    ]);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      mockLlm() as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runFlash([entity]);
    assert.strictEqual(result, null);
  });

  it('retries once on LLM parse failure for flash', async () => {
    let callCount = 0;
    const llm = {
      call: async () => {
        callCount++;
        if (callCount === 1) return { content: 'garbage' };
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };
    const entity = {
      entityName: 'Bitcoin',
      sources: [{ source: 'discord', sourceId: 'src-1', trustWeight: 1 }],
      weightedSum: 6.0,
      urgency: 'breaking',
    };
    const row = makeSummaryRow();
    const pool = mockPool([
      { rows: [row] },
      { rows: [] },
      { rows: [{ value: 'UTC' }] },
      {
        rows: [
          {
            id: 'report-4',
            date: '2024-01-01',
            type: 'flash',
            body: makeReportJson(),
            tldr: 'Bitcoin rallied on ETF flows. Market sentiment is bullish.',
            sentiment: 0.7,
            delivery_status: 'pending',
            delivered_at: null,
            created_at: Date.now(),
          },
        ],
      },
    ]);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runFlash([entity]);

    assert.strictEqual(callCount, 2);
    assert.notStrictEqual(result, null);
  });

  it('retries flash synthesis with validation feedback when the JSON shape is wrong', async () => {
    const llmCalls: Array<{ system: string }> = [];
    let callCount = 0;
    const llm = {
      call: async (params: { system: string }) => {
        llmCalls.push(params);
        callCount++;
        if (callCount === 1) {
          return { content: makeReportJson({ keyEvents: Array.from({ length: 11 }, (_, i) => `Event ${i}`) }) };
        }
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };
    const entity = {
      entityName: 'Bitcoin',
      sources: [{ source: 'discord', sourceId: 'src-1', trustWeight: 1 }],
      weightedSum: 6.0,
      urgency: 'breaking',
    };
    const row = makeSummaryRow();
    const pool = mockPool([
      { rows: [row] },
      { rows: [] },
      { rows: [{ value: 'UTC' }] },
      {
        rows: [
          {
            id: 'report-4',
            date: '2024-01-01',
            type: 'flash',
            body: makeReportJson(),
            tldr: 'Bitcoin rallied on ETF flows. Market sentiment is bullish.',
            sentiment: 0.7,
            delivery_status: 'pending',
            delivered_at: null,
            created_at: Date.now(),
          },
        ],
      },
    ]);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runFlash([entity]);

    assert.strictEqual(callCount, 2);
    assert.notStrictEqual(result, null);
    assert.match(llmCalls[1]!.system, /validation errors/i);
    assert.match(llmCalls[1]!.system, /keyEvents/);
  });
});

// ===========================================================================
// Score/ranking logic (tested indirectly through runDaily)
// ===========================================================================

describe('synthesize: scoring and ranking', () => {
  it('breaking urgency summaries rank higher than routine', async () => {
    const breakingRow = makeSummaryRow({
      id: 'breaking-1',
      urgency: 'breaking',
      item_count: 5,
      body: makeSummaryBody({
        urgency: 'breaking',
        entities: [{ name: 'ETH', type: 'token', sentiment: -0.5, mentionCount: 3 }],
      }),
    });
    const routineRow = makeSummaryRow({
      id: 'routine-1',
      urgency: 'routine',
      item_count: 5,
      body: makeSummaryBody({
        urgency: 'routine',
        entities: [{ name: 'BTC', type: 'token', sentiment: 0.3, mentionCount: 2 }],
      }),
    });

    // Create 52 summaries so rankAndTrim kicks in (threshold=50, limit=30)
    // Put the routine one first and breaking one second to verify sorting
    const rows = Array.from({ length: 50 }, (_, i) =>
      makeSummaryRow({
        id: `filler-${i}`,
        urgency: 'routine',
        item_count: 1,
        body: makeSummaryBody({
          entities: [{ name: `Token${i}`, type: 'token', sentiment: 0, mentionCount: 1 }],
        }),
      }),
    );
    rows.push(routineRow, breakingRow);

    // Track what LLM receives
    let llmUserMessage = '';
    const llm = {
      call: async (params: { messages: { content: string }[] }) => {
        llmUserMessage = params.messages[0].content;
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };

    const pool = mockPool(dailyPoolResponses(rows));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    // The breaking summary should be included in the LLM message (it scores higher)
    assert.ok(llmUserMessage.includes('ETH'), 'Breaking urgency entity should be included after ranking');
  });

  it('summaries with more entities score higher', async () => {
    const manyEntities = makeSummaryRow({
      id: 'many-ent',
      urgency: 'routine',
      item_count: 1,
      body: makeSummaryBody({
        entities: [
          { name: 'BTC', type: 'token', sentiment: 0.3, mentionCount: 2 },
          { name: 'ETH', type: 'token', sentiment: 0.1, mentionCount: 1 },
          { name: 'SOL', type: 'token', sentiment: -0.2, mentionCount: 1 },
          { name: 'AVAX', type: 'token', sentiment: 0.5, mentionCount: 1 },
        ],
      }),
    });
    const fewEntities = makeSummaryRow({
      id: 'few-ent',
      urgency: 'routine',
      item_count: 1,
      body: makeSummaryBody({
        entities: [{ name: 'DOGE', type: 'token', sentiment: 0, mentionCount: 1 }],
      }),
    });

    // 51 rows to trigger trimming
    const fillers = Array.from({ length: 49 }, (_, i) =>
      makeSummaryRow({
        id: `f-${i}`,
        urgency: 'routine',
        item_count: 1,
        body: makeSummaryBody({
          entities: [], // zero entities = lowest score
        }),
      }),
    );
    const rows = [...fillers, fewEntities, manyEntities];

    let llmUserMessage = '';
    const llm = {
      call: async (params: { messages: { content: string }[] }) => {
        llmUserMessage = params.messages[0].content;
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };

    const pool = mockPool(dailyPoolResponses(rows));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    // many-entities summary should survive the trim
    assert.ok(llmUserMessage.includes('AVAX'), 'Summary with more entities should rank higher');
  });
});

// ===========================================================================
// parseReportResponse — LLM response parsing (tested through runDaily)
// ===========================================================================

describe('synthesize: LLM response parsing', () => {
  it('handles markdown-fenced JSON from LLM', async () => {
    const fencedResponse = '```json\n' + makeReportJson() + '\n```';
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const llm = mockLlm(fencedResponse);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runDaily();

    assert.notStrictEqual(result, null);
    assert.ok(result!.tldr!.includes('Bitcoin'));
  });

  it('handles bare JSON from LLM (no fences)', async () => {
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const llm = mockLlm(makeReportJson());
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    const result = await synth.runDaily();
    assert.notStrictEqual(result, null);
  });

  it('report body includes correct entitySentiment from LLM', async () => {
    const reportWithSentiments = makeReportJson({
      entitySentiment: [
        { name: 'Bitcoin', sentiment: 0.8, reason: 'bullish' },
        { name: 'Ethereum', sentiment: -0.3, reason: 'bearish' },
      ],
    });
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const llm = mockLlm(reportWithSentiments);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    // Verify the body stored in the INSERT query contains the right entitySentiment
    const insertCall = pool.calls.find((c) => c.text.includes('INSERT INTO reports'));
    assert.ok(insertCall, 'Should have an INSERT INTO reports query');
    const bodyParam = insertCall!.values.find((v) => typeof v === 'string' && v.includes('entitySentiment'));
    assert.ok(bodyParam, 'Body param should contain entitySentiment');
    const body = JSON.parse(bodyParam as string);
    assert.strictEqual(body.entitySentiment.length, 2);
    assert.strictEqual(body.entitySentiment[0].name, 'Bitcoin');
    assert.strictEqual(body.entitySentiment[0].sentiment, 0.8);
    assert.strictEqual(body.entitySentiment[1].sentiment, -0.3);
  });

  it('report body preserves marketCatalysts from LLM', async () => {
    const reportWithCatalysts = makeReportJson({
      marketCatalysts: [
        'FOMC decision tomorrow is the main macro risk.',
        'Monthly BTC options expiry could amplify vol.',
      ],
    });
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const llm = mockLlm(reportWithCatalysts);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    const insertCall = pool.calls.find((c) => c.text.includes('INSERT INTO reports'));
    assert.ok(insertCall, 'Should have an INSERT INTO reports query');
    const bodyParam = insertCall!.values.find((v) => typeof v === 'string' && v.includes('marketCatalysts'));
    assert.ok(bodyParam, 'Body param should contain marketCatalysts');
    const body = JSON.parse(bodyParam as string);
    assert.deepStrictEqual(body.marketCatalysts, [
      'FOMC decision tomorrow is the main macro risk.',
      'Monthly BTC options expiry could amplify vol.',
    ]);
  });

  it('report body preserves regionalDivergence from LLM', async () => {
    const reportWithRegionalDivergence = makeReportJson({
      regionalDivergence: [
        'Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.',
        'Solana: ID momentum improved while EN chatter stayed cautious into the next catalyst window.',
      ],
    });
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const llm = mockLlm(reportWithRegionalDivergence);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    const insertCall = pool.calls.find((c) => c.text.includes('INSERT INTO reports'));
    assert.ok(insertCall, 'Should have an INSERT INTO reports query');
    const bodyParam = insertCall!.values.find((v) => typeof v === 'string' && v.includes('regionalDivergence'));
    assert.ok(bodyParam, 'Body param should contain regionalDivergence');
    const body = JSON.parse(bodyParam as string);
    assert.deepStrictEqual(body.regionalDivergence, [
      'Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.',
      'Solana: ID momentum improved while EN chatter stayed cautious into the next catalyst window.',
    ]);
  });

  it('report body preserves narrativeShifts from LLM', async () => {
    const reportWithNarrativeShifts = makeReportJson({
      narrativeShifts: [
        'Solana fee rebound broadened from a niche trading theme into a wider alt rotation watch.',
        'BTC treasury chatter faded after fresh follow-through failed to show up in the latest summaries.',
      ],
    });
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const llm = mockLlm(reportWithNarrativeShifts);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    const insertCall = pool.calls.find((c) => c.text.includes('INSERT INTO reports'));
    assert.ok(insertCall, 'Should have an INSERT INTO reports query');
    const bodyParam = insertCall!.values.find((v) => typeof v === 'string' && v.includes('narrativeShifts'));
    assert.ok(bodyParam, 'Body param should contain narrativeShifts');
    const body = JSON.parse(bodyParam as string);
    assert.deepStrictEqual(body.narrativeShifts, [
      'Solana fee rebound broadened from a niche trading theme into a wider alt rotation watch.',
      'BTC treasury chatter faded after fresh follow-through failed to show up in the latest summaries.',
    ]);
  });

  it('report body preserves eventChains from LLM', async () => {
    const reportWithEventChains = makeReportJson({
      eventChains: [
        'Bitcoin exploit chain: exploit -> audit -> governance response remains active.',
        'Arbitrum unlock chain: unlock passed quietly but follow-up liquidity monitoring continues.',
      ],
    });
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const llm = mockLlm(reportWithEventChains);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    const insertCall = pool.calls.find((c) => c.text.includes('INSERT INTO reports'));
    assert.ok(insertCall, 'Should have an INSERT INTO reports query');
    const bodyParam = insertCall!.values.find((v) => typeof v === 'string' && v.includes('eventChains'));
    assert.ok(bodyParam, 'Body param should contain eventChains');
    const body = JSON.parse(bodyParam as string);
    assert.deepStrictEqual(body.eventChains, [
      'Bitcoin exploit chain: exploit -> audit -> governance response remains active.',
      'Arbitrum unlock chain: unlock passed quietly but follow-up liquidity monitoring continues.',
    ]);
  });

  it('report body preserves firstMovers from LLM', async () => {
    const reportWithFirstMovers = makeReportJson({
      firstMovers: [
        'Ethereum was first tracked by DeFi Dad roughly 4h before the next monitored call.',
        'Pendle was first tracked by Ignas 90m before broader monitored chatter picked up.',
      ],
    });
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const llm = mockLlm(reportWithFirstMovers);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    const insertCall = pool.calls.find((c) => c.text.includes('INSERT INTO reports'));
    assert.ok(insertCall, 'Should have an INSERT INTO reports query');
    const bodyParam = insertCall!.values.find((v) => typeof v === 'string' && v.includes('firstMovers'));
    assert.ok(bodyParam, 'Body param should contain firstMovers');
    const body = JSON.parse(bodyParam as string);
    assert.deepStrictEqual(body.firstMovers, [
      'Ethereum was first tracked by DeFi Dad roughly 4h before the next monitored call.',
      'Pendle was first tracked by Ignas 90m before broader monitored chatter picked up.',
    ]);
  });
});

// ===========================================================================
// Average sentiment calculation (tested via DB insert verification)
// ===========================================================================

describe('synthesize: computeAvgSentiment', () => {
  it('computes average sentiment and rounds to 2 decimals', async () => {
    const reportJson = makeReportJson({
      entitySentiment: [
        { name: 'BTC', sentiment: 0.7, reason: 'up' },
        { name: 'ETH', sentiment: 0.3, reason: 'stable' },
        { name: 'SOL', sentiment: -0.2, reason: 'down' },
      ],
    });
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const llm = mockLlm(reportJson);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    // Find the INSERT query call and check the sentiment value
    const insertCall = pool.calls.find((c) => c.text.includes('INSERT INTO reports'));
    assert.ok(insertCall, 'Should have an INSERT INTO reports query');
    // Average of (0.7 + 0.3 + -0.2) / 3 = 0.2666... → rounded to 0.27
    const sentimentValue = insertCall!.values.find((v) => typeof v === 'number' && v > 0.2 && v < 0.3);
    assert.ok(sentimentValue !== undefined, 'Sentiment ~0.27 should be in insert values');
  });

  it('sets sentiment to null when no entity sentiments', async () => {
    const reportJson = makeReportJson({ entitySentiment: [] });
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const llm = mockLlm(reportJson);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    const insertCall = pool.calls.find((c) => c.text.includes('INSERT INTO reports'));
    assert.ok(insertCall);
    // Sentiment should be null
    assert.ok(insertCall!.values.includes(null), 'Sentiment should be null when no entities');
  });
});

// ===========================================================================
// Prompt construction (verify LLM receives expected content)
// ===========================================================================

describe('synthesize: prompt construction', () => {
  it('daily prompt includes yesterday tldr when available', async () => {
    const row = makeSummaryRow();
    let llmUserMessage = '';
    const llm = {
      call: async (params: { messages: { content: string }[] }) => {
        llmUserMessage = params.messages[0].content;
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };
    const pool = mockPool(dailyPoolResponses([row], { yesterdayTldr: 'Yesterday markets were calm' }));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    assert.ok(llmUserMessage.includes('yesterday_tldr'));
    assert.ok(llmUserMessage.includes('Yesterday markets were calm'));
  });

  it('daily prompt includes source tag in summaries', async () => {
    const row = makeSummaryRow({ source: 'twitter' });
    let llmUserMessage = '';
    const llm = {
      call: async (params: { messages: { content: string }[] }) => {
        llmUserMessage = params.messages[0].content;
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };
    const pool = mockPool(dailyPoolResponses([row]));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    assert.ok(llmUserMessage.includes('[twitter]'), 'Prompt should include source tag');
  });

  it('flash prompt includes breaking_entities section', async () => {
    const entity = {
      entityName: 'Ethereum',
      sources: [{ source: 'discord', sourceId: 'src-1', trustWeight: 1 }],
      weightedSum: 7.5,
      urgency: 'breaking',
    };
    const row = makeSummaryRow({
      body: makeSummaryBody({
        entities: [{ name: 'Ethereum', type: 'token', sentiment: -0.8, mentionCount: 10 }],
      }),
    });
    let llmUserMessage = '';
    const llm = {
      call: async (params: { messages: { content: string }[] }) => {
        llmUserMessage = params.messages[0].content;
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };
    const pool = mockPool([{ rows: [row] }, { rows: [] }, { rows: [{ value: 'UTC' }] }, {}]);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runFlash([entity]);

    assert.ok(llmUserMessage.includes('breaking_entities'));
    assert.ok(llmUserMessage.includes('Ethereum'));
    assert.ok(llmUserMessage.includes('7.50'));
  });

  it('daily prompt includes key_events section', async () => {
    const row = makeSummaryRow({
      body: makeSummaryBody({
        keyEvents: ['Major hack reported', 'Exchange halts withdrawals'],
      }),
    });
    let llmUserMessage = '';
    const llm = {
      call: async (params: { messages: { content: string }[] }) => {
        llmUserMessage = params.messages[0].content;
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };
    const pool = mockPool(dailyPoolResponses([row]));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    assert.ok(llmUserMessage.includes('key_events'));
    assert.ok(llmUserMessage.includes('Major hack reported'));
  });
});

// ===========================================================================
// Report insertion (verified via pool.calls)
// ===========================================================================

describe('synthesize: report insertion', () => {
  it('inserts daily report with type "daily"', async () => {
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      mockLlm() as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    const insertCall = pool.calls.find((c) => c.text.includes('INSERT INTO reports'));
    assert.ok(insertCall);
    assert.ok(insertCall!.values.includes('daily'), 'Report type should be "daily"');
  });

  it('inserts flash report with type "flash"', async () => {
    const entity = {
      entityName: 'Bitcoin',
      sources: [{ source: 'discord', sourceId: 'src-1', trustWeight: 1 }],
      weightedSum: 6.0,
      urgency: 'breaking',
    };
    const row = makeSummaryRow();
    const pool = mockPool([{ rows: [row] }, { rows: [] }, { rows: [{ value: 'UTC' }] }, {}]);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      mockLlm() as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runFlash([entity]);

    const insertCall = pool.calls.find((c) => c.text.includes('INSERT INTO reports'));
    assert.ok(insertCall);
    assert.ok(insertCall!.values.includes('flash'), 'Report type should be "flash"');
  });

  it('report ID is a valid ULID', async () => {
    const row = makeSummaryRow();
    const pool = mockPool(dailyPoolResponses([row]));
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      mockLlm() as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    const insertCall = pool.calls.find((c) => c.text.includes('INSERT INTO reports'));
    assert.ok(insertCall);
    const reportId = insertCall!.values[0] as string;
    assert.match(reportId, /^[0-9A-Z]{26}$/, 'Report ID should be a valid ULID');
  });
});

// ===========================================================================
// SP-006 regression: XML escaping in prompts
// ===========================================================================

describe('synthesize: XML escaping in prompts', () => {
  it('escapes entity names with XML special characters in daily prompt', async () => {
    const xssEntityName = '<script>alert(1)</script>';
    const row = makeSummaryRow({
      body: makeSummaryBody({
        entities: [{ name: xssEntityName, type: 'token', sentiment: 0.5, mentionCount: 3 }],
      }),
    });

    // Pool responses for daily (correlator is now injected, not queried via pool):
    // 0: getAppConfig(timezone)
    // 1: dailyReportExists
    // 2: getSummariesByTimeWindow
    // 3: getYesterdayTldr
    // 4: entity ID lookup for sentiment momentum (alias fallback)
    // 5: getLatestPricesForEntities
    // 6: getEntityFirstMovers
    // 7: getAlphaPropagationSummary (per entity)
    // 8: narratives query
    // 9: chain entity lookup
    // 10: getRecentEventChains
    // 11: getUnusualActivityOverview(latest date)
    // 12: getLatestMacroSnapshots
    // 13: insertReport
    const poolResponses = [
      { rows: [{ value: 'UTC' }] }, // getAppConfig
      { rows: [{ exists: false }] }, // dailyReportExists
      { rows: [row] }, // getSummariesByTimeWindow
      { rows: [] }, // getYesterdayTldr
      { rows: [{ id: 'entity-xss-1', name: '<script>alert(1)</script>' }] }, // entity ID lookup (alias fallback)
      { rows: [] }, // getLatestPricesForEntities
      { rows: [] }, // getEntityFirstMovers
      { rows: [] }, // getAlphaPropagationSummary (entity-xss-1)
      { rows: [] }, // narratives query
      { rows: [] }, // chain entity lookup
      { rows: [] }, // getRecentEventChains
      { rows: [{ latest_date: null }] }, // getUnusualActivityOverview -> no daily rollup yet
      { rows: [] }, // getLatestMacroSnapshots
      {
        rows: [
          {
            // insertReport RETURNING *
            id: 'report-xml-1',
            date: '2024-01-01',
            type: 'daily',
            body: makeReportJson(),
            tldr: 'Test report.',
            sentiment: 0.5,
            delivery_status: 'pending',
            delivered_at: null,
            created_at: Date.now(),
          },
        ],
      },
    ];

    // Mock correlator returns the XSS entity
    const xssCorrelator = mockCorrelator([
      {
        entityName: xssEntityName,
        sources: [
          { source: 'discord', sourceId: 'src-1', trustWeight: 0.8 },
          { source: 'twitter', sourceId: 'src-2', trustWeight: 0.7 },
        ],
        weightedSum: 1.5,
        urgency: 'elevated',
      },
    ]);

    let llmUserMessage = '';
    const llm = {
      call: async (params: { messages: { role: string; content: string }[] }) => {
        llmUserMessage = params.messages[0].content;
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };

    const pool = mockPool(poolResponses);
    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      xssCorrelator as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runDaily();

    // The correlated_entities section must contain the escaped entity name
    const correlatedSection = llmUserMessage.match(/<correlated_entities>([\s\S]*?)<\/correlated_entities>/);
    assert.ok(correlatedSection, 'LLM prompt should contain correlated_entities section');
    assert.ok(
      correlatedSection![1].includes('&lt;script&gt;alert(1)&lt;/script&gt;'),
      'Entity name in correlated_entities should be XML-escaped',
    );
    assert.ok(
      !correlatedSection![1].includes('<script>'),
      'Raw <script> tag should not appear in correlated_entities section',
    );
  });

  it('escapes entity names in flash prompt', async () => {
    const dangerousName = 'Token<br>&"injection"';
    const entity = {
      entityName: dangerousName,
      sources: [{ source: 'discord', sourceId: 'src-1', trustWeight: 1 }],
      weightedSum: 6.0,
      urgency: 'breaking',
    };
    const row = makeSummaryRow({
      body: makeSummaryBody({
        entities: [{ name: dangerousName, type: 'token', sentiment: -0.5, mentionCount: 4 }],
      }),
    });

    let llmUserMessage = '';
    const llm = {
      call: async (params: { messages: { role: string; content: string }[] }) => {
        llmUserMessage = params.messages[0].content;
        return { content: makeReportJson() };
      },
      wrapWithNonce: (content: string) => ({ wrapped: content, nonce: 'x' }),
    };

    const pool = mockPool([
      { rows: [row] }, // getSummariesByTimeWindow
      { rows: [] }, // flash duplicate check
      { rows: [{ value: 'UTC' }] }, // getAppConfig(timezone)
      {
        rows: [
          {
            // insertReport RETURNING *
            id: 'report-xml-2',
            date: '2024-01-01',
            type: 'flash',
            body: makeReportJson(),
            tldr: 'Test flash.',
            sentiment: -0.3,
            delivery_status: 'pending',
            delivered_at: null,
            created_at: Date.now(),
          },
        ],
      },
    ]);

    const synth = createSynthesizer(
      pool as never,
      silentLog,
      fakeConfig(),
      llm as never,
      mockCorrelator() as never,
      mockSentimentTracker() as never,
      mockDivergenceTracker() as never,
    );
    await synth.runFlash([entity]);

    // The breaking_entities section must contain escaped entity names
    const breakingSection = llmUserMessage.match(/<breaking_entities>([\s\S]*?)<\/breaking_entities>/);
    assert.ok(breakingSection, 'LLM prompt should contain breaking_entities section');
    assert.ok(!breakingSection![1].includes('<br>'), 'Raw <br> should not appear in breaking_entities section');
    assert.ok(
      breakingSection![1].includes('&lt;br&gt;'),
      'Angle brackets in entity name should be escaped in breaking_entities',
    );
    assert.ok(breakingSection![1].includes('&amp;'), 'Ampersand in entity name should be escaped in breaking_entities');
    assert.ok(
      breakingSection![1].includes('&quot;injection&quot;'),
      'Double quotes in entity name should be escaped in breaking_entities',
    );
  });
});
