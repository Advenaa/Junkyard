export interface User {
  discordId: string;
  username: string;
  avatar: string | null;
  role: 'admin' | 'viewer' | 'blocked';
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
