export interface User {
  discordId: string;
  username: string;
  avatar: string | null;
  role: 'admin' | 'viewer' | 'blocked';
}

export type FeatureKey = 'embeddings' | 'prices' | 'macro';
export type FeatureDisabledReason = 'missing_env' | 'auth_failed';

export interface DisabledFeatureSummary {
  feature: FeatureKey;
  missingEnv: string;
  disables: string[];
  reason?: FeatureDisabledReason;
}

export interface StatusSnapshot {
  itemsReady: number;
  itemsProcessing: number;
  summariesToday: number;
  reportsToday?: number;
  costToday: number;
  disabledFeatures: DisabledFeatureSummary[];
}

export interface FeatureDisabledBody {
  error: 'feature_disabled';
  feature: FeatureKey;
  missingEnv: string;
  disables: string[];
  reason?: FeatureDisabledReason;
}

export interface MacroRegime {
  classification: 'risk-on' | 'risk-off' | 'transition' | 'unclear';
  confidence: number;
  rationale: string;
}

export interface MacroRegimeHistory {
  streakDays: number;
  regimeStartedAt: string;
  previousClassification: MacroRegime['classification'] | null;
}

export interface Report {
  id: string;
  date: string;
  type: 'daily' | 'flash' | 'pulse';
  tldr: string;
  sentiment: number | null;
  deliveryStatus: string;
  createdAt: number;
  eventChains?: string[];
  chainDrilldowns?: ReportChainDrilldown[];
  hasMoreActiveChains?: boolean;
  hiddenActiveChainCount?: number;
  marketCatalysts?: string[];
  regionalDivergence?: string[];
  narrativeShifts?: string[];
  firstMovers?: string[];
  alphaSignals?: string[];
  priceAlerts?: string[];
  unusualActivity?: string[];
  macroAlerts?: string[];
  macroRegime?: MacroRegime | null;
  macroRegimeHistory?: MacroRegimeHistory | null;
  sourceFamilies?: string[];
}

export interface ReportChainDrilldown {
  rootId: string;
  entityName: string;
  eventCount: number;
  firstEventTime: number;
  latestEventTime: number;
  eventTypes: string[];
  latestSummaryId: string;
  latestEventType: string;
  latestEventDescription: string;
}

export type MacroBias = 'risk-on' | 'risk-off' | 'mixed';

export type MacroSignal = 'risk-on' | 'risk-off' | 'neutral';

export type MacroIndicator = 'vix' | 'dxy' | 'us10y' | 'spx' | 'gold';

export type NarrativeSignalStrength = 'new' | 'emerging' | 'strong' | 'stable' | 'fading';

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
