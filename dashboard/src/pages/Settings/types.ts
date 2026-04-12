export type Tab = 'sources' | 'delivery' | 'pipeline' | 'entities' | 'users';

export type IsoDateTimeString = string;

export interface Source {
  source: string;
  sourceId: string;
  label: string | null;
  enabled: boolean;
  pollInterval: number;
  lastFetchedAt: number | null;
  errorCount: number;
  lastError: string | null;
  status: string;
  stateStatus: string | null;
  nextRetryAt: number | null;
  tier: string;
}

export interface PipelineStatus {
  itemsReady: number;
  itemsProcessing: number;
  summariesToday: number;
  costToday: number;
  twitterApiKeyConfigured?: boolean;
}

export type MacroBias = 'risk-on' | 'risk-off' | 'mixed';

export type MacroSignal = 'risk-on' | 'risk-off' | 'neutral';

export type MacroIndicator = 'vix' | 'dxy' | 'us10y' | 'spx' | 'gold';

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

export type NarrativeSignalStrength = 'new' | 'emerging' | 'strong' | 'stable' | 'fading';

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

export interface NarrativeSummaryPreview {
  id: string;
  source: string;
  sourceId: string;
  sentiment: number | null;
  urgency: 'routine' | 'elevated' | 'breaking' | null;
  itemCount: number;
  createdAt: number;
  text: string;
}

export interface NarrativeDrilldown {
  id: string;
  name: string;
  date: string;
  memberCount: number;
  avgSentiment: number | null;
  signalStrength: NarrativeSignalStrength;
  summaries: NarrativeSummaryPreview[];
}

export interface HealthCheck {
  name: string;
  status: 'ok' | 'warn' | 'critical';
  message?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  checks: HealthCheck[];
}

export interface DiagBackpressure {
  readyCount: number;
  processingCount: number;
  oldestReadyAgeMs: number;
}

export interface DiagStuckItemSample {
  id: string;
  source: string;
  sourceId: string;
  createdAt: IsoDateTimeString;
}

export interface DiagStuckItems {
  thresholdMs: number;
  stuckCount: number;
  oldestAgeMs: number;
  sample: DiagStuckItemSample[];
}

export interface DiagHaltedSource {
  source: string;
  sourceId: string;
  status: string;
  errorCount: number | null;
  lastError: string | null;
  lastFetchedAt: IsoDateTimeString | null;
}

export interface DiagHaltedSources {
  haltedSources: DiagHaltedSource[];
}

export interface DiagHealthEvent {
  id: string;
  category: string;
  severity: string;
  message: string;
  metadata: unknown;
  acknowledged: boolean;
  createdAt: IsoDateTimeString;
}

export interface DiagHealthEvents {
  sinceMs: number;
  limit: number;
  events: DiagHealthEvent[];
}

export interface LlmCostByModelEntry {
  model: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
}

export interface LlmCostByModelResponse {
  timezone: string;
  sinceMs: number;
  entries: LlmCostByModelEntry[];
}

export interface Config {
  webhookUrl: string | null;
  digestTime: string | null;
  timezone: string | null;
  publicUrl: string | null;
  apiKey: string | null;
}

export interface UserRecord {
  discordId: string;
  username: string;
  avatar: string | null;
  role: 'admin' | 'viewer' | 'blocked';
  createdAt: number;
  lastLoginAt: number | null;
}

export interface UserAuditEvent {
  id: string;
  actorDiscordId: string;
  actorUsername: string;
  targetDiscordId: string;
  targetUsername: string | null;
  action: 'invite' | 'role_change' | 'request_approved' | 'request_rejected';
  previousRole: string | null;
  newRole: 'admin' | 'viewer' | 'blocked' | null;
  createdAt: number;
}

export interface AccessRequest {
  id: string;
  discordId: string;
  requestedRole: 'viewer' | 'admin';
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  resolvedRole: 'viewer' | 'admin' | null;
  decidedAt: number | null;
  decidedByDiscordId: string | null;
  createdAt: number;
}

export interface DiscordManagedToken {
  id: string;
  maskedToken: string;
  label: string | null;
  status: 'active' | 'disabled';
  addedAt: number;
  lastUsedAt: number | null;
  proxyConfigured: boolean;
  maskedProxy: string | null;
}

export interface DiscordTokenHealthState {
  index: number;
  status: 'active' | 'idle' | 'disabled';
  errorCount: number;
  lastSuccessfulPollAt: number | null;
  channelCount: number;
  source: 'env' | 'db';
  tokenId: string | null;
  label: string | null;
  maskedToken: string | null;
  proxyConfigured: boolean;
  maskedProxy: string | null;
}

export interface CalendarEvent {
  id: string;
  name: string;
  category: 'macro' | 'unlock' | 'expiry' | 'governance' | 'launch' | 'legal' | 'custom';
  description: string | null;
  recurrenceRule: 'daily' | 'weekly' | 'monthly' | 'quarterly' | null;
  entityId: string | null;
  entityName: string | null;
  nextOccurrence: number;
  createdAt: number;
}

export interface EntitySuggestion {
  id: string;
  name: string;
  matchedAlias: string | null;
  status: 'active' | 'archived';
  relevance: number;
  lastSeen: number;
}

export type EntityAliasOrigin = 'seed' | 'llm' | 'manual' | 'unknown';

export interface EntityAlias {
  id: string;
  entityId: string;
  alias: string;
  origin: EntityAliasOrigin;
  createdAt: number;
}

export type EntityRelationshipType =
  | 'competes_with'
  | 'built_on'
  | 'invested_in'
  | 'forked_from'
  | 'acquired'
  | 'founded'
  | 'advises'
  | 'partnered_with'
  | 'regulated_by';

export type EntityRelationshipSource = 'llm_inferred' | 'manual' | 'coingecko';

export interface EntityRelationship {
  id: string;
  entityIdA: string;
  entityNameA: string;
  entityIdB: string;
  entityNameB: string;
  relationshipType: EntityRelationshipType;
  confidence: number;
  source: EntityRelationshipSource;
  summaryId: string | null;
  sinceAt: number | null;
  untilAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface EntityRelationshipGraphNode {
  id: string;
  name: string;
  depth: number;
  isRoot: boolean;
}

export interface EntityRelationshipGraphData {
  rootEntityId: string;
  nodes: EntityRelationshipGraphNode[];
  relationships: EntityRelationship[];
}

export interface EntityDivergence {
  engSentiment: number | null;
  engMentions: number;
  indSentiment: number | null;
  indMentions: number;
  divergence: number | null;
}

export interface EntityPriceSnapshot {
  id: string;
  entityId: string;
  timestamp: number;
  priceUsd: number;
  priceChange24h: number | null;
  priceChange7d: number | null;
  volume24h: number | null;
  marketCap: number | null;
  source: string;
  createdAt: number;
}

export interface EntityPriceData {
  latest: EntityPriceSnapshot | null;
  history: EntityPriceSnapshot[];
}

export interface AlphaPropagationSummaryEntry {
  tier: string;
  firstMentionTime: number;
  source: string;
  sourceId: string;
}

export interface AlphaPropagationRecord {
  id: string;
  entityId: string;
  tier: string;
  source: string;
  sourceId: string;
  firstMentionTime: number;
  eventId: string | null;
  itemId: string | null;
  createdAt: number;
}

export interface AlphaPropagationData {
  summary: AlphaPropagationSummaryEntry[];
  records: AlphaPropagationRecord[];
}

export interface AuthorRecord {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
  createdAt: number;
}

export interface EntityAuthor extends AuthorRecord {
  entityMentionCount: number;
  firstEntityCallTime: number | null;
  firstMover: boolean;
  firstMoverLagMs: number | null;
}

export type AuthorClaimType = 'bullish' | 'bearish' | 'event' | 'neutral';

export interface AuthorCall {
  id: string;
  authorId: string;
  entityId: string;
  entityName: string | null;
  claimType: AuthorClaimType;
  claimText: string;
  confidence: number;
  sourceItemId: string | null;
  timestamp: number;
  createdAt: number;
}

export interface AuthorProfileData {
  author: AuthorRecord;
  calls: AuthorCall[];
}

export interface EntityRelationshipGraphConnection {
  relatedEntityId: string;
  relatedEntityName: string;
  relationships: EntityRelationship[];
  primaryRelationship: EntityRelationship;
  hasEvidence: boolean;
  isEnded: boolean;
}

export interface SessionInfo {
  managementId: string;
  discordId: string;
  createdAt: number;
  expiresAt: number;
  lastRefreshedAt: number;
  ipAddress: string | null;
  userAgent: string | null;
  normalizedUA: string | null;
}

export interface EntityRelationshipSecondDegreeGroup {
  relatedEntityId: string;
  relatedEntityName: string;
  nodes: EntityRelationshipGraphNode[];
}
