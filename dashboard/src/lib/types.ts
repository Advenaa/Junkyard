export interface User {
  discordId: string;
  username: string;
  avatar: string | null;
  role: 'admin' | 'viewer' | 'blocked';
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
