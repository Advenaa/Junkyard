import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EventChainRow, SummaryRow, UnusualActivityOverview, EntityFirstMoverRow } from '../../src/db/queries.js';
import type { CalendarEventEntry } from '../../src/knowledge/calendar.js';
import type { DivergenceEntry } from '../../src/knowledge/divergence.js';
import type { MomentumEntry } from '../../src/knowledge/sentiment.js';
import type { CryptoSentimentAggregate, MacroContextSummary } from '../../src/macro/context.js';
import type { CorrelatedEntity } from '../../src/process/correlate.js';
import {
  buildDailyUserMessage,
  buildFlashUserMessage,
  type AlphaPropagationContext,
  type NarrativeContext,
  type PriceContextEntry,
  type RecentEventAnalysisEntry,
  type ScoredSummary,
} from '../../src/process/synthesis-context.js';
import type { ParsedSummaryBody } from '../../src/process/synthesis-shared.js';
import { fakeSummary } from '../helpers/factories.js';

interface DailyInputs {
  summaries: ScoredSummary[];
  dedupedEvents: string[];
  correlated: CorrelatedEntity[];
  yesterdayTldr: string | null;
  momentum: MomentumEntry[];
  divergence: DivergenceEntry[];
  priceContext: PriceContextEntry[];
  firstMovers: EntityFirstMoverRow[];
  unusualActivity: UnusualActivityOverview;
  macroContext: MacroContextSummary;
  cryptoAggregate: CryptoSentimentAggregate | null;
  alphaPropagation: AlphaPropagationContext[];
  narratives: NarrativeContext[];
  recentCalendarEvents: CalendarEventEntry[];
  recentEventAnalysis: RecentEventAnalysisEntry[];
  recentEventChains: EventChainRow[];
  calendarEvents: CalendarEventEntry[];
  timezone: string;
  quietDay: boolean;
}

const TODAY = new Date().toLocaleDateString('en-CA');
const TIMEZONE = 'Asia/Jakarta';

function makeParsedSummary(overrides: Partial<ParsedSummaryBody> = {}): ParsedSummaryBody {
  return {
    summary: 'Bitcoin up 5%',
    urgency: 'routine',
    entities: [{ name: 'Bitcoin', type: 'token', sentiment: 0.8, mentionCount: 5 }],
    keyEvents: ['BTC breaks $100k'],
    confidence: 0.9,
    ...overrides,
  };
}

function makeScoredSummary(
  overrides: {
    row?: Partial<SummaryRow>;
    parsed?: Partial<ParsedSummaryBody>;
    score?: number;
  } = {},
): ScoredSummary {
  const parsed = makeParsedSummary(overrides.parsed);
  return {
    row: fakeSummary({
      body: JSON.stringify(parsed),
      ...overrides.row,
    }),
    parsed,
    score: overrides.score ?? 0.85,
  };
}

function makeCorrelatedEntity(overrides: Partial<CorrelatedEntity> = {}): CorrelatedEntity {
  return {
    entityName: 'Bitcoin',
    weightedSum: 3.5,
    urgency: 'breaking',
    sources: [
      { source: 'discord', sourceId: 'src-1', trustWeight: 0.9 },
      { source: 'twitter', sourceId: 'src-2', trustWeight: 0.8 },
    ],
    ...overrides,
  };
}

function makeMomentumEntry(overrides: Partial<MomentumEntry> = {}): MomentumEntry {
  return {
    entityId: 'entity-1',
    entityName: 'Bitcoin',
    avgSentiment: 0.42,
    mentionCount: 12,
    momentum: 0.3,
    trend: 'accelerating',
    date: TODAY,
    ...overrides,
  };
}

function makePriceContextEntry(overrides: Partial<PriceContextEntry> = {}): PriceContextEntry {
  return {
    entityName: 'Bitcoin',
    priceUsd: 123456.78,
    priceChange24h: 4.2,
    priceChange7d: -1.5,
    sentiment: 0.5,
    contrarian: 'sentiment negative despite price rally',
    ...overrides,
  };
}

function makeNarrativeContext(overrides: Partial<NarrativeContext> = {}): NarrativeContext {
  return {
    name: 'ETF rotation',
    growthRate: '+42%',
    summaryCount: 7,
    createdAt: Date.UTC(2026, 3, 13, 6, 0, 0),
    ...overrides,
  };
}

function makeCalendarEventEntry(overrides: Partial<CalendarEventEntry> = {}): CalendarEventEntry {
  return {
    id: 'event-1',
    name: 'CPI Release',
    category: 'macro',
    description: 'Inflation print lands before the US open',
    recurrenceRule: null,
    entityId: 'entity-1',
    entityName: 'Bitcoin',
    nextOccurrence: Date.UTC(2026, 3, 14, 12, 30, 0),
    ...overrides,
  };
}

function makeRecentEventAnalysisEntry(overrides: Partial<RecentEventAnalysisEntry> = {}): RecentEventAnalysisEntry {
  return {
    event: makeCalendarEventEntry(),
    preAvgSentiment: 0.1,
    preMentionCount: 8,
    postAvgSentiment: 0.4,
    postMentionCount: 14,
    sentimentDelta: 0.3,
    ...overrides,
  };
}

function makeEventChainRow(overrides: Partial<EventChainRow> = {}): EventChainRow {
  return {
    chain_root_id: 'chain-1',
    entity_id: 'entity-1',
    entity_name: 'Bitcoin',
    event_count: 2,
    first_event_time: Date.UTC(2026, 3, 13, 7, 0, 0),
    latest_event_time: Date.UTC(2026, 3, 13, 9, 0, 0),
    event_types: ['launch', 'partnership'],
    descriptions: ['ETF filing hits the tape', 'Partnership expands distribution'],
    ...overrides,
  };
}

function makeFirstMoverRow(overrides: Partial<EntityFirstMoverRow> = {}): EntityFirstMoverRow {
  return {
    entityId: 'entity-1',
    entityName: 'Bitcoin',
    authorId: 'author-1',
    platform: 'twitter',
    handle: 'macroalpha',
    displayName: 'Macro Alpha',
    claimType: 'buy',
    claimText: 'First tracked buy call',
    sourceItemId: 'item-1',
    timestamp: Date.UTC(2026, 3, 13, 8, 0, 0),
    nextTrackedCallTime: Date.UTC(2026, 3, 13, 10, 0, 0),
    leadWindowMs: 2 * 60 * 60 * 1000,
    ...overrides,
  };
}

function makeDailyInputs(overrides: Partial<DailyInputs> = {}): DailyInputs {
  return {
    summaries: [makeScoredSummary()],
    dedupedEvents: [],
    correlated: [],
    yesterdayTldr: null,
    momentum: [],
    divergence: [],
    priceContext: [],
    firstMovers: [],
    unusualActivity: { latestDate: null, entries: [] },
    macroContext: { entries: [], overallBias: 'mixed' },
    cryptoAggregate: null,
    alphaPropagation: [],
    narratives: [],
    recentCalendarEvents: [],
    recentEventAnalysis: [],
    recentEventChains: [],
    calendarEvents: [],
    timezone: TIMEZONE,
    quietDay: false,
    ...overrides,
  };
}

function renderDailyMessage(overrides: Partial<DailyInputs> = {}): string {
  const input = makeDailyInputs(overrides);
  return buildDailyUserMessage(
    input.summaries,
    input.dedupedEvents,
    input.correlated,
    input.yesterdayTldr,
    input.momentum,
    input.divergence,
    input.priceContext,
    input.firstMovers,
    input.unusualActivity,
    input.macroContext,
    input.cryptoAggregate,
    input.alphaPropagation,
    input.narratives,
    input.recentCalendarEvents,
    input.recentEventAnalysis,
    input.recentEventChains,
    input.calendarEvents,
    input.timezone,
    input.quietDay,
  );
}

function renderFlashMessage(
  summaries: ScoredSummary[] = [makeScoredSummary()],
  correlated: CorrelatedEntity[] = [makeCorrelatedEntity()],
): string {
  return buildFlashUserMessage(summaries, correlated);
}

describe('buildDailyUserMessage', () => {
  it('includes yesterday TLDR when provided', () => {
    const message = renderDailyMessage({ yesterdayTldr: 'Risk appetite returned overnight.' });

    assert.ok(message.includes('<yesterday_tldr>Risk appetite returned overnight.</yesterday_tldr>'));
  });

  it('omits yesterday TLDR when null', () => {
    const message = renderDailyMessage({ yesterdayTldr: null });

    assert.ok(!message.includes('<yesterday_tldr>'));
  });

  it('formats summaries with source, text, and entities', () => {
    const summary = makeScoredSummary({
      row: { source: 'discord' },
      parsed: {
        summary: 'Bitcoin up 5% after ETF chatter',
        entities: [
          { name: 'Bitcoin', type: 'token', sentiment: 0.8, mentionCount: 5 },
          { name: 'Ethereum', type: 'token', sentiment: -0.2, mentionCount: 2 },
        ],
      },
    });

    const message = renderDailyMessage({ summaries: [summary] });

    assert.ok(message.includes('<summaries>'));
    assert.ok(message.includes('[discord] Bitcoin up 5% after ETF chatter'));
    assert.ok(message.includes('Entities: Bitcoin (token, sentiment: 0.8), Ethereum (token, sentiment: -0.2)'));
  });

  it('formats key events inside the key_events section', () => {
    const message = renderDailyMessage({
      dedupedEvents: ['BTC breaks $100k', 'ETF inflows accelerate'],
    });

    assert.ok(message.includes('<key_events>'));
    assert.ok(message.includes('- BTC breaks $100k'));
    assert.ok(message.includes('- ETF inflows accelerate'));
  });

  it('formats correlated entities with weight urgency and sources', () => {
    const message = renderDailyMessage({
      correlated: [makeCorrelatedEntity()],
    });

    assert.ok(message.includes('<correlated_entities>'));
    assert.ok(message.includes('Bitcoin: weight=3.50, urgency=breaking, sources=discord+twitter'));
  });

  it('formats sentiment momentum with signed values and mentions', () => {
    const message = renderDailyMessage({
      momentum: [makeMomentumEntry()],
    });

    assert.ok(message.includes('<sentiment_momentum>'));
    assert.ok(message.includes('Bitcoin: avg=0.42, momentum=+0.30 (accelerating), mentions=12'));
    assert.ok(!message.includes('rollup may have failed'));
  });

  it('formats price context with price changes and contrarian signals', () => {
    const message = renderDailyMessage({
      priceContext: [makePriceContextEntry()],
    });

    assert.ok(message.includes('<price_context>'));
    assert.ok(message.includes('Bitcoin: $123,456.78 (24h: +4.2%, 7d: -1.5%)'));
    assert.ok(message.includes('CONTRARIAN: sentiment negative despite price rally'));
  });

  it('formats narrative context with growth rate and summary count', () => {
    const message = renderDailyMessage({
      narratives: [makeNarrativeContext()],
    });

    assert.ok(message.includes('<narrative_context>'));
    assert.ok(message.includes('ETF rotation: growth=+42%, summaries=7'));
  });

  it('omits empty momentum price and narrative sections', () => {
    const message = renderDailyMessage({
      momentum: [],
      priceContext: [],
      narratives: [],
    });

    assert.ok(!message.includes('<sentiment_momentum>'));
    assert.ok(!message.includes('<price_context>'));
    assert.ok(!message.includes('<narrative_context>'));
  });

  it('includes the quiet day section when quietDay is true', () => {
    const message = renderDailyMessage({ quietDay: true });

    assert.ok(message.includes('<quiet_day>'));
    assert.ok(message.includes('quiet market'));
  });

  it('escapes XML-sensitive entity names', () => {
    const message = renderDailyMessage({
      correlated: [makeCorrelatedEntity({ entityName: 'Token <X>&Y' })],
    });

    assert.ok(message.includes('Token &lt;X&gt;&amp;Y: weight=3.50, urgency=breaking, sources=discord+twitter'));
  });

  it('formats recent calendar events', () => {
    const message = renderDailyMessage({
      recentCalendarEvents: [makeCalendarEventEntry()],
    });

    assert.ok(message.includes('<recent_calendar_events>'));
    assert.ok(message.includes('[macro] CPI Release'));
    assert.ok(message.includes('[entity: Bitcoin]'));
    assert.ok(message.includes('Inflation print lands before the US open'));
  });

  it('formats recent event analysis', () => {
    const message = renderDailyMessage({
      recentEventAnalysis: [makeRecentEventAnalysisEntry()],
    });

    assert.ok(message.includes('<recent_event_analysis>'));
    assert.ok(message.includes('pre-48h avg=0.10 (8 mentions), post-so-far avg=0.40 (14 mentions), delta=+0.30'));
  });

  it('formats recent event chains', () => {
    const message = renderDailyMessage({
      recentEventChains: [makeEventChainRow()],
    });

    assert.ok(message.includes('<recent_event_chains>'));
    assert.ok(message.includes('Bitcoin: 2 linked events'));
    assert.ok(message.includes('chain=launch -> partnership'));
  });

  it('formats first movers using the configured timezone', () => {
    const message = renderDailyMessage({
      firstMovers: [makeFirstMoverRow()],
    });

    assert.ok(message.includes('<first_movers>'));
    assert.ok(message.includes('Bitcoin: first tracked by Macro Alpha (@macroalpha) on twitter'));
    assert.ok(message.includes('claim_type=buy; lead_window=2.0h before the next tracked call'));
  });
});

describe('buildFlashUserMessage', () => {
  it('formats breaking entities', () => {
    const message = renderFlashMessage();

    assert.ok(message.includes('<breaking_entities>'));
    assert.ok(message.includes('Bitcoin: weight=3.50, urgency=breaking, sources=discord+twitter'));
  });

  it('filters summaries to only correlated entities', () => {
    const relevant = makeScoredSummary({
      parsed: {
        summary: 'Bitcoin breaks resistance',
        entities: [{ name: 'Bitcoin', type: 'token', sentiment: 0.9, mentionCount: 4 }],
      },
    });
    const irrelevant = makeScoredSummary({
      row: { id: 'summary-2' },
      parsed: {
        summary: 'Ethereum drifts sideways',
        entities: [{ name: 'Ethereum', type: 'token', sentiment: 0.1, mentionCount: 3 }],
      },
    });

    const message = renderFlashMessage([relevant, irrelevant], [makeCorrelatedEntity({ entityName: 'bitcoin' })]);

    assert.ok(message.includes('<recent_summaries>'));
    assert.ok(message.includes('Bitcoin breaks resistance'));
    assert.ok(!message.includes('Ethereum drifts sideways'));
  });

  it('deduplicates key events from multiple relevant summaries', () => {
    const first = makeScoredSummary({
      parsed: {
        keyEvents: ['BTC breaks $100k', 'ETF flows spike'],
      },
    });
    const second = makeScoredSummary({
      row: { id: 'summary-2' },
      parsed: {
        summary: 'Bitcoin stays bid',
        keyEvents: ['BTC breaks $100k', 'Open interest climbs'],
      },
    });

    const message = renderFlashMessage([first, second], [makeCorrelatedEntity()]);

    assert.ok(message.includes('<timeline>'));
    assert.strictEqual(message.match(/BTC breaks \$100k/g)?.length ?? 0, 1);
    assert.ok(message.includes('- ETF flows spike'));
    assert.ok(message.includes('- Open interest climbs'));
  });
});
