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
