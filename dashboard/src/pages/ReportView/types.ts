import type { MacroRegime, MacroRegimeHistory, Report, ReportChainDrilldown } from '../../lib/types';

export type { MacroRegime, MacroRegimeHistory, Report, ReportChainDrilldown };

export interface EntitySentiment {
  name: string;
  sentiment: number;
  reason: string;
}

export interface Section {
  title: string;
  body: string;
}

export type NarrativeSignalStrength = 'new' | 'emerging' | 'strong' | 'stable' | 'fading';
export type MacroBias = 'risk-on' | 'risk-off' | 'mixed';
export type MacroSignal = 'risk-on' | 'risk-off' | 'neutral';
export type MacroIndicator = 'vix' | 'dxy' | 'us10y' | 'spx' | 'gold';
export type PriceContrarianSignal = 'price-up-sentiment-down' | 'price-down-sentiment-up';
export type SourceTier = 'alpha' | 'influencer' | 'general' | 'mainstream';
export type CalendarEventCategory = 'macro' | 'unlock' | 'expiry' | 'governance' | 'launch' | 'legal' | 'custom';
export type CalendarEventRecurrence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | null;
export type RegionalSentimentTone = 'bullish' | 'bearish' | 'neutral' | 'insufficient';

export interface MacroOverviewEntry {
  indicator: MacroIndicator;
  label: string;
  value: number;
  change1d: number | null;
  change7d: number | null;
  date: string;
  signal: MacroSignal;
  narrative: string;
}

export interface MacroOverview {
  overallBias: MacroBias;
  latestDate: string | null;
  entries: MacroOverviewEntry[];
}

export interface PriceWatchEntry {
  entityId: string;
  entityName: string;
  timestamp: number;
  priceUsd: number;
  priceChange24h: number | null;
  priceChange7d: number | null;
  volume24h: number | null;
  marketCap: number | null;
  avgSentiment: number | null;
  momentum: number | null;
  contrarianSignal: PriceContrarianSignal | null;
}

export interface PriceWatchOverview {
  latestTimestamp: number | null;
  entries: PriceWatchEntry[];
}

export interface NarrativeWatchlistEntry {
  id: string;
  name: string;
  date: string;
  memberCount: number;
  avgSentiment: number | null;
  signalStrength: NarrativeSignalStrength;
}

export interface NarrativeWatchlistOverview {
  latestDate: string | null;
  entries: NarrativeWatchlistEntry[];
}

export interface UnusualActivityEntry {
  entityId: string;
  entityName: string;
  date: string;
  mentionCount: number;
  baselineMentionCount: number | null;
  baselinePeakMentionCount: number | null;
  baselineDays: number;
  avgSentiment: number | null;
  momentum: number | null;
  spikeRatio: number | null;
  relevanceScore: number | null;
  lowRelevance: boolean;
  duplicateClusterSize: number | null;
  duplicateAuthorCount: number | null;
  duplicateSourceCount: number | null;
}

export interface UnusualActivityOverview {
  latestDate: string | null;
  entries: UnusualActivityEntry[];
}

export interface FirstMoverWatchlistEntry {
  entityId: string;
  entityName: string;
  authorId: string;
  platform: string;
  handle: string;
  displayName: string | null;
  claimType: string;
  claimText: string;
  sourceItemId: string | null;
  timestamp: number;
  nextTrackedCallTime: number | null;
  leadWindowMs: number | null;
  credibilityScore: number | null;
  totalCalls: number;
  correctCalls: number;
}

export interface FirstMoverWatchlistOverview {
  latestTimestamp: number | null;
  entries: FirstMoverWatchlistEntry[];
}

export interface AlphaWatchEntry {
  entityId: string;
  entityName: string;
  firstSignalTier: SourceTier;
  firstSignalTime: number;
  latestTier: SourceTier;
  latestMentionTime: number;
  propagationLagMs: number | null;
  tierCount: number;
  sourceCount: number;
}

export interface AlphaWatchOverview {
  latestTimestamp: number | null;
  entries: AlphaWatchEntry[];
}

export interface CalendarEventSnapshotEntry {
  id: string;
  name: string;
  category: CalendarEventCategory;
  description: string | null;
  recurrenceRule: CalendarEventRecurrence;
  entityId: string | null;
  entityName: string | null;
  nextOccurrence: number;
  createdAt: number;
}

export interface RegionalDivergenceEntry {
  entityId: string;
  entityName: string;
  engSentiment: number | null;
  engMentions: number;
  indSentiment: number | null;
  indMentions: number;
  divergence: number;
}

export interface FullReport extends Report {
  body: string | null;
  keyEvents: string[];
  marketCatalysts: string[];
  regionalDivergence: string[];
  narrativeShifts: string[];
  eventChains: string[];
  firstMovers: string[];
  alphaSignals: string[];
  priceAlerts: string[];
  unusualActivity: string[];
  macroAlerts: string[];
  macroRegime: MacroRegime | null;
  macroRegimeHistory?: MacroRegimeHistory | null;
  chainDrilldowns?: ReportChainDrilldown[];
  entitySentiment: EntitySentiment[];
  sections: Section[];
}

export const NARRATIVE_PREVIEW_LIMIT = 3;
export const MACRO_PREVIEW_LIMIT = 3;
export const PRICE_WATCH_PREVIEW_LIMIT = 3;
export const UNUSUAL_ACTIVITY_PREVIEW_LIMIT = 3;
export const FIRST_MOVER_PREVIEW_LIMIT = 3;
export const ALPHA_WATCH_PREVIEW_LIMIT = 3;
export const CALENDAR_PREVIEW_LIMIT = 3;
export const REGIONAL_DIVERGENCE_PREVIEW_LIMIT = 3;
export const REGIONAL_DIVERGENCE_DAYS = 7;
