import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { EventChainRow, EntityFirstMoverRow, UnusualActivityOverview } from '../../src/db/queries.js';
import type { DivergenceEntry } from '../../src/knowledge/divergence.js';
import type { CalendarEventEntry } from '../../src/knowledge/calendar.js';
import type { MomentumEntry } from '../../src/knowledge/sentiment.js';
import type {
  AlphaPropagationContext,
  NarrativeContext,
  PriceContextEntry,
  RecentEventAnalysisEntry,
} from '../../src/process/pulse-context.js';
import {
  buildUserMessage,
  formatFirstMoverLeadWindow,
  formatUnusualActivityContext,
} from '../../src/process/pulse-context.js';
import type { DriftFlag } from '../../src/process/pulse-sentiment.js';
import type { CryptoSentimentAggregate, MacroContextSummary } from '../../src/macro/context.js';

interface BuildUserMessageOptions {
  summaries: { summary: string; source: string; entities: string; urgency: string }[];
  driftFlags: DriftFlag[];
  priorTldr: string | null;
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
}

function buildMessage(overrides: Partial<BuildUserMessageOptions> = {}): string {
  const options: BuildUserMessageOptions = {
    summaries: [
      {
        summary: 'Bitcoin is holding range support.',
        source: 'discord',
        entities: 'Bitcoin (token, sentiment: 0.3)',
        urgency: 'routine',
      },
    ],
    driftFlags: [],
    priorTldr: null,
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
    timezone: 'Asia/Jakarta',
    ...overrides,
  };

  return buildUserMessage(
    options.summaries,
    options.driftFlags,
    options.priorTldr,
    options.momentum,
    options.divergence,
    options.priceContext,
    options.firstMovers,
    options.unusualActivity,
    options.macroContext,
    options.cryptoAggregate,
    options.alphaPropagation,
    options.narratives,
    options.recentCalendarEvents,
    options.recentEventAnalysis,
    options.recentEventChains,
    options.calendarEvents,
    options.timezone,
  );
}

describe('pulse-context', () => {
  describe('formatFirstMoverLeadWindow', () => {
    it('returns "no later tracked call" for null', () => {
      assert.equal(formatFirstMoverLeadWindow(null), 'no later tracked call in the current lookback');
    });

    it('returns "no later tracked call" for zero or negative values', () => {
      assert.equal(formatFirstMoverLeadWindow(0), 'no later tracked call in the current lookback');
      assert.equal(formatFirstMoverLeadWindow(-60_000), 'no later tracked call in the current lookback');
    });

    it('returns minutes for windows shorter than one hour', () => {
      assert.equal(formatFirstMoverLeadWindow(37 * 60 * 1000), '37m before the next tracked call');
    });

    it('returns hours with one decimal place for windows under ten hours', () => {
      assert.equal(formatFirstMoverLeadWindow(90 * 60 * 1000), '1.5h before the next tracked call');
    });

    it('returns rounded whole hours for windows of ten hours or more', () => {
      assert.equal(formatFirstMoverLeadWindow(Math.round(10.6 * 60 * 60 * 1000)), '11h before the next tracked call');
    });
  });

  describe('formatUnusualActivityContext', () => {
    it('formats an entry with all fields populated', () => {
      const overview: UnusualActivityOverview = {
        latestDate: '2026-04-13',
        entries: [
          {
            entityId: 'ent-btc',
            entityName: 'BTC & ETH',
            date: '2026-04-13',
            mentionCount: 12,
            baselineMentionCount: 3.5,
            baselinePeakMentionCount: 8,
            baselineDays: 7,
            avgSentiment: 0.466,
            momentum: 0.12,
            spikeRatio: 3.44,
            relevanceScore: 1.234,
            lowRelevance: false,
            duplicateClusterSize: 4,
            duplicateAuthorCount: 3,
            duplicateSourceCount: 2,
          },
        ],
      };

      assert.deepEqual(formatUnusualActivityContext(overview), [
        'BTC &amp; ETH: mentions=12, baseline=3.5/day over 7d, prior_peak=8, ratio=3.4x, relevance=1.23, low_relevance=no, sentiment=0.47, momentum=+0.12, dup_cluster=4 posts/3 authors/2 streams',
      ]);
    });

    it('handles entries with null optional fields', () => {
      const overview: UnusualActivityOverview = {
        latestDate: null,
        entries: [
          {
            entityId: 'ent-new',
            entityName: 'New token',
            date: '2026-04-13',
            mentionCount: 5,
            baselineMentionCount: null,
            baselinePeakMentionCount: null,
            baselineDays: 0,
            avgSentiment: null,
            momentum: null,
            spikeRatio: null,
            relevanceScore: null,
            lowRelevance: false,
            duplicateClusterSize: null,
            duplicateAuthorCount: null,
            duplicateSourceCount: null,
          },
        ],
      };

      const line = formatUnusualActivityContext(overview)[0];
      assert.match(line, /baseline=new\/no-history/);
      assert.match(line, /prior_peak=n\/a/);
      assert.match(line, /ratio=new-breakout/);
      assert.match(line, /relevance=n\/a, low_relevance=unknown/);
      assert.match(line, /sentiment=n\/a/);
      assert.match(line, /momentum=n\/a/);
      assert.doesNotMatch(line, /dup_cluster=/);
    });
  });

  describe('buildUserMessage', () => {
    it('includes prior pulse tldr when provided', () => {
      const message = buildMessage({ priorTldr: 'Previously, BTC was breaking higher.' });

      assert.match(message, /<prior_pulse_tldr>Previously, BTC was breaking higher\.<\/prior_pulse_tldr>/);
    });

    it('omits prior pulse tldr when null', () => {
      const message = buildMessage({ priorTldr: null });

      assert.doesNotMatch(message, /<prior_pulse_tldr>/);
    });

    it('includes a sentiment drift section when drift flags are present', () => {
      const message = buildMessage({
        driftFlags: [{ entity: 'bitcoin', prior: 0.8, current: 0.1, delta: 0.7 }],
      });

      assert.match(message, /<sentiment_drift>/);
      assert.match(message, /bitcoin: sentiment shifted from 0\.80 to 0\.10 \(delta: 0\.70\)/);
    });

    it('includes all context sections when data is provided', () => {
      const timestamp = Date.UTC(2026, 3, 13, 12, 0, 0);
      const message = buildMessage({
        momentum: [
          {
            entityId: 'ent-btc',
            entityName: 'Bitcoin',
            avgSentiment: 0.35,
            mentionCount: 12,
            momentum: 0.18,
            trend: 'accelerating',
            date: '2026-04-13',
          },
        ],
        divergence: [
          {
            entityId: 'ent-btc',
            entityName: 'Bitcoin',
            engSentiment: 0.6,
            engMentions: 8,
            indSentiment: -0.1,
            indMentions: 4,
            divergence: 0.7,
            direction: 'eng-bullish',
          },
        ],
        priceContext: [
          {
            entityName: 'Bitcoin',
            priceUsd: 63_500.12,
            priceChange24h: 4.2,
            priceChange7d: 9.8,
            sentiment: -0.3,
            contrarian: 'price rising, community bearish',
          },
        ],
        firstMovers: [
          {
            entityId: 'ent-btc',
            entityName: 'Bitcoin',
            authorId: 'author-1',
            platform: 'twitter',
            handle: 'macroalpha',
            displayName: 'Macro Alpha',
            claimType: 'thread',
            claimText: 'BTC breakout odds are improving',
            sourceItemId: 'item-1',
            timestamp,
            nextTrackedCallTime: timestamp + 90 * 60 * 1000,
            leadWindowMs: 90 * 60 * 1000,
          },
        ],
        unusualActivity: {
          latestDate: '2026-04-13',
          entries: [
            {
              entityId: 'ent-btc',
              entityName: 'Bitcoin',
              date: '2026-04-13',
              mentionCount: 9,
              baselineMentionCount: 2,
              baselinePeakMentionCount: 4,
              baselineDays: 7,
              avgSentiment: 0.2,
              momentum: 0.15,
              spikeRatio: 4.5,
              relevanceScore: 1.1,
              lowRelevance: false,
              duplicateClusterSize: 3,
              duplicateAuthorCount: 2,
              duplicateSourceCount: 2,
            },
          ],
        },
        macroContext: {
          overallBias: 'risk-off',
          entries: [
            {
              indicator: 'vix',
              label: 'VIX',
              value: 22.1,
              change1d: 1.2,
              change7d: 3.8,
              date: '2026-04-13',
              signal: 'risk-off',
              narrative: 'volatility rising',
            },
          ],
        },
        cryptoAggregate: {
          average: 0.31,
          tone: 'bullish',
          mentionCount: 16,
        },
        alphaPropagation: [
          {
            entityName: 'Bitcoin',
            tiers: [
              { tier: 'alpha', firstMentionTime: timestamp, source: 'twitter', sourceId: 'source-1' },
              {
                tier: 'general',
                firstMentionTime: timestamp + 4 * 60 * 60 * 1000,
                source: 'discord',
                sourceId: 'source-2',
              },
            ],
            propagationSpeed: 'alpha → general in 4.0h',
          },
        ],
        narratives: [
          {
            name: 'BTC treasury bid',
            growthRate: 'emerging',
            summaryCount: 7,
            createdAt: timestamp,
          },
        ],
        recentCalendarEvents: [
          {
            id: 'cal-recent',
            name: 'CPI release',
            category: 'macro',
            description: 'Initial reaction was muted.',
            recurrenceRule: null,
            entityId: null,
            entityName: null,
            nextOccurrence: timestamp - 60 * 60 * 1000,
          },
        ],
        recentEventAnalysis: [
          {
            event: {
              id: 'cal-analysis',
              name: 'ETF flow update',
              category: 'macro',
              description: 'Flows stayed positive.',
              recurrenceRule: null,
              entityId: 'ent-btc',
              entityName: 'Bitcoin',
              nextOccurrence: timestamp - 30 * 60 * 1000,
            },
            preAvgSentiment: -0.1,
            preMentionCount: 10,
            postAvgSentiment: 0.2,
            postMentionCount: 6,
            sentimentDelta: 0.3,
          },
        ],
        recentEventChains: [
          {
            chain_root_id: 'chain-1',
            entity_id: 'ent-btc',
            entity_name: 'Bitcoin',
            event_count: 2,
            first_event_time: timestamp - 6 * 60 * 60 * 1000,
            latest_event_time: timestamp - 45 * 60 * 1000,
            event_types: ['hack', 'audit'],
            descriptions: ['Exploit surfaced.', 'Audit narrowed the blast radius.'],
          },
        ],
        calendarEvents: [
          {
            id: 'cal-upcoming',
            name: 'Token unlock',
            category: 'unlock',
            description: 'Supply increase due tomorrow.',
            recurrenceRule: null,
            entityId: 'ent-btc',
            entityName: 'Bitcoin',
            nextOccurrence: timestamp + 6 * 60 * 60 * 1000,
          },
        ],
      });

      assert.match(message, /<sentiment_momentum>/);
      assert.match(message, /<regional_divergence>/);
      assert.match(message, /<price_context>/);
      assert.match(message, /<first_movers>/);
      assert.match(message, /<unusual_activity>/);
      assert.match(message, /<macro_context>/);
      assert.match(message, /<alpha_propagation>/);
      assert.match(message, /<narrative_context>/);
      assert.match(message, /<recent_calendar_events>/);
      assert.match(message, /<recent_event_analysis>/);
      assert.match(message, /<recent_event_chains>/);
      assert.match(message, /<upcoming_calendar_events>/);
      assert.match(message, /Bitcoin/);
      assert.match(message, /CPI release/);
      assert.match(message, /Token unlock/);
    });
  });
});
