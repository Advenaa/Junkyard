import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { apiFetch, isApiError, isFeatureDisabledError } from '../lib/api';
import { useAuth } from '../components/AuthProvider';
import { useStatus } from '../components/StatusProvider';
import { FeatureDisabledCard } from '../components/FeatureDisabledCard';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';

type Tab = 'sources' | 'delivery' | 'pipeline' | 'entities' | 'users';
type IsoDateTimeString = string;

interface Source {
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

interface PipelineStatus {
  itemsReady: number;
  itemsProcessing: number;
  summariesToday: number;
  costToday: number;
  twitterApiKeyConfigured?: boolean;
}

type MacroBias = 'risk-on' | 'risk-off' | 'mixed';
type MacroSignal = 'risk-on' | 'risk-off' | 'neutral';
type MacroIndicator = 'vix' | 'dxy' | 'us10y' | 'spx' | 'gold';

interface MacroOverviewEntry {
  indicator: MacroIndicator;
  label: string;
  value: number;
  change1d: number | null;
  change7d: number | null;
  date: string;
  signal: MacroSignal;
  narrative: string;
}

interface MacroOverview {
  overallBias: MacroBias;
  latestDate: string | null;
  entries: MacroOverviewEntry[];
}

interface UnusualActivityEntry {
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

interface UnusualActivityOverview {
  latestDate: string | null;
  entries: UnusualActivityEntry[];
}

type NarrativeSignalStrength = 'new' | 'emerging' | 'strong' | 'stable' | 'fading';

interface NarrativeWatchlistEntry {
  id: string;
  name: string;
  date: string;
  memberCount: number;
  avgSentiment: number | null;
  signalStrength: NarrativeSignalStrength;
}

interface NarrativeWatchlistOverview {
  latestDate: string | null;
  entries: NarrativeWatchlistEntry[];
}

interface NarrativeSummaryPreview {
  id: string;
  source: string;
  sourceId: string;
  sentiment: number | null;
  urgency: 'routine' | 'elevated' | 'breaking' | null;
  itemCount: number;
  createdAt: number;
  text: string;
}

interface NarrativeDrilldown {
  id: string;
  name: string;
  date: string;
  memberCount: number;
  avgSentiment: number | null;
  signalStrength: NarrativeSignalStrength;
  summaries: NarrativeSummaryPreview[];
}

interface HealthCheck {
  name: string;
  status: 'ok' | 'warn' | 'critical';
  message?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  checks: HealthCheck[];
}

interface DiagBackpressure {
  readyCount: number;
  processingCount: number;
  oldestReadyAgeMs: number;
}

interface DiagStuckItemSample {
  id: string;
  source: string;
  sourceId: string;
  createdAt: IsoDateTimeString;
}

interface DiagStuckItems {
  thresholdMs: number;
  stuckCount: number;
  oldestAgeMs: number;
  sample: DiagStuckItemSample[];
}

interface DiagHaltedSource {
  source: string;
  sourceId: string;
  status: string;
  errorCount: number | null;
  lastError: string | null;
  lastFetchedAt: IsoDateTimeString | null;
}

interface DiagHaltedSources {
  haltedSources: DiagHaltedSource[];
}

interface DiagHealthEvent {
  id: string;
  category: string;
  severity: string;
  message: string;
  metadata: unknown;
  acknowledged: boolean;
  createdAt: IsoDateTimeString;
}

interface DiagHealthEvents {
  sinceMs: number;
  limit: number;
  events: DiagHealthEvent[];
}

interface LlmCostByModelEntry {
  model: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
}

interface LlmCostByModelResponse {
  timezone: string;
  sinceMs: number;
  entries: LlmCostByModelEntry[];
}

interface Config {
  webhookUrl: string | null;
  digestTime: string | null;
  timezone: string | null;
  publicUrl: string | null;
  apiKey: string | null;
}

interface UserRecord {
  discordId: string;
  username: string;
  avatar: string | null;
  role: 'admin' | 'viewer' | 'blocked';
  createdAt: number;
  lastLoginAt: number | null;
}

interface UserAuditEvent {
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

interface AccessRequest {
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

interface DiscordManagedToken {
  id: string;
  maskedToken: string;
  label: string | null;
  status: 'active' | 'disabled';
  addedAt: number;
  lastUsedAt: number | null;
  proxyConfigured: boolean;
  maskedProxy: string | null;
}

interface DiscordTokenHealthState {
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

interface CalendarEvent {
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

interface EntitySuggestion {
  id: string;
  name: string;
  matchedAlias: string | null;
  status: 'active' | 'archived';
  relevance: number;
  lastSeen: number;
}

type EntityRelationshipType =
  | 'competes_with'
  | 'built_on'
  | 'invested_in'
  | 'forked_from'
  | 'acquired'
  | 'founded'
  | 'advises'
  | 'partnered_with'
  | 'regulated_by';
type EntityRelationshipSource = 'llm_inferred' | 'manual' | 'coingecko';

interface EntityRelationship {
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

interface EntityRelationshipGraphNode {
  id: string;
  name: string;
  depth: number;
  isRoot: boolean;
}

interface EntityRelationshipGraphData {
  rootEntityId: string;
  nodes: EntityRelationshipGraphNode[];
  relationships: EntityRelationship[];
}

interface EntityDivergence {
  engSentiment: number | null;
  engMentions: number;
  indSentiment: number | null;
  indMentions: number;
  divergence: number | null;
}

interface EntityPriceSnapshot {
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

interface EntityPriceData {
  latest: EntityPriceSnapshot | null;
  history: EntityPriceSnapshot[];
}

interface AlphaPropagationSummaryEntry {
  tier: string;
  firstMentionTime: number;
  source: string;
  sourceId: string;
}

interface AlphaPropagationRecord {
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

interface AlphaPropagationData {
  summary: AlphaPropagationSummaryEntry[];
  records: AlphaPropagationRecord[];
}

interface AuthorRecord {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
  createdAt: number;
}

interface EntityAuthor extends AuthorRecord {
  entityMentionCount: number;
  firstEntityCallTime: number | null;
  firstMover: boolean;
  firstMoverLagMs: number | null;
}

type AuthorClaimType = 'bullish' | 'bearish' | 'event' | 'neutral';

interface AuthorCall {
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

interface AuthorProfileData {
  author: AuthorRecord;
  calls: AuthorCall[];
}

function getSourceDisplayName(source: Pick<Source, 'source' | 'sourceId' | 'label'>): string {
  const trimmedLabel = typeof source.label === 'string' ? source.label.trim() : '';
  if (trimmedLabel) return trimmedLabel;

  const trimmedSourceId = source.sourceId.trim();
  if (trimmedSourceId) return trimmedSourceId;

  return `${source.source} source`;
}

function buildSourceActionPath(source: Pick<Source, 'source' | 'sourceId'>): string {
  const params = new URLSearchParams();
  params.set('sourceId', source.sourceId);
  return `/sources/${encodeURIComponent(source.source)}?${params.toString()}`;
}

async function fetchSourcesData(): Promise<Source[]> {
  const res = await apiFetch<{ sources: Source[] }>('/sources');
  return res.sources;
}

async function fetchDiscordTokensData(): Promise<DiscordManagedToken[]> {
  const res = await apiFetch<{ tokens: DiscordManagedToken[] }>('/discord/tokens');
  return res.tokens;
}

async function fetchDiscordTokenHealthData(): Promise<DiscordTokenHealthState[]> {
  const res = await apiFetch<{ states: DiscordTokenHealthState[] }>('/discord/tokens/health');
  return res.states;
}

async function fetchUsersData(): Promise<UserRecord[]> {
  const res = await apiFetch<{ users: UserRecord[] }>('/users');
  return res.users;
}

async function fetchUserAuditEventsData(): Promise<UserAuditEvent[]> {
  const res = await apiFetch<{ events: UserAuditEvent[] }>('/users/audit');
  return res.events;
}

async function fetchAccessRequestsData(): Promise<AccessRequest[]> {
  const res = await apiFetch<{ requests: AccessRequest[] }>('/access-requests');
  return res.requests;
}

async function fetchCalendarEventsData(): Promise<CalendarEvent[]> {
  const res = await apiFetch<{ events: CalendarEvent[] }>('/calendar-events');
  return res.events;
}

async function fetchMacroOverviewData(): Promise<MacroOverview | null> {
  try {
    return await apiFetch<MacroOverview>('/macro');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('404')) {
      return null;
    }
    throw err;
  }
}

async function fetchDiagBackpressure(): Promise<DiagBackpressure> {
  return apiFetch<DiagBackpressure>('/diag/backpressure');
}

async function fetchLlmCostByModel(): Promise<LlmCostByModelResponse> {
  return apiFetch<LlmCostByModelResponse>('/llm/cost-by-model');
}

async function fetchDiagStuckItems(): Promise<DiagStuckItems> {
  return apiFetch<DiagStuckItems>('/diag/stuck-items');
}

async function fetchDiagHaltedSources(): Promise<DiagHaltedSources> {
  return apiFetch<DiagHaltedSources>('/diag/halted-sources');
}

async function fetchDiagHealthEvents(limit = 10): Promise<DiagHealthEvents> {
  return apiFetch<DiagHealthEvents>(`/diag/health-events?limit=${limit}`);
}

async function fetchUnusualActivityOverviewData(): Promise<UnusualActivityOverview> {
  return apiFetch<UnusualActivityOverview>('/unusual-activity');
}

async function fetchNarrativeWatchlistData(): Promise<NarrativeWatchlistOverview> {
  return apiFetch<NarrativeWatchlistOverview>('/narratives');
}

async function fetchNarrativeDrilldownData(narrativeId: string): Promise<NarrativeDrilldown> {
  const res = await apiFetch<{ narrative: NarrativeDrilldown }>(`/narratives/${narrativeId}`);
  return res.narrative;
}

async function fetchEntitySuggestionsData(
  query: string,
  statusFilter: 'active' | 'archived' | null = null,
): Promise<EntitySuggestion[]> {
  const params = new URLSearchParams({
    q: query,
    limit: '6',
  });
  if (statusFilter != null) {
    params.set('status', statusFilter);
  }

  const res = await apiFetch<{ entities: EntitySuggestion[] }>(`/entities/search?${params.toString()}`);
  return res.entities;
}

async function fetchEntityRelationshipsData(entityId: string): Promise<EntityRelationship[]> {
  const res = await apiFetch<{ relationships: EntityRelationship[] }>(`/entities/${entityId}/relationships`);
  return res.relationships;
}

async function fetchEntityCompetitorsData(entityId: string): Promise<EntityRelationship[]> {
  const res = await apiFetch<{ competitors: EntityRelationship[] }>(`/entities/${entityId}/competitors`);
  return res.competitors;
}

async function fetchEntityRelationshipGraphData(entityId: string): Promise<EntityRelationshipGraphData> {
  return apiFetch<EntityRelationshipGraphData>(`/entities/${entityId}/graph?depth=2&limit=18`);
}

async function fetchEntityDivergenceData(entityId: string, days: number): Promise<EntityDivergence> {
  const res = await apiFetch<{ divergence: EntityDivergence }>(`/entities/${entityId}/divergence?days=${days}`);
  return res.divergence;
}

async function fetchEntityPriceData(entityId: string, days: number): Promise<EntityPriceData> {
  return apiFetch<EntityPriceData>(`/entities/${entityId}/price?days=${days}`);
}

function isApi404(err: unknown): boolean {
  return err instanceof Error && /^API 404\b/.test(err.message);
}

async function fetchAlphaPropagation(entityId: string, days: number): Promise<AlphaPropagationData | null> {
  try {
    const res = await apiFetch<AlphaPropagationData>(`/entities/${entityId}/alpha?days=${days}`);
    return res;
  } catch {
    return null;
  }
}

async function fetchEntityAuthorsData(entityId: string): Promise<EntityAuthor[]> {
  const res = await apiFetch<{ authors: EntityAuthor[] }>(`/entities/${entityId}/authors?limit=12`);
  return res.authors;
}

async function fetchAuthorProfileData(authorId: string): Promise<AuthorProfileData> {
  return apiFetch<AuthorProfileData>(`/authors/${authorId}?callLimit=20`);
}

function clampEntityRelevance(relevance: number): number {
  if (!Number.isFinite(relevance)) return 0;
  return Math.min(Math.max(relevance, 0), 1);
}

function getEntityStatusBadgeClasses(status: EntitySuggestion['status']): string {
  return status === 'active'
    ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-300'
    : 'bg-background border border-border text-text-secondary';
}

function formatEntityRelevancePercent(relevance: number): string {
  return `${Math.round(clampEntityRelevance(relevance) * 100)}%`;
}

function EntityLifecycleMeta({
  entity,
  align = 'end',
}: {
  entity: Pick<EntitySuggestion, 'status' | 'relevance'>;
  align?: 'start' | 'end';
}) {
  const relevancePercent = formatEntityRelevancePercent(entity.relevance);

  return (
    <div className={`flex items-center gap-2 flex-wrap ${align === 'end' ? 'justify-end' : ''}`}>
      <span
        className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${getEntityStatusBadgeClasses(entity.status)}`}
      >
        {entity.status}
      </span>
      <div className="flex items-center gap-2" aria-label={`Relevance ${relevancePercent}`}>
        <div className="h-1.5 w-14 rounded-full border border-border bg-background overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-200"
            style={{
              width: relevancePercent,
              backgroundColor: entity.status === 'active' ? '#34d399' : '#6b7280',
            }}
          />
        </div>
        <span className="text-[11px] font-mono uppercase tracking-wide text-text-secondary">{relevancePercent}</span>
      </div>
    </div>
  );
}

function buildFallbackEntitySuggestion(id: string, name: string): EntitySuggestion {
  return {
    id,
    name,
    matchedAlias: null,
    status: 'active',
    relevance: 0,
    lastSeen: Date.now(),
  };
}

function formatCompactNumber(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(2);
}

function macroToneClasses(tone: MacroBias | MacroSignal): string {
  switch (tone) {
    case 'risk-on':
      return 'bg-accent-green/15 text-accent-green border border-accent-green/25';
    case 'risk-off':
      return 'bg-accent-red/15 text-accent-red border border-accent-red/25';
    case 'neutral':
    case 'mixed':
    default:
      return 'bg-background text-text-secondary border border-border';
  }
}

function formatMacroValue(entry: MacroOverviewEntry): string {
  if (entry.indicator === 'spx') {
    return entry.value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return entry.value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMacroChange(value: number | null, indicator: MacroIndicator): string {
  if (value == null) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString('en-US', {
    minimumFractionDigits: indicator === 'spx' ? 0 : 2,
    maximumFractionDigits: indicator === 'spx' ? 0 : 2,
  })}`;
}

function formatUnusualActivityRatio(ratio: number | null): string {
  if (ratio == null) return 'New breakout';
  return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}x baseline`;
}

function formatUnusualActivityRelevance(score: number | null): string {
  if (score == null) return 'n/a';
  return score >= 10 ? score.toFixed(0) : score.toFixed(1);
}

function unusualActivityBadgeClasses(entry: UnusualActivityEntry): string {
  if (entry.duplicateClusterSize != null && entry.duplicateClusterSize >= 4) {
    return 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25';
  }
  if (entry.lowRelevance) {
    return 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25';
  }
  if (entry.spikeRatio == null) {
    return 'bg-accent/10 text-accent border border-accent/20';
  }
  if (entry.spikeRatio >= 5) {
    return 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25';
  }
  return 'bg-accent/10 text-accent border border-accent/20';
}

function formatSignedFixed(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

function formatUnusualActivityNarrative(entry: UnusualActivityEntry): string {
  const relevanceNarrative = entry.lowRelevance
    ? ` Podders still scores this entity as lower relevance${entry.relevanceScore == null ? '' : ` (${formatUnusualActivityRelevance(entry.relevanceScore)})`}, so sudden attention here deserves manual verification.`
    : '';
  const duplicateNarrative =
    entry.duplicateClusterSize == null || entry.duplicateAuthorCount == null
      ? ''
      : ` A near-duplicate cluster tied together ${entry.duplicateClusterSize} posts from ${entry.duplicateAuthorCount} authors${entry.duplicateSourceCount != null ? ` across ${entry.duplicateSourceCount} source streams` : ''}.`;

  if (entry.baselineMentionCount == null || entry.baselineDays === 0) {
    return `${entry.mentionCount} mentions on the latest daily rollup without enough prior history to set a baseline yet.${relevanceNarrative}${duplicateNarrative}`;
  }

  return `${entry.mentionCount} mentions versus ${entry.baselineMentionCount.toFixed(1)}/day across ${entry.baselineDays} prior day${entry.baselineDays === 1 ? '' : 's'}.${relevanceNarrative}${duplicateNarrative}`;
}

function narrativeSignalClasses(signalStrength: NarrativeSignalStrength): string {
  switch (signalStrength) {
    case 'new':
      return 'bg-accent/10 text-accent border border-accent/20';
    case 'emerging':
      return 'bg-accent-green/15 text-accent-green border border-accent-green/25';
    case 'strong':
      return 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25';
    case 'stable':
      return 'bg-background text-text-secondary border border-border';
    case 'fading':
      return 'bg-accent-red/15 text-accent-red border border-accent-red/25';
  }
}

function formatNarrativeSignalLabel(signalStrength: NarrativeSignalStrength): string {
  switch (signalStrength) {
    case 'new':
      return 'New';
    case 'emerging':
      return 'Emerging';
    case 'strong':
      return 'Strong';
    case 'stable':
      return 'Stable';
    case 'fading':
      return 'Fading';
  }
}

function formatNarrativeSentiment(avgSentiment: number | null): string {
  if (avgSentiment == null) return 'sentiment n/a';
  return `sentiment ${formatSignedFixed(avgSentiment)}`;
}

function formatNarrativeLifecycleCopy(entry: NarrativeWatchlistEntry): string {
  switch (entry.signalStrength) {
    case 'new':
      return 'Fresh cluster with no close prior-day analogue in the recent narrative history.';
    case 'emerging':
      return 'Growing versus the closest recent narrative cluster and worth watching for follow-through.';
    case 'strong':
      return 'Meaningfully larger than the closest recent cluster, suggesting the theme is accelerating.';
    case 'stable':
      return 'Holding a similar footprint to the prior cluster rather than clearly accelerating or fading.';
    case 'fading':
      return 'Smaller than the closest recent cluster, so the theme is still active but losing momentum.';
  }
}

const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    // Fallback for older environments
    return [
      'Asia/Jakarta',
      'UTC',
      'America/New_York',
      'America/Los_Angeles',
      'Europe/London',
      'Europe/Berlin',
      'Asia/Tokyo',
      'Asia/Singapore',
      'Asia/Hong_Kong',
      'Australia/Sydney',
    ];
  }
})();

const CALENDAR_EVENT_CATEGORIES: Array<{ value: CalendarEvent['category']; label: string }> = [
  { value: 'macro', label: 'Macro' },
  { value: 'unlock', label: 'Unlock' },
  { value: 'expiry', label: 'Expiry' },
  { value: 'governance', label: 'Governance' },
  { value: 'launch', label: 'Launch' },
  { value: 'legal', label: 'Legal' },
  { value: 'custom', label: 'Custom' },
];

const CALENDAR_RECURRENCE_RULES: Array<{ value: NonNullable<CalendarEvent['recurrenceRule']>; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

const ENTITY_RELATIONSHIP_TYPE_OPTIONS: Array<{ value: EntityRelationshipType; label: string }> = [
  { value: 'competes_with', label: 'Competes With' },
  { value: 'built_on', label: 'Built On' },
  { value: 'invested_in', label: 'Invested In' },
  { value: 'forked_from', label: 'Forked From' },
  { value: 'acquired', label: 'Acquired' },
  { value: 'founded', label: 'Founded' },
  { value: 'advises', label: 'Advises' },
  { value: 'partnered_with', label: 'Partnered With' },
  { value: 'regulated_by', label: 'Regulated By' },
];

const ENTITY_RELATIONSHIP_SOURCE_STYLES: Record<EntityRelationshipSource, string> = {
  llm_inferred: 'bg-accent/10 border border-accent/20 text-accent',
  manual: 'bg-accent-green/10 border border-accent-green/20 text-accent-green',
  coingecko: 'bg-background border border-border text-text-secondary',
};

const ENTITY_RELATIONSHIP_GRAPH_STYLES: Record<
  EntityRelationshipType,
  {
    lineColor: string;
    borderColor: string;
    surfaceColor: string;
    badgeBackground: string;
    badgeText: string;
  }
> = {
  competes_with: {
    lineColor: '#fb923c',
    borderColor: 'rgba(251, 146, 60, 0.44)',
    surfaceColor: 'rgba(251, 146, 60, 0.08)',
    badgeBackground: 'rgba(251, 146, 60, 0.18)',
    badgeText: '#fdba74',
  },
  built_on: {
    lineColor: '#38bdf8',
    borderColor: 'rgba(56, 189, 248, 0.44)',
    surfaceColor: 'rgba(56, 189, 248, 0.08)',
    badgeBackground: 'rgba(56, 189, 248, 0.18)',
    badgeText: '#7dd3fc',
  },
  invested_in: {
    lineColor: '#34d399',
    borderColor: 'rgba(52, 211, 153, 0.44)',
    surfaceColor: 'rgba(52, 211, 153, 0.08)',
    badgeBackground: 'rgba(52, 211, 153, 0.18)',
    badgeText: '#6ee7b7',
  },
  forked_from: {
    lineColor: '#facc15',
    borderColor: 'rgba(250, 204, 21, 0.44)',
    surfaceColor: 'rgba(250, 204, 21, 0.08)',
    badgeBackground: 'rgba(250, 204, 21, 0.18)',
    badgeText: '#fde047',
  },
  acquired: {
    lineColor: '#f87171',
    borderColor: 'rgba(248, 113, 113, 0.44)',
    surfaceColor: 'rgba(248, 113, 113, 0.08)',
    badgeBackground: 'rgba(248, 113, 113, 0.18)',
    badgeText: '#fca5a5',
  },
  founded: {
    lineColor: '#fb7185',
    borderColor: 'rgba(251, 113, 133, 0.44)',
    surfaceColor: 'rgba(251, 113, 133, 0.08)',
    badgeBackground: 'rgba(251, 113, 133, 0.18)',
    badgeText: '#fda4af',
  },
  advises: {
    lineColor: '#2dd4bf',
    borderColor: 'rgba(45, 212, 191, 0.44)',
    surfaceColor: 'rgba(45, 212, 191, 0.08)',
    badgeBackground: 'rgba(45, 212, 191, 0.18)',
    badgeText: '#5eead4',
  },
  partnered_with: {
    lineColor: '#60a5fa',
    borderColor: 'rgba(96, 165, 250, 0.44)',
    surfaceColor: 'rgba(96, 165, 250, 0.08)',
    badgeBackground: 'rgba(96, 165, 250, 0.18)',
    badgeText: '#93c5fd',
  },
  regulated_by: {
    lineColor: '#94a3b8',
    borderColor: 'rgba(148, 163, 184, 0.44)',
    surfaceColor: 'rgba(148, 163, 184, 0.08)',
    badgeBackground: 'rgba(148, 163, 184, 0.18)',
    badgeText: '#cbd5e1',
  },
};

const MAX_ENTITY_GRAPH_CONNECTIONS = 6;

interface EntityRelationshipGraphConnection {
  relatedEntityId: string;
  relatedEntityName: string;
  relationships: EntityRelationship[];
  primaryRelationship: EntityRelationship;
  hasEvidence: boolean;
  isEnded: boolean;
}

interface EntityRelationshipSecondDegreeGroup {
  relatedEntityId: string;
  relatedEntityName: string;
  nodes: EntityRelationshipGraphNode[];
}

function formatRelativeTime(dateValue: number | null): string {
  if (dateValue == null) return 'Never';
  const diff = Date.now() - dateValue;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatCountdown(futureMs: number): string {
  const diff = futureMs - Date.now();
  if (diff <= 0) return 'imminently';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `in ${secs}s`;
  const mins = Math.ceil(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.ceil(mins / 60);
  return `in ${hours}h`;
}

function decodeTwitterError(source: Source): string {
  if (source.source !== 'twitter') {
    return source.lastError || 'Source halted — check server logs for details';
  }

  const error = source.lastError ?? '';

  // 401 — invalid API key (halts all twitter sources)
  if (source.stateStatus === 'halted' && (error.includes('401') || error.includes('invalid_api_key'))) {
    return 'API key invalid or expired — all Twitter sources halted. Check TWITTERAPI_KEY in .env.';
  }

  // Rate limited with a future retry deadline
  if (source.nextRetryAt && source.nextRetryAt > Date.now()) {
    return `Rate limited — retrying ${formatCountdown(source.nextRetryAt)}`;
  }

  // Circuit breaker — consecutive failures
  if (
    source.stateStatus === 'halted' &&
    (error.includes('consecutive failures') || error.includes('circuit breaker'))
  ) {
    return 'Halted after repeated failures — check source ID and API key';
  }

  // Generic halted (twitter-specific but no recognized pattern)
  if (source.stateStatus === 'halted' && !error) {
    return 'Source halted — check server logs for details';
  }

  // Fallback: return raw error
  return error || 'Source halted — check server logs for details';
}

function formatCalendarEventTime(dateValue: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateValue);
}

function toDatetimeLocalInputValue(dateValue: number): string {
  const date = new Date(dateValue);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function defaultCalendarEventInputValue(): string {
  const next = new Date(Date.now() + 24 * 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  return toDatetimeLocalInputValue(next.getTime());
}

function parseDatetimeLocalInputValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateValue = new Date(trimmed).getTime();
  return Number.isFinite(dateValue) ? dateValue : null;
}

function formatCalendarRecurrence(recurrenceRule: CalendarEvent['recurrenceRule']): string {
  if (recurrenceRule == null) return 'One-time';
  return CALENDAR_RECURRENCE_RULES.find((rule) => rule.value === recurrenceRule)?.label ?? recurrenceRule;
}

function formatEntityRelationshipType(type: EntityRelationshipType): string {
  return ENTITY_RELATIONSHIP_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function formatEntityRelationshipSource(source: EntityRelationshipSource): string {
  if (source === 'llm_inferred') return 'LLM inferred';
  if (source === 'coingecko') return 'CoinGecko';
  return 'Manual';
}

function formatRelationshipBoundary(dateValue: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateValue);
}

function getRelatedEntityName(relationship: EntityRelationship, entityId: string): string {
  return relationship.entityIdA === entityId ? relationship.entityNameB : relationship.entityNameA;
}

function getRelatedEntityId(relationship: EntityRelationship, entityId: string): string {
  return relationship.entityIdA === entityId ? relationship.entityIdB : relationship.entityIdA;
}

function formatAuthorHandle(platform: string, handle: string): string {
  if (platform === 'twitter' && !handle.startsWith('@')) {
    return `@${handle}`;
  }
  return handle;
}

function formatAuthorPlatform(platform: string): string {
  if (platform === 'twitter') return 'Twitter/X';
  if (platform === 'discord') return 'Discord';
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

function formatAuthorClaimType(type: AuthorClaimType): string {
  if (type === 'bullish') return 'Bullish';
  if (type === 'bearish') return 'Bearish';
  if (type === 'event') return 'Event';
  return 'Neutral';
}

function getAuthorClaimTypeStyles(type: AuthorClaimType): string {
  if (type === 'bullish') return 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400';
  if (type === 'bearish') return 'bg-red-500/10 border border-red-500/20 text-red-400';
  if (type === 'event') return 'bg-blue-500/10 border border-blue-500/20 text-blue-400';
  return 'bg-background border border-border text-text-secondary';
}

function formatCompactDuration(durationMs: number): string {
  const safeDurationMs = Math.max(0, durationMs);
  const mins = Math.round(safeDurationMs / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;

  const hours = safeDurationMs / 3_600_000;
  if (hours < 24) {
    const roundedHours = Math.round(hours * 10) / 10;
    return `${Number.isInteger(roundedHours) ? roundedHours.toFixed(0) : roundedHours.toFixed(1)}h`;
  }

  const days = safeDurationMs / 86_400_000;
  const roundedDays = Math.round(days * 10) / 10;
  return `${Number.isInteger(roundedDays) ? roundedDays.toFixed(0) : roundedDays.toFixed(1)}d`;
}

function formatIsoDateTime(dateValue: string | null): string {
  if (!dateValue) return 'Never';
  const timestamp = Date.parse(dateValue);
  if (!Number.isFinite(timestamp)) return dateValue;
  return formatRelationshipBoundary(timestamp);
}

function formatIsoAge(dateValue: string): string {
  const timestamp = Date.parse(dateValue);
  if (!Number.isFinite(timestamp)) return 'Unknown';
  return formatCompactDuration(Date.now() - timestamp);
}

function truncateDiagnosticText(value: string | null, maxLength = 100): string {
  if (!value) return 'None';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function getDiagSeverityClasses(severity: string): string {
  if (severity === 'critical') return 'bg-accent-red/20 text-accent-red';
  if (severity === 'error') return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-background border border-border text-text-secondary';
}

function formatAuthorTiming(
  author: Pick<EntityAuthor, 'firstEntityCallTime' | 'firstMover' | 'firstMoverLagMs'> | null,
): string {
  if (author?.firstEntityCallTime == null) {
    return 'No tracked calls yet';
  }

  if (author.firstMover || (author.firstMoverLagMs ?? 0) <= 0) {
    return 'First mover';
  }

  return `+${formatCompactDuration(author.firstMoverLagMs ?? 0)} after lead`;
}

function getEntityRelationshipConnectionSummary(connection: EntityRelationshipGraphConnection): string {
  if (connection.relationships.length === 1) {
    return formatEntityRelationshipType(connection.primaryRelationship.relationshipType);
  }

  return `${connection.relationships.length} mapped links`;
}

function buildEntityRelationshipGraphConnections(
  entityId: string,
  relationships: EntityRelationship[],
): EntityRelationshipGraphConnection[] {
  const grouped = new Map<string, { relatedEntityName: string; relationships: EntityRelationship[] }>();
  for (const relationship of relationships) {
    const relatedEntityId = getRelatedEntityId(relationship, entityId);
    const relatedEntityName = getRelatedEntityName(relationship, entityId);
    const current = grouped.get(relatedEntityId);
    if (current) {
      current.relationships.push(relationship);
      continue;
    }

    grouped.set(relatedEntityId, {
      relatedEntityName,
      relationships: [relationship],
    });
  }

  const now = Date.now();

  return Array.from(grouped.entries())
    .map(([relatedEntityId, group]) => {
      const sortedRelationships = [...group.relationships].sort(
        (a, b) =>
          b.confidence - a.confidence ||
          b.updatedAt - a.updatedAt ||
          a.relationshipType.localeCompare(b.relationshipType),
      );

      return {
        relatedEntityId,
        relatedEntityName: group.relatedEntityName,
        relationships: sortedRelationships,
        primaryRelationship: sortedRelationships[0],
        hasEvidence: sortedRelationships.some((relationship) => relationship.summaryId != null),
        isEnded: sortedRelationships.every(
          (relationship) => relationship.untilAt != null && relationship.untilAt < now,
        ),
      };
    })
    .sort((a, b) => {
      if (a.isEnded !== b.isEnded) return a.isEnded ? 1 : -1;
      if (a.relationships.length !== b.relationships.length) return b.relationships.length - a.relationships.length;
      if (a.primaryRelationship.confidence !== b.primaryRelationship.confidence) {
        return b.primaryRelationship.confidence - a.primaryRelationship.confidence;
      }
      return a.relatedEntityName.localeCompare(b.relatedEntityName);
    });
}

function getEntityRelationshipGraphPosition(index: number, total: number): { x: number; y: number } {
  if (total <= 1) return { x: 50, y: 19 };

  const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
  return {
    x: 50 + Math.cos(angle) * 28,
    y: 50 + Math.sin(angle) * 31,
  };
}

function buildEntityRelationshipSecondDegreeGroups(
  graphData: EntityRelationshipGraphData | null,
  directConnections: EntityRelationshipGraphConnection[],
): EntityRelationshipSecondDegreeGroup[] {
  if (!graphData) return [];

  const nodeDepths = new Map(graphData.nodes.map((node) => [node.id, node.depth]));
  const directConnectionById = new Map(directConnections.map((connection) => [connection.relatedEntityId, connection]));
  const groups = new Map<string, EntityRelationshipGraphNode[]>();

  for (const node of graphData.nodes) {
    if (node.depth !== 2) continue;

    const candidateParents = graphData.relationships
      .filter((relationship) => {
        if (relationship.entityIdA === node.id) return nodeDepths.get(relationship.entityIdB) === 1;
        if (relationship.entityIdB === node.id) return nodeDepths.get(relationship.entityIdA) === 1;
        return false;
      })
      .sort(
        (a, b) =>
          b.updatedAt - a.updatedAt ||
          b.confidence - a.confidence ||
          a.relationshipType.localeCompare(b.relationshipType),
      );

    const parent = candidateParents[0];
    if (!parent) continue;

    const parentId = parent.entityIdA === node.id ? parent.entityIdB : parent.entityIdA;
    const connection = directConnectionById.get(parentId);
    if (!connection) continue;

    const current = groups.get(connection.relatedEntityId);
    if (current) {
      current.push(node);
      continue;
    }
    groups.set(connection.relatedEntityId, [node]);
  }

  return directConnections
    .map((connection) => ({
      relatedEntityId: connection.relatedEntityId,
      relatedEntityName: connection.relatedEntityName,
      nodes: [...(groups.get(connection.relatedEntityId) ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.nodes.length > 0);
}

function EntityRelationshipGraph({
  selectedEntity,
  connections,
  graphData,
  relationshipCount,
  focusedConnectionId,
  onToggleConnectionFocus,
  onInspectEntity,
}: {
  selectedEntity: EntitySuggestion;
  connections: EntityRelationshipGraphConnection[];
  graphData: EntityRelationshipGraphData | null;
  relationshipCount: number;
  focusedConnectionId: string | null;
  onToggleConnectionFocus: (relatedEntityId: string) => void;
  onInspectEntity: (entity: EntitySuggestion) => void;
}) {
  if (connections.length === 0) {
    return (
      <EmptyState
        title="No relationship graph yet"
        description="Add a direct relationship or wait for explicit inferred edges to build this entity's first neighborhood view."
      />
    );
  }

  const visibleConnections = connections.slice(0, MAX_ENTITY_GRAPH_CONNECTIONS);
  const hiddenConnections = Math.max(0, connections.length - visibleConnections.length);
  const activeConnections = connections.filter((connection) => !connection.isEnded).length;
  const evidenceConnections = connections.filter((connection) => connection.hasEvidence).length;
  const focusedConnection =
    connections.find((connection) => connection.relatedEntityId === focusedConnectionId) ?? null;
  const secondDegreeGroups = buildEntityRelationshipSecondDegreeGroups(graphData, visibleConnections);
  const visibleSecondDegreeGroups =
    focusedConnection == null
      ? secondDegreeGroups
      : secondDegreeGroups.filter((group) => group.relatedEntityId === focusedConnection.relatedEntityId);
  const secondDegreeCount = secondDegreeGroups.reduce((sum, group) => sum + group.nodes.length, 0);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm text-text-primary font-body">
            {connections.length} connected {connections.length === 1 ? 'entity' : 'entities'}
          </div>
          <div className="text-xs text-text-secondary font-body mt-1">
            Click a node or legend chip to focus the relationship list below. Dashed links mark neighborhoods whose
            mapped relationships are already ended.
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] font-mono uppercase tracking-wide">
          <span className="px-2 py-1 rounded-full bg-background border border-border text-text-secondary">
            {activeConnections} active
          </span>
          <span className="px-2 py-1 rounded-full bg-background border border-border text-text-secondary">
            {evidenceConnections} with evidence
          </span>
          {secondDegreeCount > 0 && (
            <span className="px-2 py-1 rounded-full bg-background border border-border text-text-secondary">
              {secondDegreeCount} in 2-hop context
            </span>
          )}
          {hiddenConnections > 0 && (
            <span className="px-2 py-1 rounded-full bg-background border border-border text-text-secondary">
              +{hiddenConnections} more below
            </span>
          )}
        </div>
      </div>

      <figure className="space-y-3">
        <div
          className="relative h-[430px] rounded-xl border border-border bg-background overflow-hidden"
          aria-label={`${selectedEntity.name} relationship graph`}
        >
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(circle at center, rgba(91, 158, 255, 0.11), transparent 58%)' }}
            aria-hidden="true"
          />
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {visibleConnections.map((connection, index) => {
              const position = getEntityRelationshipGraphPosition(index, visibleConnections.length);
              const style = ENTITY_RELATIONSHIP_GRAPH_STYLES[connection.primaryRelationship.relationshipType];
              const isFocused = connection.relatedEntityId === focusedConnectionId;
              const isDimmed = focusedConnection != null && !isFocused;
              return (
                <line
                  key={`edge-${connection.relatedEntityId}`}
                  x1="50"
                  y1="50"
                  x2={position.x}
                  y2={position.y}
                  stroke={style.lineColor}
                  strokeWidth={isFocused ? 2.1 : connection.primaryRelationship.source === 'manual' ? 1.8 : 1.5}
                  strokeOpacity={isDimmed ? 0.16 : connection.isEnded ? 0.42 : 0.82}
                  strokeDasharray={connection.isEnded ? '3 2' : undefined}
                />
              );
            })}
          </svg>

          <div className="absolute left-1/2 top-1/2 z-10 w-40 max-w-[46vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-accent/30 bg-surface px-4 py-3 text-center shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">Selected</div>
            <div className="mt-1 text-sm text-text-primary font-heading leading-tight break-words">
              {selectedEntity.name}
            </div>
            <div className="mt-2 text-[11px] text-text-secondary font-body">
              {relationshipCount} mapped relationship{relationshipCount !== 1 ? 's' : ''}
            </div>
          </div>

          {visibleConnections.map((connection, index) => {
            const position = getEntityRelationshipGraphPosition(index, visibleConnections.length);
            const style = ENTITY_RELATIONSHIP_GRAPH_STYLES[connection.primaryRelationship.relationshipType];
            const isFocused = connection.relatedEntityId === focusedConnectionId;
            const isDimmed = focusedConnection != null && !isFocused;
            return (
              <button
                key={connection.relatedEntityId}
                type="button"
                onClick={() => onToggleConnectionFocus(connection.relatedEntityId)}
                aria-pressed={isFocused}
                aria-label={`Graph node ${connection.relatedEntityName}`}
                className="absolute z-10 w-[6.75rem] sm:w-32 -translate-x-1/2 -translate-y-1/2 rounded-xl border px-3 py-2 text-left shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-all focus:outline-none focus:ring-2 focus:ring-accent/60"
                style={{
                  left: `${position.x}%`,
                  top: `${position.y}%`,
                  borderColor: isFocused ? style.lineColor : style.borderColor,
                  backgroundColor: style.surfaceColor,
                  opacity: isDimmed ? 0.62 : 1,
                  boxShadow: isFocused
                    ? `0 0 0 1px ${style.lineColor}, 0 10px 30px rgba(0,0,0,0.18)`
                    : '0 10px 30px rgba(0,0,0,0.18)',
                }}
              >
                <div className="text-sm text-text-primary font-body leading-tight break-words">
                  {connection.relatedEntityName}
                </div>
                <div className="mt-1 text-[10px] text-text-secondary font-mono uppercase tracking-wide leading-tight">
                  {getEntityRelationshipConnectionSummary(connection)}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide"
                    style={{
                      backgroundColor: style.badgeBackground,
                      color: style.badgeText,
                    }}
                  >
                    {isFocused ? 'Focused' : 'Focus'}
                  </span>
                  {connection.hasEvidence && (
                    <span className="rounded-full bg-background/70 border border-border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-text-secondary">
                      Evidence
                    </span>
                  )}
                  {connection.isEnded && (
                    <span className="rounded-full bg-background/70 border border-border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-text-secondary">
                      Ended
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <figcaption className="flex flex-wrap gap-2">
          {visibleConnections.map((connection) => {
            const style = ENTITY_RELATIONSHIP_GRAPH_STYLES[connection.primaryRelationship.relationshipType];
            const isFocused = connection.relatedEntityId === focusedConnectionId;
            return (
              <button
                key={`legend-${connection.relatedEntityId}`}
                type="button"
                onClick={() => onToggleConnectionFocus(connection.relatedEntityId)}
                aria-pressed={isFocused}
                aria-label={`Focus ${connection.relatedEntityName} relationship list`}
                className={`inline-flex items-center gap-2 rounded-full border bg-surface px-3 py-1.5 text-xs font-body transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60 ${
                  isFocused
                    ? 'border-accent/50 text-text-primary'
                    : 'border-border text-text-primary hover:border-accent/30'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: style.lineColor }} />
                <span>{connection.relatedEntityName}</span>
                <span className="text-text-secondary">{getEntityRelationshipConnectionSummary(connection)}</span>
                {connection.isEnded && (
                  <span className="text-[10px] font-mono uppercase tracking-wide text-text-secondary/70">Ended</span>
                )}
              </button>
            );
          })}
        </figcaption>

        {secondDegreeGroups.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">2-Hop Context</div>
              <div className="text-sm text-text-primary font-body mt-1">
                {focusedConnection == null
                  ? 'Nearby entities connected through the current direct neighborhood graph. Click one to inspect it directly.'
                  : `Nearby entities reachable through ${focusedConnection.relatedEntityName}. Click one to inspect it directly.`}
              </div>
            </div>
            {visibleSecondDegreeGroups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-background px-4 py-3 text-sm font-body text-text-secondary">
                No 2-hop entities through {focusedConnection?.relatedEntityName ?? 'this focused connection'} yet.
              </div>
            ) : (
              <div className="space-y-3">
                {visibleSecondDegreeGroups.map((group) => (
                  <div key={`second-degree-${group.relatedEntityId}`} className="space-y-2">
                    <div className="text-xs text-text-secondary font-body">
                      Via <span className="text-text-primary">{group.relatedEntityName}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.nodes.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => onInspectEntity(buildFallbackEntitySuggestion(node.id, node.name))}
                          aria-label={`Inspect ${node.name} from 2-hop context`}
                          className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1.5 text-xs font-body text-text-primary hover:border-accent/30 hover:text-accent transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60"
                        >
                          {node.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </figure>
    </div>
  );
}

function isPendingInvite(user: UserRecord): boolean {
  return user.lastLoginAt == null;
}

function getAuditTargetLabel(event: UserAuditEvent): string {
  if (event.targetUsername && event.targetUsername !== 'Pending invite') return event.targetUsername;
  return event.targetDiscordId;
}

/* ── Sources Tab ── */

function SourcesTab() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [addSource, setAddSource] = useState('discord');
  const [addSourceId, setAddSourceId] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addPollInterval, setAddPollInterval] = useState(300);
  const [newTier, setNewTier] = useState('general');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editingPollKey, setEditingPollKey] = useState<string | null>(null);
  const [editPollValue, setEditPollValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Source | null>(null);
  const [tokens, setTokens] = useState<DiscordManagedToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [tokenHealth, setTokenHealth] = useState<DiscordTokenHealthState[]>([]);
  const [tokenHealthError, setTokenHealthError] = useState<string | null>(null);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenValue, setTokenValue] = useState('');
  const [tokenLabel, setTokenLabel] = useState('');
  const [tokenProxyUrl, setTokenProxyUrl] = useState('');
  const [tokenActionError, setTokenActionError] = useState<string | null>(null);
  const [savingToken, setSavingToken] = useState(false);
  const [deleteTokenTarget, setDeleteTokenTarget] = useState<DiscordManagedToken | null>(null);
  const [proxyTokenTarget, setProxyTokenTarget] = useState<DiscordManagedToken | null>(null);
  const [savingTokenProxy, setSavingTokenProxy] = useState(false);

  // Twitter API key status
  const [twitterApiKeyConfigured, setTwitterApiKeyConfigured] = useState<boolean | null>(null);

  // Discord browser state
  const [guilds, setGuilds] = useState<Array<{ id: string; name: string; icon: string | null }>>([]);
  const [channels, setChannels] = useState<
    Array<{ id: string; name: string; type: number; position: number; parentId: string | null }>
  >([]);
  const [selectedGuild, setSelectedGuild] = useState<{ id: string; name: string } | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSourcesData()
      .then((nextSources) => {
        if (cancelled) return;
        setSources(nextSources);
      })
      .catch(() => setError('Failed to load sources.'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([fetchDiscordTokensData(), fetchDiscordTokenHealthData()])
      .then(([nextTokens, nextHealth]) => {
        if (cancelled) return;
        setTokens(nextTokens);
        setTokenHealth(nextHealth);
        setTokensError(null);
        setTokenHealthError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load Discord token management.';
        setTokensError(
          message.includes('503')
            ? 'Failed to load managed tokens. Check TOKEN_ENCRYPTION_KEY or SESSION_SECRET on the server.'
            : 'Failed to load managed tokens.',
        );
      })
      .finally(() => {
        if (!cancelled) setTokensLoading(false);
      });

    const interval = window.setInterval(() => {
      fetchDiscordTokenHealthData()
        .then((nextHealth) => {
          if (cancelled) return;
          setTokenHealth(nextHealth);
          setTokenHealthError(null);
        })
        .catch(() => {
          if (cancelled) return;
          setTokenHealthError('Failed to refresh gateway health.');
        });
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function reloadTokensAndHealth(): Promise<void> {
    const [nextTokens, nextHealth] = await Promise.all([fetchDiscordTokensData(), fetchDiscordTokenHealthData()]);
    setTokens(nextTokens);
    setTokenHealth(nextHealth);
    setTokensError(null);
    setTokenHealthError(null);
  }

  async function refreshTokenHealth(): Promise<void> {
    try {
      const nextHealth = await fetchDiscordTokenHealthData();
      setTokenHealth(nextHealth);
      setTokenHealthError(null);
    } catch {
      setTokenHealthError('Failed to refresh gateway health.');
    }
  }

  const resetBrowseState = () => {
    setGuilds([]);
    setChannels([]);
    setSelectedGuild(null);
    setBrowseOpen(false);
    setBrowseError(null);
  };

  const openModal = () => {
    setAddSource('discord');
    setAddSourceId('');
    setAddLabel('');
    setAddPollInterval(300);
    setNewTier('general');
    setAddError(null);
    resetBrowseState();
    setModalOpen(true);
  };

  const openTokenModal = () => {
    setTokenValue('');
    setTokenLabel('');
    setTokenProxyUrl('');
    setTokenActionError(null);
    setTokenModalOpen(true);
  };

  const handleSourceTypeChange = (value: string) => {
    setAddSource(value);
    resetBrowseState();
    if (value === 'twitter' && twitterApiKeyConfigured === null) {
      apiFetch<PipelineStatus>('/status')
        .then((status) => setTwitterApiKeyConfigured(status.twitterApiKeyConfigured ?? true))
        .catch(() => setTwitterApiKeyConfigured(null));
    }
  };

  const fetchGuilds = async () => {
    setBrowseLoading(true);
    setBrowseError(null);
    setChannels([]);
    setSelectedGuild(null);
    try {
      const res = await apiFetch<{ guilds: Array<{ id: string; name: string; icon: string | null }> }>(
        '/discord/guilds',
      );
      setGuilds(res.guilds);
      if (res.guilds.length === 0) {
        setBrowseError('No servers found.');
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setBrowseError(err.message);
      } else {
        setBrowseError('Failed to fetch servers.');
      }
    } finally {
      setBrowseLoading(false);
    }
  };

  const fetchChannels = async (guild: { id: string; name: string }) => {
    setSelectedGuild(guild);
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const res = await apiFetch<{
        channels: Array<{ id: string; name: string; type: number; position: number; parentId: string | null }>;
      }>(`/discord/guilds/${guild.id}/channels`);
      setChannels(res.channels);
      if (res.channels.length === 0) {
        setBrowseError('No text channels found in this server.');
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setBrowseError(err.message);
      } else {
        setBrowseError('Failed to fetch channels.');
      }
    } finally {
      setBrowseLoading(false);
    }
  };

  const selectChannel = (channel: { id: string; name: string }) => {
    setAddSourceId(channel.id);
    setAddLabel(`#${channel.name}`);
    setBrowseOpen(false);
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      const created = await apiFetch<Source>('/sources', {
        method: 'POST',
        body: JSON.stringify({
          source: addSource,
          sourceId: addSourceId,
          label: addLabel || undefined,
          poll_interval: addPollInterval,
          tier: newTier,
        }),
      });
      const newSource: Source = {
        source: created.source ?? addSource,
        sourceId: created.sourceId ?? addSourceId,
        label: created.label ?? addLabel ?? addSourceId,
        enabled: created.enabled ?? true,
        pollInterval: created.pollInterval ?? 300000,
        lastFetchedAt: created.lastFetchedAt ?? null,
        errorCount: created.errorCount ?? 0,
        lastError: created.lastError ?? null,
        status: created.status ?? 'ready',
        stateStatus: created.stateStatus ?? 'active',
        nextRetryAt: created.nextRetryAt ?? null,
        tier: created.tier ?? newTier,
      };
      setSources((prev) => [...prev, newSource]);
      setModalOpen(false);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('409')) {
        setAddError('Source already exists.');
      } else if (err instanceof Error) {
        setAddError(err.message);
      } else {
        setAddError('Failed to add source.');
      }
    } finally {
      setAdding(false);
    }
  };

  const handleAddToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedToken = tokenValue.trim();
    const trimmedLabel = tokenLabel.trim();
    const trimmedProxyUrl = tokenProxyUrl.trim();
    if (!trimmedToken) return;

    setSavingToken(true);
    setTokenActionError(null);
    try {
      await apiFetch('/discord/tokens', {
        method: 'POST',
        body: JSON.stringify({
          token: trimmedToken,
          label: trimmedLabel || undefined,
          proxyUrl: trimmedProxyUrl || undefined,
        }),
      });
      await reloadTokensAndHealth();
      setTokenModalOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add token.';
      setTokenActionError(
        message.includes('503')
          ? 'Failed to add token. Check TOKEN_ENCRYPTION_KEY or SESSION_SECRET on the server.'
          : 'Failed to add token.',
      );
    } finally {
      setSavingToken(false);
    }
  };

  const saveTokenProxy = async () => {
    if (!proxyTokenTarget) return;
    const trimmedProxyUrl = tokenProxyUrl.trim();
    if (!trimmedProxyUrl) return;

    setSavingTokenProxy(true);
    setTokenActionError(null);
    try {
      await apiFetch(`/discord/tokens/${proxyTokenTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ proxyUrl: trimmedProxyUrl }),
      });
      await reloadTokensAndHealth();
      setProxyTokenTarget(null);
      setTokenProxyUrl('');
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('400')) {
        setTokenActionError('Proxy URL must be a valid http:// or https:// proxy endpoint.');
      } else {
        setTokenActionError(`Failed to update proxy for "${proxyTokenTarget.label ?? proxyTokenTarget.maskedToken}".`);
      }
    } finally {
      setSavingTokenProxy(false);
    }
  };

  const clearTokenProxy = async () => {
    if (!proxyTokenTarget) return;

    setSavingTokenProxy(true);
    setTokenActionError(null);
    try {
      await apiFetch(`/discord/tokens/${proxyTokenTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ proxyUrl: null }),
      });
      await reloadTokensAndHealth();
      setProxyTokenTarget(null);
      setTokenProxyUrl('');
    } catch {
      setTokenActionError(`Failed to clear proxy for "${proxyTokenTarget.label ?? proxyTokenTarget.maskedToken}".`);
    } finally {
      setSavingTokenProxy(false);
    }
  };

  const toggleSource = async (s: Source) => {
    setError(null);
    const isActive = s.stateStatus == null || s.stateStatus === 'active';
    try {
      await apiFetch(buildSourceActionPath(s), {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !isActive }),
      });
      setSources((prev) =>
        prev.map((src) =>
          src.sourceId === s.sourceId && src.source === s.source
            ? { ...src, stateStatus: isActive ? 'disabled' : 'active' }
            : src,
        ),
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('409')) {
        setError(`Cannot re-enable "${getSourceDisplayName(s)}" — source is halted. Fix the underlying issue first.`);
      } else {
        setError(`Failed to toggle source "${getSourceDisplayName(s)}".`);
      }
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setError(null);
    try {
      await apiFetch(buildSourceActionPath(deleteTarget), { method: 'DELETE' });
      setSources((prev) =>
        prev.filter((src) => !(src.source === deleteTarget.source && src.sourceId === deleteTarget.sourceId)),
      );
    } catch {
      setError(`Failed to delete source "${getSourceDisplayName(deleteTarget)}".`);
    } finally {
      setDeleteTarget(null);
    }
  };

  const confirmDeleteToken = async () => {
    if (!deleteTokenTarget) return;
    setTokenActionError(null);
    try {
      await apiFetch(`/discord/tokens/${deleteTokenTarget.id}`, { method: 'DELETE' });
      await reloadTokensAndHealth();
    } catch {
      setTokenActionError(`Failed to remove token "${deleteTokenTarget.label ?? deleteTokenTarget.maskedToken}".`);
    } finally {
      setDeleteTokenTarget(null);
    }
  };

  const startEditLabel = (s: Source) => {
    setEditingKey(`${s.source}-${s.sourceId}`);
    setEditLabel(s.label ?? '');
  };

  const saveLabel = async (s: Source) => {
    const trimmed = editLabel.trim();
    setEditingKey(null);
    if (!trimmed || trimmed === s.label) return;
    setError(null);
    try {
      await apiFetch(buildSourceActionPath(s), {
        method: 'PATCH',
        body: JSON.stringify({ label: trimmed }),
      });
      setSources((prev) =>
        prev.map((src) => (src.source === s.source && src.sourceId === s.sourceId ? { ...src, label: trimmed } : src)),
      );
    } catch {
      setError(`Failed to update label for "${getSourceDisplayName(s)}".`);
    }
  };

  const cancelEditLabel = () => {
    setEditingKey(null);
  };

  const startEditPoll = (s: Source) => {
    setEditingPollKey(`${s.source}-${s.sourceId}`);
    setEditPollValue(String(s.pollInterval));
  };

  const savePollInterval = async (s: Source) => {
    const raw = editPollValue.trim();
    setEditingPollKey(null);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      setError(`Poll interval must be an integer (seconds). Got "${raw}".`);
      return;
    }
    if (parsed < 60 || parsed > 86400) {
      setError(`Poll interval must be between 60 and 86400 seconds. Got ${parsed}.`);
      return;
    }
    if (parsed === s.pollInterval) return;
    setError(null);
    try {
      await apiFetch(buildSourceActionPath(s), {
        method: 'PATCH',
        body: JSON.stringify({ poll_interval: parsed }),
      });
      setSources((prev) =>
        prev.map((src) =>
          src.source === s.source && src.sourceId === s.sourceId ? { ...src, pollInterval: parsed } : src,
        ),
      );
    } catch {
      setError(`Failed to update poll interval for "${getSourceDisplayName(s)}".`);
    }
  };

  const cancelEditPoll = () => {
    setEditingPollKey(null);
  };

  const addSourceButton = (
    <button
      onClick={openModal}
      className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity"
    >
      Add Source
    </button>
  );

  const addTokenButton = (
    <button
      onClick={openTokenModal}
      className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors"
    >
      Add Token
    </button>
  );

  const addSourceModal = (
    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Source">
      <form onSubmit={handleAddSource} className="space-y-4">
        {addError && <p className="text-red-400 text-sm font-body">{addError}</p>}
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Source Type</label>
          <select
            value={addSource}
            onChange={(e) => handleSourceTypeChange(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
          >
            <option value="discord">discord</option>
            <option value="twitter">twitter</option>
            <option value="rss">rss</option>
            <option value="news">news</option>
          </select>
        </div>
        {/* Twitter API key warning */}
        {addSource === 'twitter' && twitterApiKeyConfigured === false && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 text-yellow-400 text-sm font-body">
            Twitter API key (TWITTERAPI_KEY) is not configured in .env. Twitter sources will not poll until a key is
            set.
          </div>
        )}
        {/* Discord channel browser */}
        {addSource === 'discord' && (
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Browse Channels</label>
            {!browseOpen ? (
              <button
                type="button"
                onClick={() => {
                  setBrowseOpen(true);
                  fetchGuilds();
                }}
                className="w-full px-4 py-2.5 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors text-left"
              >
                Browse Servers...
              </button>
            ) : (
              <div className="bg-surface-raised border border-border rounded-lg overflow-hidden">
                {/* Header with back/close */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                  {selectedGuild ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGuild(null);
                        setChannels([]);
                        setBrowseError(null);
                      }}
                      className="text-accent text-sm font-body hover:opacity-80 transition-opacity"
                    >
                      &larr; {selectedGuild.name}
                    </button>
                  ) : (
                    <span className="text-text-secondary text-sm font-body">Select a server</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setBrowseOpen(false)}
                    className="text-text-secondary hover:text-text-primary text-sm transition-colors"
                  >
                    &times;
                  </button>
                </div>

                {/* Loading state */}
                {browseLoading && (
                  <div className="px-4 py-6 text-center text-text-secondary text-sm font-body">Loading...</div>
                )}

                {/* Error state */}
                {browseError && !browseLoading && (
                  <div className="px-4 py-4 text-red-400 text-sm font-body">{browseError}</div>
                )}

                {/* Guild list */}
                {!browseLoading && !browseError && !selectedGuild && guilds.length > 0 && (
                  <div className="max-h-[200px] overflow-y-auto">
                    {guilds.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => fetchChannels(g)}
                        className="w-full text-left px-4 py-2.5 text-text-primary text-sm font-body hover:bg-background transition-colors border-b border-border last:border-b-0"
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Channel list */}
                {!browseLoading && !browseError && selectedGuild && channels.length > 0 && (
                  <div className="max-h-[200px] overflow-y-auto">
                    {channels.map((ch) => (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => selectChannel(ch)}
                        className="w-full text-left px-4 py-2.5 text-text-primary text-sm font-body hover:bg-background transition-colors border-b border-border last:border-b-0"
                      >
                        <span className="text-text-secondary">#</span>
                        {ch.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Source ID</label>
          <input
            type="text"
            required
            value={addSourceId}
            onChange={(e) => setAddSourceId(e.target.value)}
            placeholder={
              addSource === 'rss'
                ? 'https://example.com/feed.xml'
                : addSource === 'discord'
                  ? 'Channel ID'
                  : addSource === 'twitter'
                    ? '@username or search query (e.g. "ethereum OR defi")'
                    : 'https://example.com/articles/some-article'
            }
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
          />
          {addSource === 'twitter' && (
            <>
              {addSourceId.startsWith('@') && /[^a-zA-Z0-9_@]/.test(addSourceId) && (
                <p className="text-red-400 text-xs font-body mt-1">
                  Twitter handles can only contain letters, numbers, and underscores.
                </p>
              )}
              <p className="text-text-secondary text-xs font-body mt-1">
                Use @handle for a user timeline, or any search query. Supports: from:user, &quot;exact phrase&quot;, OR,
                -exclude
              </p>
            </>
          )}
          {addSource === 'news' && (
            <p className="text-text-secondary text-xs font-body mt-1">
              Enter the full URL of a single article. Podders refetches the page on each poll and extracts the readable
              body via Readability.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">
            Label <span className="normal-case text-text-secondary/60">(optional)</span>
          </label>
          <input
            type="text"
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            placeholder="Display name"
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
          />
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Poll Interval</label>
          <select
            value={addPollInterval}
            onChange={(e) => setAddPollInterval(Number(e.target.value))}
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
          >
            <option value={60}>1 minute</option>
            <option value={300}>5 minutes</option>
            <option value={600}>10 minutes</option>
            <option value={900}>15 minutes</option>
            <option value={1800}>30 minutes</option>
            <option value={3600}>1 hour</option>
            <option value={7200}>2 hours</option>
            <option value={14400}>4 hours</option>
            <option value={43200}>12 hours</option>
            <option value={86400}>24 hours</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">
            Tier <span className="normal-case text-text-secondary/60">(optional)</span>
          </label>
          <select
            value={newTier}
            onChange={(e) => setNewTier(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
          >
            <option value="general">General</option>
            <option value="alpha">Alpha</option>
            <option value="influencer">Influencer</option>
            <option value="mainstream">Mainstream</option>
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={adding || !addSourceId.trim()}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {adding ? 'Adding...' : 'Add Source'}
          </button>
        </div>
      </form>
    </Modal>
  );

  const deleteSourceModal = (
    <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Source">
      <p className="text-text-secondary text-sm mb-4">
        Are you sure you want to delete{' '}
        <strong className="text-text-primary">{deleteTarget ? getSourceDisplayName(deleteTarget) : null}</strong>? This
        action cannot be undone.
      </p>
      <div className="flex justify-end gap-3">
        <button
          onClick={() => setDeleteTarget(null)}
          className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={confirmDelete}
          className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-sm hover:bg-red-500/30 transition-colors"
        >
          Delete
        </button>
      </div>
    </Modal>
  );

  const addTokenModal = (
    <Modal open={tokenModalOpen} onClose={() => setTokenModalOpen(false)} title="Add Discord Token">
      <form onSubmit={handleAddToken} className="space-y-4">
        {tokenActionError && <p className="text-red-400 text-sm font-body">{tokenActionError}</p>}
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Token Label</label>
          <input
            type="text"
            value={tokenLabel}
            onChange={(e) => setTokenLabel(e.target.value)}
            placeholder="Optional label (e.g. Backup account)"
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
          />
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Discord Token</label>
          <textarea
            required
            rows={4}
            value={tokenValue}
            onChange={(e) => setTokenValue(e.target.value)}
            placeholder="Paste the raw Discord user token"
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-mono placeholder:text-[#555566] focus:outline-none focus:border-accent"
          />
          <p className="text-xs text-text-secondary/70 font-body">
            Managed tokens are encrypted at rest in Postgres and reloaded into the gateway automatically.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Proxy URL</label>
          <input
            type="url"
            value={tokenProxyUrl}
            onChange={(e) => setTokenProxyUrl(e.target.value)}
            placeholder="Optional http://user:pass@proxy.example:8080"
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-mono placeholder:text-[#555566] focus:outline-none focus:border-accent"
          />
          <p className="text-xs text-text-secondary/70 font-body">
            Optional per-token proxy for both Discord REST discovery and the live gateway connection. Proxy URLs are
            encrypted at rest.
          </p>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => setTokenModalOpen(false)}
            className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={savingToken || !tokenValue.trim()}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {savingToken ? 'Saving...' : 'Add Token'}
          </button>
        </div>
      </form>
    </Modal>
  );

  const proxyTokenModal = (
    <Modal open={!!proxyTokenTarget} onClose={() => setProxyTokenTarget(null)} title="Configure Token Proxy">
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-text-primary text-sm font-body">
            {proxyTokenTarget?.label ?? proxyTokenTarget?.maskedToken}
          </p>
          <p className="text-text-secondary/70 text-xs font-body">
            {proxyTokenTarget?.proxyConfigured
              ? `Current proxy: ${proxyTokenTarget.maskedProxy ?? 'configured'}`
              : 'This token currently connects directly.'}
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">New Proxy URL</label>
          <input
            type="url"
            value={tokenProxyUrl}
            onChange={(e) => setTokenProxyUrl(e.target.value)}
            placeholder="http://user:pass@proxy.example:8080"
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-mono placeholder:text-[#555566] focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setProxyTokenTarget(null);
              setTokenProxyUrl('');
            }}
            className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => {
                void clearTokenProxy();
              }}
              disabled={savingTokenProxy || !proxyTokenTarget?.proxyConfigured}
              className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors disabled:opacity-50"
            >
              Clear Proxy
            </button>
            <button
              type="button"
              onClick={() => {
                void saveTokenProxy();
              }}
              disabled={savingTokenProxy || !tokenProxyUrl.trim()}
              className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {savingTokenProxy ? 'Saving...' : 'Save Proxy'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );

  const deleteTokenModal = (
    <Modal open={!!deleteTokenTarget} onClose={() => setDeleteTokenTarget(null)} title="Remove Discord Token">
      <p className="text-text-secondary text-sm mb-4">
        Remove{' '}
        <strong className="text-text-primary">{deleteTokenTarget?.label ?? deleteTokenTarget?.maskedToken}</strong> from
        managed Discord tokens?
      </p>
      <div className="flex justify-end gap-3">
        <button
          onClick={() => setDeleteTokenTarget(null)}
          className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={confirmDeleteToken}
          className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-sm hover:bg-red-500/30 transition-colors"
        >
          Remove
        </button>
      </div>
    </Modal>
  );

  const toggleToken = async (token: DiscordManagedToken) => {
    setTokenActionError(null);
    try {
      await apiFetch(`/discord/tokens/${token.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: token.status === 'active' ? 'disabled' : 'active' }),
      });
      await reloadTokensAndHealth();
    } catch {
      setTokenActionError(`Failed to update "${token.label ?? token.maskedToken}".`);
    }
  };

  if (loading && tokensLoading) return <div className="text-text-secondary font-body py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      {addSourceModal}
      {deleteSourceModal}
      {addTokenModal}
      {proxyTokenModal}
      {deleteTokenModal}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          {error && <p className="text-red-400 text-sm font-body">{error}</p>}
          {tokenActionError && <p className="text-red-400 text-sm font-body">{tokenActionError}</p>}
        </div>
        <div className="flex gap-2">{addSourceButton}</div>
      </div>
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Sources</h3>
        </div>
        {sources.length === 0 ? (
          <div className="text-center py-16 px-6">
            <p className="text-text-secondary text-lg">No sources configured</p>
            <p className="text-text-secondary/60 mt-2 text-sm">
              Add your first source to start collecting market intelligence.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-secondary font-mono text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-left px-4 py-3">Label</th>
                <th className="text-left px-4 py-3">Tier</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Last Fetched</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const isActive = s.stateStatus == null || s.stateStatus === 'active';
                return (
                  <tr
                    key={`${s.source}-${s.sourceId}`}
                    className="border-b border-border last:border-b-0 hover:bg-surface-raised transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                      {s.source}
                      {s.source === 'twitter' && (
                        <span
                          className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${
                            s.sourceId.startsWith('@') ? 'bg-accent/15 text-accent' : 'bg-yellow-500/15 text-yellow-400'
                          }`}
                        >
                          {s.sourceId.startsWith('@') ? '@handle' : 'search'}
                        </span>
                      )}
                      {editingPollKey === `${s.source}-${s.sourceId}` ? (
                        <input
                          autoFocus
                          type="number"
                          min={60}
                          max={86400}
                          step={60}
                          value={editPollValue}
                          onChange={(e) => setEditPollValue(e.target.value)}
                          onBlur={() => savePollInterval(s)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') savePollInterval(s);
                            if (e.key === 'Escape') cancelEditPoll();
                          }}
                          aria-label={`Edit poll interval for ${getSourceDisplayName(s)}`}
                          className="ml-2 w-20 bg-background border border-accent rounded px-1 py-0 text-text-primary text-[11px] font-mono focus:outline-none"
                        />
                      ) : (
                        <span
                          onDoubleClick={() => startEditPoll(s)}
                          title="Double-click to edit poll interval (seconds, 60–86400)"
                          className="ml-2 text-text-secondary/60 cursor-default"
                        >
                          {s.pollInterval >= 3600
                            ? `${Math.floor(s.pollInterval / 3600)}h`
                            : `${Math.floor(s.pollInterval / 60)}m`}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-primary font-body">
                      {editingKey === `${s.source}-${s.sourceId}` ? (
                        <input
                          autoFocus
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          onBlur={() => saveLabel(s)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveLabel(s);
                            if (e.key === 'Escape') cancelEditLabel();
                          }}
                          className="w-full bg-background border border-accent rounded px-2 py-0.5 text-text-primary text-sm font-body focus:outline-none"
                        />
                      ) : (
                        <span
                          onDoubleClick={() => startEditLabel(s)}
                          className="cursor-default"
                          title="Double-click to edit"
                        >
                          {getSourceDisplayName(s)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={s.tier ?? 'general'}
                        onChange={async (e) => {
                          const nextTier = e.target.value;
                          try {
                            await apiFetch(buildSourceActionPath(s), {
                              method: 'PATCH',
                              body: JSON.stringify({ tier: nextTier }),
                            });
                            setSources((prev) =>
                              prev.map((src) =>
                                src.source === s.source && src.sourceId === s.sourceId
                                  ? { ...src, tier: nextTier }
                                  : src,
                              ),
                            );
                          } catch {
                            setError(`Failed to update tier for "${getSourceDisplayName(s)}".`);
                          }
                        }}
                        className={`text-[11px] font-mono uppercase tracking-wide rounded-full px-2.5 py-0.5 border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent ${
                          (s.tier ?? 'general') === 'alpha'
                            ? 'bg-purple-500/15 text-purple-400'
                            : (s.tier ?? 'general') === 'influencer'
                              ? 'bg-blue-500/15 text-blue-400'
                              : (s.tier ?? 'general') === 'mainstream'
                                ? 'bg-green-500/15 text-green-400'
                                : 'bg-border/50 text-text-secondary'
                        }`}
                      >
                        <option value="general" className="bg-background text-text-primary">
                          General
                        </option>
                        <option value="alpha" className="bg-background text-text-primary">
                          Alpha
                        </option>
                        <option value="influencer" className="bg-background text-text-primary">
                          Influencer
                        </option>
                        <option value="mainstream" className="bg-background text-text-primary">
                          Mainstream
                        </option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s.stateStatus ?? 'unknown'} />
                      {s.source === 'twitter' && s.stateStatus === 'halted' && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide bg-red-500/20 text-red-400 border border-red-500/30">
                          api error
                        </span>
                      )}
                      {s.source === 'twitter' && s.nextRetryAt != null && s.nextRetryAt > Date.now() && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide bg-yellow-500/20 text-yellow-400">
                          rate limited
                        </span>
                      )}
                      {(s.lastError ||
                        s.stateStatus === 'halted' ||
                        (s.source === 'twitter' && s.nextRetryAt != null && s.nextRetryAt > Date.now())) && (
                        <p
                          className={`text-xs mt-1 font-body ${
                            s.source === 'twitter' && s.stateStatus === 'halted'
                              ? 'text-accent-red font-medium'
                              : s.source === 'twitter' && s.nextRetryAt != null && s.nextRetryAt > Date.now()
                                ? 'text-yellow-400'
                                : 'text-accent-red'
                          }`}
                        >
                          {s.source === 'twitter'
                            ? decodeTwitterError(s)
                            : s.lastError || 'Source halted — check server logs for details'}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                      {formatRelativeTime(s.lastFetchedAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => setDeleteTarget(s)}
                          className="text-accent-red/70 hover:text-accent-red text-xs font-mono transition-colors"
                          title={`Delete ${getSourceDisplayName(s)}`}
                        >
                          &times;
                        </button>
                        <button
                          onClick={() => toggleSource(s)}
                          disabled={s.stateStatus === 'halted'}
                          className={`relative w-10 h-5 rounded-full transition-colors ${
                            isActive ? 'bg-accent-green' : s.stateStatus === 'halted' ? 'bg-accent-red/50' : 'bg-border'
                          } disabled:cursor-not-allowed`}
                          title={
                            s.stateStatus === 'halted' ? 'Source is halted — fix the underlying issue first' : undefined
                          }
                        >
                          <span
                            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                              isActive ? 'left-5' : 'left-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
            <div className="space-y-1">
              <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Managed Discord Tokens</h3>
              <p className="text-text-secondary/70 text-sm font-body">
                DB-managed tokens are encrypted at rest and can be enabled, disabled, rotated, proxied, or removed here.
              </p>
            </div>
            {addTokenButton}
          </div>
          {tokensError && <p className="px-4 py-3 text-red-400 text-sm font-body">{tokensError}</p>}
          {tokensLoading ? (
            <div className="px-4 py-8 text-text-secondary font-body">Loading...</div>
          ) : tokens.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-text-secondary text-sm font-body">No managed Discord tokens yet.</p>
              <p className="text-text-secondary/60 mt-2 text-xs font-body">
                Tokens from `DISCORD_TOKENS` still work, but they are system-managed and not editable here.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-secondary font-mono text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Label</th>
                  <th className="text-left px-4 py-3">Token</th>
                  <th className="text-left px-4 py-3">Proxy</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Last Used</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => {
                  const isActive = token.status === 'active';
                  return (
                    <tr
                      key={token.id}
                      className="border-b border-border last:border-b-0 hover:bg-surface-raised transition-colors"
                    >
                      <td className="px-4 py-3 text-text-primary font-body">
                        <div className="space-y-1">
                          <div>{token.label ?? 'Untitled token'}</div>
                          <div className="text-text-secondary/60 text-xs font-mono">
                            added {formatRelativeTime(token.addedAt)}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-text-primary text-xs font-mono">{token.maskedToken}</code>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">
                        {token.proxyConfigured ? (
                          <div className="space-y-1">
                            <div className="text-text-primary">{token.maskedProxy ?? 'configured'}</div>
                            <div className="text-text-secondary/60">proxied</div>
                          </div>
                        ) : (
                          <span className="text-text-secondary">Direct</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={token.status} />
                      </td>
                      <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                        {formatRelativeTime(token.lastUsedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => {
                              setProxyTokenTarget(token);
                              setTokenProxyUrl('');
                              setTokenActionError(null);
                            }}
                            className="text-text-secondary hover:text-text-primary text-xs font-mono transition-colors"
                            title={`Configure proxy for ${token.label ?? token.maskedToken}`}
                          >
                            Proxy
                          </button>
                          <button
                            onClick={() => setDeleteTokenTarget(token)}
                            className="text-accent-red/70 hover:text-accent-red text-xs font-mono transition-colors"
                            title={`Remove ${token.label ?? token.maskedToken}`}
                          >
                            &times;
                          </button>
                          <button
                            onClick={() => toggleToken(token)}
                            className={`relative w-10 h-5 rounded-full transition-colors ${
                              isActive ? 'bg-accent-green' : 'bg-border'
                            }`}
                            title={isActive ? 'Disable token' : 'Enable token'}
                          >
                            <span
                              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                isActive ? 'left-5' : 'left-0.5'
                              }`}
                            />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
            <div className="space-y-1">
              <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">REST Poll Health</h3>
              <p className="text-text-secondary/70 text-sm font-body">
                Recent Discord REST polling activity for env and managed tokens.
              </p>
            </div>
            <button
              onClick={() => {
                void refreshTokenHealth();
              }}
              className="px-3 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-xs font-mono hover:text-text-primary transition-colors"
            >
              Refresh
            </button>
          </div>
          {tokenHealthError && <p className="px-4 py-3 text-red-400 text-sm font-body">{tokenHealthError}</p>}
          {tokenHealth.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-text-secondary text-sm font-body">No Discord tokens configured.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {tokenHealth.map((state) => (
                <div key={state.index} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-text-primary text-sm font-body">
                        {state.label ?? state.maskedToken ?? `Connection ${state.index + 1}`}
                      </div>
                      <div className="text-text-secondary/60 text-xs font-mono flex items-center gap-2">
                        <span>
                          {state.channelCount} channel{state.channelCount === 1 ? '' : 's'}
                        </span>
                        <span>&middot;</span>
                        <span>{state.source === 'db' ? 'managed token' : 'env token'}</span>
                      </div>
                    </div>
                    <StatusBadge status={state.status} />
                  </div>
                  {state.maskedToken && (
                    <div className="flex items-center justify-between gap-3 text-xs font-mono">
                      <span className="text-text-secondary">Token</span>
                      <span className="text-text-primary">{state.maskedToken}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 text-xs font-mono">
                    <span className="text-text-secondary">Proxy</span>
                    <span className="text-text-primary">
                      {state.proxyConfigured ? (state.maskedProxy ?? 'configured') : 'Direct'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs font-mono">
                    <span className="text-text-secondary">Last Poll</span>
                    <span className="text-text-primary">{formatRelativeTime(state.lastSuccessfulPollAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs font-mono">
                    <span className="text-text-secondary">Errors</span>
                    <span className="text-text-primary">{state.errorCount}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Delivery Tab ── */

function DeliveryTab() {
  const [config, setConfig] = useState<Config | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [digestTime, setDigestTime] = useState('09:00');
  const [timezone, setTimezone] = useState('Asia/Jakarta');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ digestTime?: string; timezone?: string; webhookUrl?: string; apiKey?: string }>('/config')
      .then((res) => {
        const mapped: Config = {
          webhookUrl: res.webhookUrl ?? '',
          digestTime: res.digestTime ?? '09:00',
          timezone: res.timezone ?? 'Asia/Jakarta',
          publicUrl: null,
          apiKey: res.apiKey ?? null,
        };
        setConfig(mapped);
        setWebhookUrl(res.webhookUrl ?? '');
        setDigestTime(res.digestTime ?? '09:00');
        setTimezone(res.timezone ?? 'Asia/Jakarta');
      })
      .catch(() => {
        setFetchError('Failed to load delivery configuration. Please try refreshing the page.');
      });
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    if (webhookUrl && !webhookUrl.startsWith('https://')) {
      setError('Webhook URL must use HTTPS.');
      setSaving(false);
      return;
    }
    try {
      await apiFetch('/config', {
        method: 'PATCH',
        body: JSON.stringify({ webhookUrl, digestTime, timezone }),
      });
      setConfig((prev) => (prev ? { ...prev, webhookUrl, digestTime, timezone } : prev));
    } catch {
      setError('Failed to save delivery configuration.');
    } finally {
      setSaving(false);
    }
  };

  const testWebhook = async () => {
    setTesting(true);
    setTestResult(null);
    if (!webhookUrl) {
      setTestResult('Enter a webhook URL first.');
      setTesting(false);
      return;
    }
    if (!webhookUrl.startsWith('https://')) {
      setTestResult('Webhook URL must use HTTPS.');
      setTesting(false);
      return;
    }
    try {
      await apiFetch('/config/test-webhook', {
        method: 'POST',
        body: JSON.stringify({ url: webhookUrl }),
      });
      setTestResult('Test payload sent successfully.');
    } catch (err) {
      if (isApiError(err) && err.detail) {
        setTestResult(`Failed to send test payload: ${err.detail}`);
      } else {
        setTestResult('Failed to send test payload. Check the URL and try again.');
      }
    } finally {
      setTesting(false);
    }
  };

  if (fetchError) return <div className="text-red-400 font-body py-8">{fetchError}</div>;
  if (!config) return <div className="text-text-secondary font-body py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      {error && <p className="text-red-400 text-sm font-body">{error}</p>}
      <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
        <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Digest Time</h3>
        <input
          type="time"
          value={digestTime}
          onChange={(e) => setDigestTime(e.target.value)}
          className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
        />
      </div>
      <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
        <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Timezone</h3>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>
      <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
        <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Webhook URL</h3>
        <input
          type="url"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://discord.com/api/webhooks/..."
          className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
        />
        <div className="flex gap-3">
          <button
            onClick={testWebhook}
            disabled={testing || !webhookUrl}
            className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test Webhook'}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {testResult && <p className="text-sm text-text-secondary font-body">{testResult}</p>}
      </div>

      {/* API Access (PD-031) */}
      <ApiAccessSection apiKey={config.apiKey} />
    </div>
  );
}

/* ── API Access Section ── */

function ApiAccessSection({ apiKey }: { apiKey: string | null }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const maskedKey = apiKey ? `${'*'.repeat(Math.max(0, apiKey.length - 4))}${apiKey.slice(-4)}` : null;

  const copyKey = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text for manual copy
    }
  };

  const endpoints = [
    { method: 'GET', path: '/api/v1/reports', desc: 'List reports' },
    { method: 'GET', path: '/api/v1/search?q=...', desc: 'Search summaries' },
    { method: 'POST', path: '/api/v1/chat', desc: 'Chat with knowledge base' },
    { method: 'GET', path: '/api/v1/sources', desc: 'List sources' },
    { method: 'GET', path: '/api/v1/status', desc: 'Pipeline status' },
  ];

  return (
    <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
      <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">API Access</h3>
      <p className="text-sm text-text-secondary font-body">
        Use the API key for programmatic access. All API key requests have admin privileges.
      </p>

      {/* API Key display */}
      {apiKey ? (
        <div className="space-y-2">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">API Key</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-background border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary select-all overflow-x-auto">
              {revealed ? apiKey : maskedKey}
            </code>
            <button
              onClick={() => setRevealed((r) => !r)}
              className="px-3 py-2.5 bg-surface-raised border border-border rounded-lg text-text-secondary text-xs font-mono hover:text-text-primary transition-colors shrink-0"
              title={revealed ? 'Hide API key' : 'Reveal API key'}
            >
              {revealed ? 'Hide' : 'Show'}
            </button>
            <button
              onClick={copyKey}
              className="px-3 py-2.5 bg-surface-raised border border-border rounded-lg text-text-secondary text-xs font-mono hover:text-text-primary transition-colors shrink-0"
              title="Copy API key"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-secondary/60 font-body italic">
          API key is only visible to admin users. Check the server logs or .env for the key.
        </p>
      )}

      {/* Auth header format */}
      <div className="space-y-2">
        <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Authorization Header</label>
        <code className="block bg-background border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary">
          Authorization: Bearer {'<your-api-key>'}
        </code>
      </div>

      {/* Available endpoints */}
      <div className="space-y-2">
        <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Endpoints</label>
        <div className="bg-background border border-border rounded-lg overflow-hidden">
          {endpoints.map((ep) => (
            <div
              key={`${ep.method}-${ep.path}`}
              className="flex items-center gap-3 px-4 py-2 border-b border-border last:border-b-0"
            >
              <span
                className={`font-mono text-xs font-bold w-10 shrink-0 ${
                  ep.method === 'GET' ? 'text-accent-green' : 'text-accent'
                }`}
              >
                {ep.method}
              </span>
              <code className="font-mono text-xs text-text-primary">{ep.path}</code>
              <span className="text-text-secondary text-xs font-body ml-auto shrink-0">{ep.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Pipeline Tab ── */

function PipelineTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { status, ready: statusReady, isFeatureDisabled, getDisabledFeature, registerDisabledFeature } = useStatus();
  const macroDisabled = isFeatureDisabled('macro');
  const embeddingsDisabled = isFeatureDisabled('embeddings');
  const disabledMacro = getDisabledFeature('macro');
  const disabledEmbeddings = getDisabledFeature('embeddings');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [diagBackpressure, setDiagBackpressure] = useState<DiagBackpressure | null>(null);
  const [diagStuckItems, setDiagStuckItems] = useState<DiagStuckItems | null>(null);
  const [diagHaltedSources, setDiagHaltedSources] = useState<DiagHaltedSources | null>(null);
  const [diagHealthEvents, setDiagHealthEvents] = useState<DiagHealthEvents | null>(null);
  const [llmCostByModel, setLlmCostByModel] = useState<LlmCostByModelResponse | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [diagExpanded, setDiagExpanded] = useState(false);
  const [macroOverview, setMacroOverview] = useState<MacroOverview | null>(null);
  const [macroLoading, setMacroLoading] = useState(true);
  const [macroError, setMacroError] = useState<string | null>(null);
  const [unusualActivity, setUnusualActivity] = useState<UnusualActivityOverview | null>(null);
  const [unusualLoading, setUnusualLoading] = useState(true);
  const [unusualError, setUnusualError] = useState<string | null>(null);
  const [narrativeWatchlist, setNarrativeWatchlist] = useState<NarrativeWatchlistOverview | null>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(true);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);
  const [expandedNarrativeId, setExpandedNarrativeId] = useState<string | null>(null);
  const [narrativeDetails, setNarrativeDetails] = useState<Record<string, NarrativeDrilldown>>({});
  const [narrativeDetailLoadingId, setNarrativeDetailLoadingId] = useState<string | null>(null);
  const [narrativeDetailErrors, setNarrativeDetailErrors] = useState<Record<string, string>>({});
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [editingCalendarEvent, setEditingCalendarEvent] = useState<CalendarEvent | null>(null);
  const [calendarName, setCalendarName] = useState('');
  const [calendarCategory, setCalendarCategory] = useState<CalendarEvent['category']>('macro');
  const [calendarWhen, setCalendarWhen] = useState(defaultCalendarEventInputValue());
  const [calendarRecurrenceRule, setCalendarRecurrenceRule] = useState<CalendarEvent['recurrenceRule']>(null);
  const [calendarEntityName, setCalendarEntityName] = useState('');
  const [calendarEntitySuggestions, setCalendarEntitySuggestions] = useState<EntitySuggestion[]>([]);
  const [calendarEntitySuggestionsLoading, setCalendarEntitySuggestionsLoading] = useState(false);
  const [calendarDescription, setCalendarDescription] = useState('');
  const [calendarActionError, setCalendarActionError] = useState<string | null>(null);
  const [savingCalendarEvent, setSavingCalendarEvent] = useState(false);
  const [removingCalendarEventId, setRemovingCalendarEventId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/health')
      .then((r) => r.json())
      .then((data: HealthResponse) => setHealth(data))
      .catch(() => {
        /* health is best-effort */
      });
  }, []);

  useEffect(() => {
    if (!isAdmin) return;

    let cancelled = false;
    setDiagError(null);
    Promise.allSettled([
      fetchDiagBackpressure(),
      fetchDiagStuckItems(),
      fetchDiagHaltedSources(),
      fetchDiagHealthEvents(),
    ]).then(([backpressureResult, stuckItemsResult, haltedSourcesResult, healthEventsResult]) => {
      if (cancelled) return;

      setDiagBackpressure(backpressureResult.status === 'fulfilled' ? backpressureResult.value : null);
      setDiagStuckItems(stuckItemsResult.status === 'fulfilled' ? stuckItemsResult.value : null);
      setDiagHaltedSources(haltedSourcesResult.status === 'fulfilled' ? haltedSourcesResult.value : null);
      setDiagHealthEvents(healthEventsResult.status === 'fulfilled' ? healthEventsResult.value : null);

      if (
        backpressureResult.status === 'rejected' ||
        stuckItemsResult.status === 'rejected' ||
        haltedSourcesResult.status === 'rejected' ||
        healthEventsResult.status === 'rejected'
      ) {
        setDiagError('Some diagnostic endpoints could not be loaded.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetchLlmCostByModel()
      .then((data) => {
        if (cancelled) return;
        setLlmCostByModel(data);
      })
      .catch(() => {
        /* best-effort — panel falls back to aggregate */
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!statusReady) return;
    if (macroDisabled) {
      setMacroOverview(null);
      setMacroError(null);
      setMacroLoading(false);
      return;
    }
    let cancelled = false;
    fetchMacroOverviewData()
      .then((overview) => {
        if (cancelled) return;
        setMacroOverview(overview);
        setMacroError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (isFeatureDisabledError(err)) {
          registerDisabledFeature({
            feature: err.feature,
            missingEnv: err.missingEnv,
            disables: err.disables,
            reason: err.reason,
          });
          setMacroOverview(null);
          setMacroError(null);
        } else {
          setMacroError('Failed to load macro backdrop.');
        }
      })
      .finally(() => {
        if (!cancelled) setMacroLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [statusReady, macroDisabled, registerDisabledFeature]);

  useEffect(() => {
    let cancelled = false;
    fetchUnusualActivityOverviewData()
      .then((overview) => {
        if (cancelled) return;
        setUnusualActivity(overview);
        setUnusualError(null);
      })
      .catch(() => {
        if (!cancelled) setUnusualError('Failed to load unusual activity.');
      })
      .finally(() => {
        if (!cancelled) setUnusualLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!statusReady) return;
    if (embeddingsDisabled) {
      setNarrativeWatchlist(null);
      setNarrativeError(null);
      setNarrativeLoading(false);
      return;
    }
    let cancelled = false;
    fetchNarrativeWatchlistData()
      .then((overview) => {
        if (cancelled) return;
        setNarrativeWatchlist(overview);
        setNarrativeError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (isFeatureDisabledError(err)) {
          registerDisabledFeature({
            feature: err.feature,
            missingEnv: err.missingEnv,
            disables: err.disables,
            reason: err.reason,
          });
          setNarrativeWatchlist(null);
          setNarrativeError(null);
        } else {
          setNarrativeError('Failed to load narrative watchlist.');
        }
      })
      .finally(() => {
        if (!cancelled) setNarrativeLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [statusReady, embeddingsDisabled, registerDisabledFeature]);

  useEffect(() => {
    let cancelled = false;
    fetchCalendarEventsData()
      .then((events) => {
        if (cancelled) return;
        setCalendarEvents(events);
        setCalendarError(null);
      })
      .catch(() => {
        if (!cancelled) setCalendarError('Failed to load market calendar events.');
      })
      .finally(() => {
        if (!cancelled) setCalendarLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadNarrativeDrilldown(narrativeId: string): Promise<void> {
    setNarrativeDetailLoadingId(narrativeId);
    setNarrativeDetailErrors((current) => {
      const next = { ...current };
      delete next[narrativeId];
      return next;
    });

    try {
      const narrative = await fetchNarrativeDrilldownData(narrativeId);
      setNarrativeDetails((current) => ({
        ...current,
        [narrativeId]: narrative,
      }));
    } catch (err) {
      if (!isFeatureDisabledError(err)) {
        setNarrativeDetailErrors((current) => ({
          ...current,
          [narrativeId]: 'Failed to load clustered summaries.',
        }));
      }
    } finally {
      setNarrativeDetailLoadingId((current) => (current === narrativeId ? null : current));
    }
  }

  function toggleNarrativeDrilldown(narrativeId: string): void {
    setExpandedNarrativeId((current) => (current === narrativeId ? null : narrativeId));

    if (
      expandedNarrativeId === narrativeId ||
      narrativeDetails[narrativeId] ||
      narrativeDetailLoadingId === narrativeId
    ) {
      return;
    }

    void loadNarrativeDrilldown(narrativeId);
  }

  useEffect(() => {
    if (!calendarModalOpen || !isAdmin) {
      setCalendarEntitySuggestions([]);
      setCalendarEntitySuggestionsLoading(false);
      return;
    }

    const query = calendarEntityName.trim();
    if (query.length < 2) {
      setCalendarEntitySuggestions([]);
      setCalendarEntitySuggestionsLoading(false);
      return;
    }

    let cancelled = false;
    setCalendarEntitySuggestionsLoading(true);
    fetchEntitySuggestionsData(query)
      .then((entities) => {
        if (cancelled) return;
        setCalendarEntitySuggestions(entities.filter((entity) => entity.name.toLowerCase() !== query.toLowerCase()));
      })
      .catch(() => {
        if (cancelled) return;
        setCalendarEntitySuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setCalendarEntitySuggestionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [calendarEntityName, calendarModalOpen, isAdmin]);

  async function reloadCalendarEvents(): Promise<void> {
    const events = await fetchCalendarEventsData();
    setCalendarEvents(events);
    setCalendarError(null);
  }

  function selectCalendarEntitySuggestion(entity: EntitySuggestion): void {
    setCalendarEntityName(entity.name);
    setCalendarEntitySuggestions([]);
    setCalendarActionError(null);
  }

  function openCalendarModal(): void {
    setEditingCalendarEvent(null);
    setCalendarName('');
    setCalendarCategory('macro');
    setCalendarWhen(defaultCalendarEventInputValue());
    setCalendarRecurrenceRule(null);
    setCalendarEntityName('');
    setCalendarEntitySuggestions([]);
    setCalendarDescription('');
    setCalendarActionError(null);
    setCalendarModalOpen(true);
  }

  function openEditCalendarModal(event: CalendarEvent): void {
    setEditingCalendarEvent(event);
    setCalendarName(event.name);
    setCalendarCategory(event.category);
    setCalendarWhen(toDatetimeLocalInputValue(event.nextOccurrence));
    setCalendarRecurrenceRule(event.recurrenceRule);
    setCalendarEntityName(event.entityName ?? '');
    setCalendarEntitySuggestions([]);
    setCalendarDescription(event.description ?? '');
    setCalendarActionError(null);
    setCalendarModalOpen(true);
  }

  async function handleSaveCalendarEvent(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmedName = calendarName.trim();
    const trimmedEntityName = calendarEntityName.trim();
    const trimmedDescription = calendarDescription.trim();
    const scheduledFor = new Date(calendarWhen).getTime();
    if (!trimmedName) return;
    if (!Number.isFinite(scheduledFor)) {
      setCalendarActionError('Choose a valid date and time.');
      return;
    }

    setSavingCalendarEvent(true);
    setCalendarActionError(null);
    try {
      await apiFetch(`/calendar-events${editingCalendarEvent ? `/${editingCalendarEvent.id}` : ''}`, {
        method: editingCalendarEvent ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: trimmedName,
          category: calendarCategory,
          entityName: trimmedEntityName || null,
          description: trimmedDescription || null,
          scheduledFor,
          recurrenceRule: calendarRecurrenceRule,
        }),
      });
      await reloadCalendarEvents();
      setCalendarModalOpen(false);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('400')) {
        setCalendarActionError(
          'Calendar events must be scheduled in the future, and linked entities must match a known Podders entity or alias.',
        );
      } else {
        setCalendarActionError(`Failed to ${editingCalendarEvent ? 'update' : 'save'} calendar event.`);
      }
    } finally {
      setSavingCalendarEvent(false);
    }
  }

  async function removeCalendarEvent(eventId: string): Promise<void> {
    setRemovingCalendarEventId(eventId);
    setCalendarActionError(null);
    try {
      await apiFetch(`/calendar-events/${eventId}`, { method: 'DELETE' });
      await reloadCalendarEvents();
    } catch {
      setCalendarActionError('Failed to remove calendar event.');
    } finally {
      setRemovingCalendarEventId(null);
    }
  }

  if (!statusReady) return <div className="text-text-secondary font-body py-8">Loading...</div>;
  if (!status) return <p className="text-red-400 text-sm font-body py-4">Failed to load pipeline status.</p>;

  const healthColor =
    health?.status === 'ok'
      ? 'bg-accent-green/20 text-accent-green'
      : health?.status === 'degraded'
        ? 'bg-yellow-500/20 text-yellow-400'
        : health?.status === 'error'
          ? 'bg-accent-red/20 text-accent-red'
          : '';

  return (
    <div className="space-y-6">
      {/* System Health */}
      {health && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">System Health</h3>
            <span className={`px-2 py-0.5 rounded text-xs font-mono ${healthColor}`}>{health.status}</span>
          </div>
          <div className="divide-y divide-border">
            {(Array.isArray(health.checks) ? health.checks : []).map((check) => (
              <div key={check.name} className="flex items-center justify-between px-4 py-3">
                <span className="text-text-primary text-sm font-body">{check.name.replace(/_/g, ' ')}</span>
                <span
                  className={`text-sm font-mono ${check.status === 'ok' ? 'text-accent-green' : check.status === 'warn' ? 'text-yellow-400' : 'text-accent-red'}`}
                >
                  {check.message ?? check.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setDiagExpanded((current) => !current)}
            aria-expanded={diagExpanded}
            className="w-full flex items-center justify-between px-4 py-3 border-b border-border text-left hover:text-text-primary transition-colors"
          >
            <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Diagnostics</h3>
            <span className="text-text-secondary text-sm font-mono">{diagExpanded ? '▾' : '▸'}</span>
          </button>

          {diagExpanded && (
            <div className="p-4 space-y-4">
              {diagError && <p className="text-red-400 text-sm font-body">{diagError}</p>}

              <div className="space-y-3">
                <h4 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Backpressure</h4>
                {diagBackpressure ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-border bg-background px-3 py-3">
                      <p className="text-text-secondary text-xs font-mono uppercase tracking-wide">Ready</p>
                      <p className="text-text-primary text-lg font-mono mt-2">{diagBackpressure.readyCount}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background px-3 py-3">
                      <p className="text-text-secondary text-xs font-mono uppercase tracking-wide">Processing</p>
                      <p className="text-text-primary text-lg font-mono mt-2">{diagBackpressure.processingCount}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background px-3 py-3">
                      <p className="text-text-secondary text-xs font-mono uppercase tracking-wide">Oldest Ready</p>
                      <p className="text-text-primary text-lg font-mono mt-2">
                        {formatCompactDuration(diagBackpressure.oldestReadyAgeMs)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-text-secondary text-sm font-body">Backpressure diagnostics unavailable.</p>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h4 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Stuck Items</h4>
                  {diagStuckItems && (
                    <div className="flex flex-wrap gap-2 text-xs font-mono">
                      <span className="px-2 py-1 rounded bg-background border border-border text-text-secondary">
                        {diagStuckItems.stuckCount} stuck
                      </span>
                      <span className="px-2 py-1 rounded bg-background border border-border text-text-secondary">
                        threshold {formatCompactDuration(diagStuckItems.thresholdMs)}
                      </span>
                      <span className="px-2 py-1 rounded bg-background border border-border text-text-secondary">
                        oldest {formatCompactDuration(diagStuckItems.oldestAgeMs)}
                      </span>
                    </div>
                  )}
                </div>

                {!diagStuckItems ? (
                  <p className="text-text-secondary text-sm font-body">Stuck item diagnostics unavailable.</p>
                ) : diagStuckItems.stuckCount > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-text-secondary font-mono text-xs uppercase tracking-wider">
                          <th className="text-left px-3 py-2">Source</th>
                          <th className="text-left px-3 py-2">Source ID</th>
                          <th className="text-left px-3 py-2">Age</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagStuckItems.sample.slice(0, 10).map((item) => (
                          <tr key={item.id} className="border-b border-border/70 last:border-b-0">
                            <td className="px-3 py-2 text-text-primary font-body">{item.source}</td>
                            <td className="px-3 py-2 text-text-secondary font-mono text-xs">{item.sourceId}</td>
                            <td className="px-3 py-2 text-text-secondary font-mono text-xs">
                              {formatIsoAge(item.createdAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-text-secondary text-sm font-body">No stuck items above the current threshold.</p>
                )}
              </div>

              <div className="space-y-3">
                <h4 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Halted Sources</h4>
                {!diagHaltedSources ? (
                  <p className="text-text-secondary text-sm font-body">Halted source diagnostics unavailable.</p>
                ) : diagHaltedSources.haltedSources.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-text-secondary font-mono text-xs uppercase tracking-wider">
                          <th className="text-left px-3 py-2">Source</th>
                          <th className="text-left px-3 py-2">Source ID</th>
                          <th className="text-left px-3 py-2">Errors</th>
                          <th className="text-left px-3 py-2">Last Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagHaltedSources.haltedSources.map((haltedSource) => (
                          <tr
                            key={`${haltedSource.source}:${haltedSource.sourceId}`}
                            className="border-b border-border/70 last:border-b-0"
                          >
                            <td className="px-3 py-2 text-text-primary font-body">{haltedSource.source}</td>
                            <td className="px-3 py-2 text-text-secondary font-mono text-xs">{haltedSource.sourceId}</td>
                            <td className="px-3 py-2 text-text-secondary font-mono text-xs">
                              {haltedSource.errorCount ?? 'n/a'}
                            </td>
                            <td className="px-3 py-2 text-text-secondary text-sm font-body">
                              {truncateDiagnosticText(haltedSource.lastError)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-text-secondary text-sm font-body">No halted sources</p>
                )}
              </div>

              <div className="space-y-3">
                <h4 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Recent Health Events</h4>
                {!diagHealthEvents ? (
                  <p className="text-text-secondary text-sm font-body">Health event diagnostics unavailable.</p>
                ) : diagHealthEvents.events.length > 0 ? (
                  <div className="space-y-2">
                    {diagHealthEvents.events.slice(0, 10).map((event) => (
                      <div
                        key={event.id}
                        className="rounded-lg border border-border bg-background px-3 py-3 flex items-start justify-between gap-3 flex-wrap"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${getDiagSeverityClasses(event.severity)}`}
                            >
                              {event.severity}
                            </span>
                            <span className="text-text-secondary text-xs font-mono uppercase tracking-wide">
                              {event.category}
                            </span>
                          </div>
                          <p className="text-text-primary text-sm font-body">{event.message}</p>
                        </div>
                        <span className="text-text-secondary text-xs font-mono">
                          {formatIsoDateTime(event.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-text-secondary text-sm font-body">No recent critical/error events</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pipeline Counters */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary px-4 py-3 border-b border-border">
          Pipeline Status
        </h3>
        <div className="divide-y divide-border">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-text-primary text-sm font-body">Items Ready</span>
            <span className="text-text-primary text-sm font-mono">{status.itemsReady}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-text-primary text-sm font-body">Items Processing</span>
            <span className="text-text-primary text-sm font-mono">{status.itemsProcessing}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-text-primary text-sm font-body">Summaries Today</span>
            <span className="text-text-primary text-sm font-mono">{status.summariesToday}</span>
          </div>
        </div>
      </div>

      {/* Cost Summary */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-3">LLM Cost</h3>
        <p className="text-text-primary text-lg font-mono">
          ${status.costToday.toFixed(2)} <span className="text-text-secondary text-xs">today</span>
        </p>

        {llmCostByModel && llmCostByModel.entries.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <table className="w-full text-xs font-mono">
              <thead className="text-text-secondary">
                <tr>
                  <th className="text-left pb-1 font-normal">Model</th>
                  <th className="text-right pb-1 font-normal">Calls</th>
                  <th className="text-right pb-1 font-normal">In/Out tokens</th>
                  <th className="text-right pb-1 font-normal">Cost</th>
                </tr>
              </thead>
              <tbody>
                {llmCostByModel.entries.map((entry) => (
                  <tr key={entry.model}>
                    <td className="text-text-primary py-0.5 truncate max-w-[14ch]">{entry.model}</td>
                    <td className="text-right text-text-secondary">{entry.callCount.toLocaleString()}</td>
                    <td className="text-right text-text-secondary">
                      {entry.totalInputTokens.toLocaleString()} / {entry.totalOutputTokens.toLocaleString()}
                    </td>
                    <td className="text-right text-text-primary">${entry.totalCost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {macroDisabled && disabledMacro ? (
        <FeatureDisabledCard
          feature={disabledMacro}
          title="Macro Backdrop"
          description="Macro snapshots are currently disabled — cross-market correlation and regime detection are not available."
        />
      ) : (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Macro Backdrop</h3>
              <p className="text-text-secondary/70 text-sm font-body mt-1">
                Latest FRED snapshots feed cross-market correlation context into daily and pulse synthesis.
              </p>
            </div>
            {macroOverview && macroOverview.entries.length > 0 && (
              <span
                aria-label={`Overall macro bias ${macroOverview.overallBias}`}
                className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wide ${macroToneClasses(macroOverview.overallBias)}`}
              >
                {macroOverview.overallBias}
              </span>
            )}
          </div>

          {macroLoading ? (
            <div className="px-4 py-6 text-text-secondary text-sm font-body">Loading...</div>
          ) : macroError ? (
            <p className="px-4 py-6 text-red-400 text-sm font-body">{macroError}</p>
          ) : !macroOverview || macroOverview.entries.length === 0 ? (
            <EmptyState
              title="No macro snapshots yet"
              description="Macro indicators appear here after the daily FRED refresh runs with FRED_API_KEY configured."
            />
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-text-primary text-sm font-body">Latest snapshot date</p>
                  <p className="text-text-secondary text-xs font-mono mt-1">{macroOverview.latestDate ?? 'Unknown'}</p>
                </div>
                <p className="max-w-xl text-text-secondary/70 text-sm font-body">
                  Rising VIX, dollar strength, and higher yields usually lean risk-off, while a firmer S&amp;P 500 leans
                  risk-on. Podders uses this backdrop to frame when crypto sentiment is aligned or stretched.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {macroOverview.entries.map((entry) => (
                  <div key={entry.indicator} className="rounded-lg border border-border bg-background p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-text-primary text-sm font-body">{entry.label}</h4>
                        <p className="text-text-secondary/70 text-xs font-body mt-1">{entry.narrative}</p>
                      </div>
                      <span
                        aria-label={`${entry.label} macro signal ${entry.signal}`}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${macroToneClasses(entry.signal)}`}
                      >
                        {entry.signal}
                      </span>
                    </div>

                    <p className="text-text-primary text-xl font-mono">{formatMacroValue(entry)}</p>

                    <div className="flex flex-wrap gap-2 text-xs font-mono">
                      <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                        1d change {formatMacroChange(entry.change1d, entry.indicator)}
                      </span>
                      <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                        7d change {formatMacroChange(entry.change7d, entry.indicator)}
                      </span>
                      <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                        snapshot {entry.date}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
          <div>
            <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Unusual Activity</h3>
            <p className="text-text-secondary/70 text-sm font-body mt-1">
              Daily mention spikes, especially in lower-relevance entities, plus strong copy-paste style clusters.
              Useful as an attention heuristic, not manipulation detection.
            </p>
          </div>
          {unusualActivity && unusualActivity.entries.length > 0 && (
            <span className="px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wide bg-accent/10 text-accent border border-accent/20">
              {unusualActivity.entries.length} flagged
            </span>
          )}
        </div>

        {unusualLoading ? (
          <div className="px-4 py-6 text-text-secondary text-sm font-body">Loading...</div>
        ) : unusualError ? (
          <p className="px-4 py-6 text-red-400 text-sm font-body">{unusualError}</p>
        ) : !unusualActivity || unusualActivity.entries.length === 0 ? (
          <EmptyState
            title="No unusual activity on the latest rollup"
            description="Entities with outsized daily mention spikes or strong same-day copy clusters will appear here once Podders has enough history to compare against a recent baseline."
          />
        ) : (
          <div className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-text-primary text-sm font-body">Latest rollup date</p>
                <p className="text-text-secondary text-xs font-mono mt-1">{unusualActivity.latestDate ?? 'Unknown'}</p>
              </div>
              <p className="max-w-xl text-text-secondary/70 text-sm font-body">
                This watchlist combines latest daily mention spikes, a lower-relevance breakout bias, and strong
                near-duplicate posting clusters. Treat it as a prompt to inspect the entity, not proof of coordinated
                behavior.
              </p>
            </div>

            <div className="space-y-3" aria-label="Unusual activity entities">
              {unusualActivity.entries.map((entry) => (
                <div key={entry.entityId} className="rounded-lg border border-border bg-background p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-text-primary text-sm font-body">{entry.entityName}</h4>
                      <p className="text-text-secondary/70 text-sm font-body mt-1">
                        {formatUnusualActivityNarrative(entry)}
                      </p>
                    </div>
                    <span
                      aria-label={`${entry.entityName} unusual activity ${formatUnusualActivityRatio(entry.spikeRatio)}`}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${unusualActivityBadgeClasses(entry)}`}
                    >
                      {formatUnusualActivityRatio(entry.spikeRatio)}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs font-mono">
                    <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                      today {entry.mentionCount} mentions
                    </span>
                    {entry.baselineMentionCount != null && (
                      <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                        baseline {entry.baselineMentionCount.toFixed(1)}/day
                      </span>
                    )}
                    {entry.baselinePeakMentionCount != null && (
                      <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                        prior peak {entry.baselinePeakMentionCount}
                      </span>
                    )}
                    {entry.lowRelevance && (
                      <span className="px-2 py-1 rounded bg-surface border border-border text-yellow-300">
                        low relevance {formatUnusualActivityRelevance(entry.relevanceScore)}
                      </span>
                    )}
                    {entry.duplicateClusterSize != null && (
                      <span className="px-2 py-1 rounded bg-surface border border-border text-yellow-300">
                        copy cluster {entry.duplicateClusterSize} posts
                      </span>
                    )}
                    {entry.duplicateAuthorCount != null && (
                      <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                        {entry.duplicateAuthorCount} authors
                      </span>
                    )}
                    {entry.momentum != null && (
                      <span
                        className={`px-2 py-1 rounded bg-surface border border-border ${entry.momentum >= 0 ? 'text-accent-green' : 'text-accent-red'}`}
                      >
                        momentum {formatSignedFixed(entry.momentum)}
                      </span>
                    )}
                    {entry.avgSentiment != null && (
                      <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                        sentiment {entry.avgSentiment.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {embeddingsDisabled && disabledEmbeddings ? (
        <FeatureDisabledCard
          feature={disabledEmbeddings}
          title="Narrative Watchlist"
          description="Narrative clustering is currently disabled — embeddings are required to group related summaries into themes."
        />
      ) : (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Narrative Watchlist</h3>
              <p className="text-text-secondary/70 text-sm font-body mt-1">
                Latest narrative clusters from the daily embedding pass. These labels describe current trajectory; they
                are not forward predictions.
              </p>
            </div>
            {narrativeWatchlist && narrativeWatchlist.entries.length > 0 && (
              <span className="px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wide bg-accent/10 text-accent border border-accent/20">
                {narrativeWatchlist.entries.length} tracked
              </span>
            )}
          </div>

          {narrativeLoading ? (
            <div className="px-4 py-6 text-text-secondary text-sm font-body">Loading...</div>
          ) : narrativeError ? (
            <p className="px-4 py-6 text-red-400 text-sm font-body">{narrativeError}</p>
          ) : !narrativeWatchlist || narrativeWatchlist.entries.length === 0 ? (
            <EmptyState
              title="No narrative clusters yet"
              description="Narratives appear here after the daily clustering pass has enough summary embeddings to form stable groups."
            />
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-text-primary text-sm font-body">Latest cluster date</p>
                  <p className="text-text-secondary text-xs font-mono mt-1">
                    {narrativeWatchlist.latestDate ?? 'Unknown'}
                  </p>
                </div>
                <p className="max-w-xl text-text-secondary/70 text-sm font-body">
                  Podders groups recent summaries by embedding similarity, names each cluster, and compares it with
                  prior daily clusters to decide whether the theme looks new, accelerating, stable, or fading.
                </p>
              </div>

              <div className="space-y-3" aria-label="Narrative watchlist">
                {narrativeWatchlist.entries.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border bg-background p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-text-primary text-sm font-body">{entry.name}</h4>
                        <p className="text-text-secondary/70 text-sm font-body mt-1">
                          {formatNarrativeLifecycleCopy(entry)}
                        </p>
                      </div>
                      <span
                        aria-label={`${entry.name} narrative strength ${entry.signalStrength}`}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${narrativeSignalClasses(entry.signalStrength)}`}
                      >
                        {formatNarrativeSignalLabel(entry.signalStrength)}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs font-mono">
                      <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                        {entry.memberCount} summaries clustered
                      </span>
                      <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                        {formatNarrativeSentiment(entry.avgSentiment)}
                      </span>
                      <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                        snapshot {entry.date}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-text-secondary/70 text-xs font-body">
                        Open the clustered summaries inline to inspect the evidence behind this theme.
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleNarrativeDrilldown(entry.id)}
                        aria-expanded={expandedNarrativeId === entry.id}
                        aria-label={`${expandedNarrativeId === entry.id ? 'Hide' : 'Show'} summaries for ${entry.name}`}
                        className="px-3 py-1.5 rounded border border-border bg-surface text-text-secondary text-xs font-mono uppercase tracking-wide hover:text-text-primary transition-colors"
                      >
                        {expandedNarrativeId === entry.id ? 'Hide summaries' : 'Show summaries'}
                      </button>
                    </div>

                    {expandedNarrativeId === entry.id && (
                      <div className="rounded-lg border border-border/70 bg-surface/60 p-4 space-y-3">
                        {narrativeDetailLoadingId === entry.id ? (
                          <p className="text-text-secondary text-sm font-body">Loading clustered summaries...</p>
                        ) : narrativeDetailErrors[entry.id] ? (
                          <div className="space-y-3">
                            <p className="text-red-400 text-sm font-body">{narrativeDetailErrors[entry.id]}</p>
                            <button
                              type="button"
                              onClick={() => void loadNarrativeDrilldown(entry.id)}
                              className="px-3 py-1.5 rounded border border-border bg-background text-text-secondary text-xs font-mono uppercase tracking-wide hover:text-text-primary transition-colors"
                            >
                              Retry summaries
                            </button>
                          </div>
                        ) : narrativeDetails[entry.id] == null || narrativeDetails[entry.id].summaries.length === 0 ? (
                          <p className="text-text-secondary text-sm font-body">
                            No retained summaries are available for this cluster yet.
                          </p>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                              <div>
                                <p className="text-text-primary text-sm font-body">Most recent clustered summaries</p>
                                <p className="text-text-secondary/70 text-xs font-body mt-1">
                                  Showing {narrativeDetails[entry.id].summaries.length} of {entry.memberCount} summaries
                                  linked to this narrative.
                                </p>
                              </div>
                            </div>

                            <div className="space-y-3">
                              {narrativeDetails[entry.id].summaries.map((summary) => (
                                <div
                                  key={summary.id}
                                  className="rounded-lg border border-border bg-background px-3 py-3 space-y-2"
                                >
                                  <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div className="space-y-1">
                                      <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary">
                                        {summary.source} | {formatRelativeTime(summary.createdAt)}
                                      </div>
                                      <div className="text-text-primary text-sm font-body leading-relaxed">
                                        {summary.text}
                                      </div>
                                    </div>
                                    <Link
                                      to={`/summaries/${summary.id}`}
                                      className="text-xs font-mono uppercase tracking-wider text-accent hover:underline shrink-0"
                                    >
                                      Open summary
                                    </Link>
                                  </div>

                                  <div className="flex flex-wrap gap-2 text-xs font-mono">
                                    <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                                      {summary.itemCount} item{summary.itemCount === 1 ? '' : 's'}
                                    </span>
                                    {summary.urgency && (
                                      <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                                        urgency {summary.urgency}
                                      </span>
                                    )}
                                    {summary.sentiment != null && (
                                      <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                                        sentiment {summary.sentiment > 0 ? '+' : ''}
                                        {summary.sentiment.toFixed(2)}
                                      </span>
                                    )}
                                    <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                                      {summary.sourceId}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
          <div>
            <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Market Calendar</h3>
            <p className="text-text-secondary/70 text-sm font-body mt-1">
              Upcoming catalysts in the next 48 hours feed daily and pulse report prompts.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={openCalendarModal}
              className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors shrink-0"
            >
              Add Event
            </button>
          )}
        </div>

        {calendarActionError && <p className="px-4 pt-4 text-red-400 text-sm font-body">{calendarActionError}</p>}
        {calendarError && <p className="px-4 pt-4 text-red-400 text-sm font-body">{calendarError}</p>}

        {calendarLoading ? (
          <div className="px-4 py-6 text-text-secondary text-sm font-body">Loading...</div>
        ) : calendarEvents.length === 0 ? (
          <EmptyState
            title="No upcoming catalysts"
            description="Add macro dates, token unlocks, expiries, or governance votes to keep the report pipeline calendar-aware."
          />
        ) : (
          <div className="divide-y divide-border">
            {calendarEvents.map((event) => {
              const categoryLabel =
                CALENDAR_EVENT_CATEGORIES.find((entry) => entry.value === event.category)?.label ?? event.category;
              return (
                <div key={event.id} className="px-4 py-4 flex items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-text-primary text-sm font-body">{event.name}</p>
                      <span className="px-2 py-0.5 rounded bg-background border border-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
                        {categoryLabel}
                      </span>
                      {event.entityName && (
                        <span className="px-2 py-0.5 rounded bg-accent/10 border border-accent/20 text-accent text-[11px] font-mono uppercase tracking-wide">
                          {event.entityName}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded bg-background border border-border text-text-secondary/80 text-[11px] font-mono uppercase tracking-wide">
                        {formatCalendarRecurrence(event.recurrenceRule)}
                      </span>
                    </div>
                    <p className="text-text-secondary text-sm font-body">
                      {formatCalendarEventTime(event.nextOccurrence)}
                    </p>
                    {event.description && (
                      <p className="text-text-secondary/70 text-sm font-body">{event.description}</p>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => openEditCalendarModal(event)}
                        className="px-3 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-xs font-mono hover:text-text-primary transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          void removeCalendarEvent(event.id);
                        }}
                        disabled={removingCalendarEventId === event.id}
                        className="px-3 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-mono hover:bg-red-500/30 transition-colors disabled:opacity-50"
                      >
                        {removingCalendarEventId === event.id ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={calendarModalOpen}
        onClose={() => setCalendarModalOpen(false)}
        title={editingCalendarEvent ? 'Edit Market Calendar Event' : 'Add Market Calendar Event'}
      >
        <form onSubmit={handleSaveCalendarEvent} className="space-y-4">
          {calendarActionError && <p className="text-red-400 text-sm font-body">{calendarActionError}</p>}
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Event Name</label>
            <input
              type="text"
              value={calendarName}
              onChange={(e) => setCalendarName(e.target.value)}
              placeholder="FOMC rate decision"
              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
            />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Category</label>
              <select
                aria-label="Category"
                value={calendarCategory}
                onChange={(e) => setCalendarCategory(e.target.value as CalendarEvent['category'])}
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
              >
                {CALENDAR_EVENT_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Date &amp; Time</label>
              <input
                aria-label="Date and time"
                type="datetime-local"
                value={calendarWhen}
                onChange={(e) => setCalendarWhen(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Recurrence</label>
            <select
              aria-label="Recurrence"
              value={calendarRecurrenceRule ?? ''}
              onChange={(e) =>
                setCalendarRecurrenceRule(
                  e.target.value ? (e.target.value as NonNullable<CalendarEvent['recurrenceRule']>) : null,
                )
              }
              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
            >
              <option value="">One-time</option>
              {CALENDAR_RECURRENCE_RULES.map((rule) => (
                <option key={rule.value} value={rule.value}>
                  {rule.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Linked Entity</label>
            <input
              type="text"
              value={calendarEntityName}
              onChange={(e) => setCalendarEntityName(e.target.value)}
              placeholder="Optional: Bitcoin, ETH, Arbitrum"
              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
            />
            <p className="text-text-secondary/70 text-xs font-body">
              Link a known entity to keep pre/post event analysis asset-specific instead of market-wide.
            </p>
            {calendarEntityName.trim().length >= 2 && (
              <div className="bg-background border border-border rounded-lg overflow-hidden">
                {calendarEntitySuggestionsLoading ? (
                  <div className="px-3 py-2 text-text-secondary text-xs font-body">Searching entities...</div>
                ) : calendarEntitySuggestions.length > 0 ? (
                  <div className="divide-y divide-border" aria-label="Entity suggestions">
                    {calendarEntitySuggestions.map((entity) => (
                      <button
                        key={entity.id}
                        type="button"
                        onClick={() => selectCalendarEntitySuggestion(entity)}
                        className="w-full text-left px-3 py-2 hover:bg-surface-raised transition-colors"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-text-primary text-sm font-body">{entity.name}</span>
                          {entity.matchedAlias && (
                            <span className="text-text-secondary/70 text-[11px] font-mono uppercase tracking-wide">
                              alias: {entity.matchedAlias}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-2 text-text-secondary text-xs font-body">No known entities match yet.</div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Description</label>
            <textarea
              rows={3}
              value={calendarDescription}
              onChange={(e) => setCalendarDescription(e.target.value)}
              placeholder="Optional trader-facing context, such as expected impact or asset scope."
              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setCalendarModalOpen(false)}
              className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingCalendarEvent || !calendarName.trim() || !calendarWhen}
              className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {savingCalendarEvent ? 'Saving...' : editingCalendarEvent ? 'Save Changes' : 'Add Event'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/* ── Entities Tab ── */

function EntitiesTab() {
  const { user } = useAuth();
  const { ready: statusReady, getDisabledFeature, isFeatureDisabled, registerDisabledFeature } = useStatus();
  const pricesDisabled = isFeatureDisabled('prices');
  const disabledPrices = getDisabledFeature('prices');
  const isAdmin = user?.role === 'admin';
  const [entityQuery, setEntityQuery] = useState('');
  const [entitySuggestions, setEntitySuggestions] = useState<EntitySuggestion[]>([]);
  const [entitySuggestionsLoading, setEntitySuggestionsLoading] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<EntitySuggestion | null>(null);
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('all');
  const [relationships, setRelationships] = useState<EntityRelationship[]>([]);
  const [competitors, setCompetitors] = useState<EntityRelationship[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [relatedEntityQuery, setRelatedEntityQuery] = useState('');
  const [relatedEntitySuggestions, setRelatedEntitySuggestions] = useState<EntitySuggestion[]>([]);
  const [relatedEntitySuggestionsLoading, setRelatedEntitySuggestionsLoading] = useState(false);
  const [selectedRelatedEntity, setSelectedRelatedEntity] = useState<EntitySuggestion | null>(null);
  const [relationshipType, setRelationshipType] = useState<EntityRelationshipType>('competes_with');
  const [relationshipConfidence, setRelationshipConfidence] = useState('0.70');
  const [relationshipSince, setRelationshipSince] = useState('');
  const [relationshipUntil, setRelationshipUntil] = useState('');
  const [savingRelationship, setSavingRelationship] = useState(false);
  const [removingRelationshipId, setRemovingRelationshipId] = useState<string | null>(null);
  const [focusedRelationshipEntityId, setFocusedRelationshipEntityId] = useState<string | null>(null);
  const [relationshipGraph, setRelationshipGraph] = useState<EntityRelationshipGraphData | null>(null);
  const [divergence, setDivergence] = useState<EntityDivergence | null>(null);
  const [divergenceDays, setDivergenceDays] = useState<number>(7);
  const [priceData, setPriceData] = useState<EntityPriceData | null>(null);
  const [alphaPropagation, setAlphaPropagation] = useState<AlphaPropagationData | null>(null);
  const [entityAuthors, setEntityAuthors] = useState<EntityAuthor[]>([]);
  const [authorsLoading, setAuthorsLoading] = useState(false);
  const [authorsError, setAuthorsError] = useState<string | null>(null);
  const [selectedAuthorId, setSelectedAuthorId] = useState<string | null>(null);
  const [authorProfile, setAuthorProfile] = useState<AuthorProfileData | null>(null);
  const [authorProfileLoading, setAuthorProfileLoading] = useState(false);
  const [authorProfileError, setAuthorProfileError] = useState<string | null>(null);

  useEffect(() => {
    const query = entityQuery.trim();
    const selectedName = selectedEntity?.name.trim().toLowerCase();

    if (query.length < 2 || (selectedName != null && selectedName === query.toLowerCase())) {
      setEntitySuggestions([]);
      setEntitySuggestionsLoading(false);
      return;
    }

    let cancelled = false;
    setEntitySuggestionsLoading(true);

    fetchEntitySuggestionsData(query, statusFilter === 'all' ? null : statusFilter)
      .then((entities) => {
        if (cancelled) return;
        setEntitySuggestions(entities);
      })
      .catch(() => {
        if (cancelled) return;
        setEntitySuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setEntitySuggestionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entityQuery, selectedEntity, statusFilter]);

  useEffect(() => {
    const query = relatedEntityQuery.trim();
    const selectedName = selectedRelatedEntity?.name.trim().toLowerCase();

    if (!isAdmin || query.length < 2 || (selectedName != null && selectedName === query.toLowerCase())) {
      setRelatedEntitySuggestions([]);
      setRelatedEntitySuggestionsLoading(false);
      return;
    }

    let cancelled = false;
    setRelatedEntitySuggestionsLoading(true);

    fetchEntitySuggestionsData(query)
      .then((entities) => {
        if (cancelled) return;
        setRelatedEntitySuggestions(
          entities.filter((entity) => entity.id !== selectedEntity?.id && entity.id !== selectedRelatedEntity?.id),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setRelatedEntitySuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setRelatedEntitySuggestionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, relatedEntityQuery, selectedEntity?.id, selectedRelatedEntity]);

  useEffect(() => {
    if (!selectedEntity) {
      setRelationships([]);
      setCompetitors([]);
      setRelationshipGraph(null);
      setDivergence(null);
      setPriceData(null);
      setAlphaPropagation(null);
      setDetailsError(null);
      setDetailsLoading(false);
      return;
    }
    if (!statusReady) return;

    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(null);

    const pricePromise: Promise<EntityPriceData | null> = pricesDisabled
      ? Promise.resolve(null)
      : fetchEntityPriceData(selectedEntity.id, 7).catch((err) => {
          if (isFeatureDisabledError(err)) {
            registerDisabledFeature({
              feature: err.feature,
              missingEnv: err.missingEnv,
              disables: err.disables,
              reason: err.reason,
            });
            return null;
          }
          if (!isApi404(err)) console.warn('fetchEntityPriceData failed', err);
          return null;
        });

    Promise.all([
      fetchEntityRelationshipsData(selectedEntity.id),
      fetchEntityCompetitorsData(selectedEntity.id),
      fetchEntityRelationshipGraphData(selectedEntity.id),
      pricePromise,
      fetchAlphaPropagation(selectedEntity.id, 7),
    ])
      .then(([nextRelationships, nextCompetitors, nextRelationshipGraph, nextPriceData, nextAlphaPropagation]) => {
        if (cancelled) return;
        setRelationships(nextRelationships);
        setCompetitors(nextCompetitors);
        setRelationshipGraph(nextRelationshipGraph);
        setPriceData(nextPriceData);
        setAlphaPropagation(nextAlphaPropagation);
      })
      .catch(() => {
        if (cancelled) return;
        setRelationships([]);
        setCompetitors([]);
        setRelationshipGraph(null);
        setPriceData(null);
        setAlphaPropagation(null);
        setDetailsError('Failed to load entity relationships.');
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEntity, statusReady, pricesDisabled, registerDisabledFeature]);

  useEffect(() => {
    if (!selectedEntity) {
      setDivergence(null);
      return;
    }

    let cancelled = false;

    fetchEntityDivergenceData(selectedEntity.id, divergenceDays)
      .then((nextDivergence) => {
        if (cancelled) return;
        setDivergence(nextDivergence);
      })
      .catch(() => {
        if (cancelled) return;
        setDivergence(null);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEntity, divergenceDays]);

  useEffect(() => {
    if (!selectedEntity) {
      setEntityAuthors([]);
      setAuthorsLoading(false);
      setAuthorsError(null);
      setSelectedAuthorId(null);
      setAuthorProfile(null);
      setAuthorProfileLoading(false);
      setAuthorProfileError(null);
      return;
    }

    let cancelled = false;
    setAuthorsLoading(true);
    setAuthorsError(null);

    fetchEntityAuthorsData(selectedEntity.id)
      .then((nextAuthors) => {
        if (cancelled) return;
        setEntityAuthors(nextAuthors);
        setSelectedAuthorId((current) => {
          const targetAuthorId = current ?? nextAuthors[0]?.id ?? null;
          if (targetAuthorId && nextAuthors.some((author) => author.id === targetAuthorId)) {
            return targetAuthorId;
          }
          return nextAuthors[0]?.id ?? null;
        });
        if (nextAuthors.length === 0) {
          setAuthorProfile(null);
          setAuthorProfileError(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setEntityAuthors([]);
        setSelectedAuthorId(null);
        setAuthorProfile(null);
        setAuthorsError('Failed to load top authors.');
      })
      .finally(() => {
        if (!cancelled) setAuthorsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEntity]);

  useEffect(() => {
    if (!selectedAuthorId) {
      setAuthorProfile(null);
      setAuthorProfileLoading(false);
      setAuthorProfileError(null);
      return;
    }

    let cancelled = false;
    setAuthorProfileLoading(true);
    setAuthorProfileError(null);

    fetchAuthorProfileData(selectedAuthorId)
      .then((nextProfile) => {
        if (cancelled) return;
        setAuthorProfile(nextProfile);
      })
      .catch(() => {
        if (cancelled) return;
        setAuthorProfile(null);
        setAuthorProfileError('Failed to load author profile.');
      })
      .finally(() => {
        if (!cancelled) setAuthorProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAuthorId]);

  async function reloadSelectedEntityDetails(): Promise<void> {
    if (!selectedEntity) return;

    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const [
        nextRelationships,
        nextCompetitors,
        nextRelationshipGraph,
        nextDivergence,
        nextPriceData,
        nextAlphaPropagation,
      ] = await Promise.all([
        fetchEntityRelationshipsData(selectedEntity.id),
        fetchEntityCompetitorsData(selectedEntity.id),
        fetchEntityRelationshipGraphData(selectedEntity.id),
        fetchEntityDivergenceData(selectedEntity.id, divergenceDays).catch(() => null),
        pricesDisabled
          ? Promise.resolve(null)
          : fetchEntityPriceData(selectedEntity.id, 7).catch((err) => {
              if (isFeatureDisabledError(err)) {
                registerDisabledFeature({
                  feature: err.feature,
                  missingEnv: err.missingEnv,
                  disables: err.disables,
                  reason: err.reason,
                });
                return null;
              }
              if (!isApi404(err)) console.warn('fetchEntityPriceData failed', err);
              return null;
            }),
        fetchAlphaPropagation(selectedEntity.id, 7),
      ]);
      setRelationships(nextRelationships);
      setCompetitors(nextCompetitors);
      setRelationshipGraph(nextRelationshipGraph);
      setDivergence(nextDivergence);
      setPriceData(nextPriceData);
      setAlphaPropagation(nextAlphaPropagation);
    } catch {
      setRelationshipGraph(null);
      setDivergence(null);
      setPriceData(null);
      setAlphaPropagation(null);
      setDetailsError('Failed to load entity relationships.');
    } finally {
      setDetailsLoading(false);
    }
  }

  function selectEntity(entity: EntitySuggestion): void {
    setSelectedEntity(entity);
    setEntityQuery(entity.name);
    setEntitySuggestions([]);
    setFocusedRelationshipEntityId(null);
    setDetailsError(null);
    setActionError(null);
    setSelectedRelatedEntity(null);
    setRelatedEntityQuery('');
    setEntityAuthors([]);
    setAuthorsError(null);
    setSelectedAuthorId(null);
    setAuthorProfile(null);
    setAuthorProfileError(null);
  }

  function selectRelatedEntity(entity: EntitySuggestion): void {
    setSelectedRelatedEntity(entity);
    setRelatedEntityQuery(entity.name);
    setRelatedEntitySuggestions([]);
    setActionError(null);
  }

  async function handleAddRelationship(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!selectedEntity || !selectedRelatedEntity) return;

    const confidence = Number(relationshipConfidence);
    const sinceAt = parseDatetimeLocalInputValue(relationshipSince);
    const untilAt = parseDatetimeLocalInputValue(relationshipUntil);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      setActionError('Confidence must be a number between 0.00 and 1.00.');
      return;
    }
    if (relationshipSince.trim() && sinceAt == null) {
      setActionError('Since must be a valid date and time.');
      return;
    }
    if (relationshipUntil.trim() && untilAt == null) {
      setActionError('Until must be a valid date and time.');
      return;
    }
    if (sinceAt != null && untilAt != null && untilAt < sinceAt) {
      setActionError('Until must be later than or equal to since.');
      return;
    }

    if (selectedEntity.id === selectedRelatedEntity.id) {
      setActionError('Choose a different related entity.');
      return;
    }

    setSavingRelationship(true);
    setActionError(null);
    try {
      await apiFetch('/entities/relationships', {
        method: 'POST',
        body: JSON.stringify({
          entityIdA: selectedEntity.id,
          entityIdB: selectedRelatedEntity.id,
          relationshipType,
          confidence,
          sinceAt,
          untilAt,
        }),
      });
      await reloadSelectedEntityDetails();
      setRelatedEntityQuery('');
      setSelectedRelatedEntity(null);
      setRelationshipType('competes_with');
      setRelationshipConfidence('0.70');
      setRelationshipSince('');
      setRelationshipUntil('');
    } catch {
      setActionError('Failed to save relationship.');
    } finally {
      setSavingRelationship(false);
    }
  }

  async function handleRemoveRelationship(relationshipId: string): Promise<void> {
    setRemovingRelationshipId(relationshipId);
    setActionError(null);
    try {
      await apiFetch(`/entities/relationships/${relationshipId}`, { method: 'DELETE' });
      await reloadSelectedEntityDetails();
    } catch {
      setActionError('Failed to remove relationship.');
    } finally {
      setRemovingRelationshipId(null);
    }
  }

  const shouldShowEntitySuggestions =
    entityQuery.trim().length >= 2 &&
    (selectedEntity == null || entityQuery.trim().toLowerCase() !== selectedEntity.name.toLowerCase());
  const shouldShowRelatedEntitySuggestions =
    isAdmin &&
    relatedEntityQuery.trim().length >= 2 &&
    (selectedRelatedEntity == null ||
      relatedEntityQuery.trim().toLowerCase() !== selectedRelatedEntity.name.toLowerCase());
  const graphConnections = selectedEntity
    ? buildEntityRelationshipGraphConnections(selectedEntity.id, relationships)
    : [];
  const focusedGraphConnection =
    graphConnections.find((connection) => connection.relatedEntityId === focusedRelationshipEntityId) ?? null;
  const visibleRelationships = focusedGraphConnection ? focusedGraphConnection.relationships : relationships;
  const selectedEntityAuthor = entityAuthors.find((author) => author.id === selectedAuthorId) ?? null;
  const selectedAuthor = selectedEntityAuthor ?? authorProfile?.author ?? null;
  const authorCalls = authorProfile?.calls ?? [];

  function toggleGraphConnectionFocus(relatedEntityId: string): void {
    setFocusedRelationshipEntityId((current) => (current === relatedEntityId ? null : relatedEntityId));
  }

  function inspectConnectedEntity(connection: EntityRelationshipGraphConnection): void {
    selectEntity(buildFallbackEntitySuggestion(connection.relatedEntityId, connection.relatedEntityName));
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Entity Detail</h3>
          <p className="text-text-secondary/70 text-sm font-body mt-1">
            Search by canonical name or alias to inspect mapped competitors and other relationships.
          </p>
        </div>
        <div className="p-4 space-y-3">
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Entity Search</label>
            <div className="flex gap-1 flex-wrap">
              {(
                [
                  { label: 'All', value: 'all' },
                  { label: 'Active', value: 'active' },
                  { label: 'Archived', value: 'archived' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatusFilter(option.value)}
                  aria-pressed={statusFilter === option.value}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wide transition-colors ${
                    statusFilter === option.value
                      ? 'bg-accent/20 text-accent border border-accent/30'
                      : 'bg-background border border-border text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={entityQuery}
              onChange={(e) => {
                const nextQuery = e.target.value;
                setEntityQuery(nextQuery);
                if (selectedEntity && nextQuery.trim().toLowerCase() !== selectedEntity.name.toLowerCase()) {
                  setSelectedEntity(null);
                }
              }}
              placeholder="Search entities by name or alias"
              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
            />
          </div>

          {shouldShowEntitySuggestions && (
            <div className="bg-background border border-border rounded-lg overflow-hidden">
              {entitySuggestionsLoading ? (
                <div className="px-3 py-2 text-text-secondary text-xs font-body">Searching entities...</div>
              ) : entitySuggestions.length > 0 ? (
                <div className="divide-y divide-border" aria-label="Entity detail suggestions">
                  {entitySuggestions.map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => selectEntity(entity)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-raised transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-text-primary text-sm font-body">{entity.name}</div>
                          {entity.matchedAlias && (
                            <div className="text-text-secondary/70 text-[11px] font-mono uppercase tracking-wide mt-1">
                              alias: {entity.matchedAlias}
                            </div>
                          )}
                        </div>
                        <EntityLifecycleMeta entity={entity} />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-2 text-text-secondary text-xs font-body">No known entities match yet.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {!selectedEntity ? (
        <EmptyState
          title="Choose an entity"
          description="Pick a known entity to inspect its mapped competitors, inferred relationships, and manual overrides."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-surface border border-border rounded-lg p-4 md:col-span-2">
              <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">
                Selected Entity
              </div>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="text-lg text-text-primary font-heading">{selectedEntity.name}</div>
                  <div className="text-sm text-text-secondary font-body mt-2">
                    {selectedEntity.matchedAlias
                      ? `Matched via alias: ${selectedEntity.matchedAlias}`
                      : 'Matched on canonical name'}
                  </div>
                </div>
                <EntityLifecycleMeta entity={selectedEntity} align="start" />
              </div>
            </div>
            <div className="bg-surface border border-border rounded-lg p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Coverage</div>
              <div className="text-sm text-text-primary font-body leading-relaxed">
                {competitors.length} competitor{competitors.length !== 1 ? 's' : ''}
                <br />
                {relationships.length} total relationship{relationships.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {actionError && <p className="text-red-400 text-sm font-body">{actionError}</p>}
          {detailsError && <p className="text-red-400 text-sm font-body">{detailsError}</p>}

          {detailsLoading ? (
            <div className="text-text-secondary text-sm font-body">Loading entity relationships...</div>
          ) : (
            <div className="space-y-6">
              <div className="bg-surface border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">
                      Regional Divergence
                    </h3>
                    <p className="text-text-secondary/70 text-sm font-body mt-1">
                      Sentiment comparison between English and Indonesian mentions.
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {([7, 14, 30] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDivergenceDays(d)}
                        className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wide transition-colors ${
                          divergenceDays === d
                            ? 'bg-accent/20 text-accent border border-accent/30'
                            : 'bg-background border border-border text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>
                {divergence == null || (divergence.engMentions === 0 && divergence.indMentions === 0) ? (
                  <EmptyState
                    title="No regional data"
                    description="There are no English or Indonesian mentions for this entity in the selected window."
                  />
                ) : (
                  <div className="p-4 space-y-4">
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm font-body">
                          <span className="text-text-secondary">EN sentiment</span>
                          <span className="text-text-primary font-mono text-xs">
                            {divergence.engSentiment != null ? (
                              <>
                                {divergence.engSentiment.toFixed(2)}{' '}
                                <span className="text-text-secondary/70">
                                  ({divergence.engMentions} mention{divergence.engMentions !== 1 ? 's' : ''})
                                </span>
                              </>
                            ) : (
                              <span className="text-text-secondary/50">No data</span>
                            )}
                          </span>
                        </div>
                        {divergence.engSentiment != null && (
                          <div className="h-2.5 w-full bg-background rounded-full overflow-hidden border border-border">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.max(2, divergence.engSentiment * 100)}%`,
                                backgroundColor:
                                  divergence.engSentiment >= 0.55
                                    ? '#34d399'
                                    : divergence.engSentiment <= 0.45
                                      ? '#f87171'
                                      : '#facc15',
                              }}
                            />
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm font-body">
                          <span className="text-text-secondary">ID sentiment</span>
                          <span className="text-text-primary font-mono text-xs">
                            {divergence.indSentiment != null ? (
                              <>
                                {divergence.indSentiment.toFixed(2)}{' '}
                                <span className="text-text-secondary/70">
                                  ({divergence.indMentions} mention{divergence.indMentions !== 1 ? 's' : ''})
                                </span>
                              </>
                            ) : (
                              <span className="text-text-secondary/50">No data</span>
                            )}
                          </span>
                        </div>
                        {divergence.indSentiment != null && (
                          <div className="h-2.5 w-full bg-background rounded-full overflow-hidden border border-border">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.max(2, divergence.indSentiment * 100)}%`,
                                backgroundColor:
                                  divergence.indSentiment >= 0.55
                                    ? '#34d399'
                                    : divergence.indSentiment <= 0.45
                                      ? '#f87171'
                                      : '#facc15',
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-border">
                      <div className="text-sm font-body text-text-secondary">
                        {(() => {
                          if (divergence.engSentiment == null || divergence.indSentiment == null)
                            return 'Insufficient data for comparison';
                          const engLabel =
                            divergence.engSentiment >= 0.55
                              ? 'bullish'
                              : divergence.engSentiment <= 0.45
                                ? 'bearish'
                                : 'neutral';
                          const indLabel =
                            divergence.indSentiment >= 0.55
                              ? 'bullish'
                              : divergence.indSentiment <= 0.45
                                ? 'bearish'
                                : 'neutral';
                          if (engLabel === indLabel) return `Both regions ${engLabel}`;
                          return `EN ${engLabel} / ID ${indLabel}`;
                        })()}
                      </div>
                      {divergence.divergence != null ? (
                        <span
                          className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wide ${
                            divergence.divergence < 0.15
                              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                              : divergence.divergence <= 0.3
                                ? 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                                : 'bg-red-500/10 border border-red-500/20 text-red-400'
                          }`}
                        >
                          {divergence.divergence < 0.15
                            ? 'Aligned'
                            : divergence.divergence <= 0.3
                              ? 'Moderate'
                              : 'Divergent'}{' '}
                          ({divergence.divergence.toFixed(2)})
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wide bg-surface-raised border border-border text-text-secondary">
                          Insufficient
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Price Data Card */}
              {pricesDisabled && disabledPrices ? (
                <FeatureDisabledCard
                  feature={disabledPrices}
                  title="Price Data"
                  description="CoinGecko price snapshots are currently disabled."
                />
              ) : null}
              {!pricesDisabled && priceData?.latest && (
                <div className="bg-surface border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <div>
                      <h3 className="font-heading text-sm font-medium text-text-primary">Price Data</h3>
                      <p className="text-xs text-text-secondary mt-0.5">CoinGecko market data</p>
                    </div>
                    <span className="font-mono text-xs text-text-secondary">
                      {new Date(priceData.latest.timestamp).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="p-4 space-y-4">
                    {/* Current Price */}
                    <div className="flex items-baseline gap-3">
                      <span className="font-heading text-2xl font-bold text-text-primary">
                        $
                        {priceData.latest.priceUsd.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: priceData.latest.priceUsd < 1 ? 6 : 2,
                        })}
                      </span>
                      {priceData.latest.priceChange24h !== null && (
                        <span
                          className={`font-mono text-sm font-medium ${priceData.latest.priceChange24h >= 0 ? 'text-accent-green' : 'text-accent-red'}`}
                        >
                          {priceData.latest.priceChange24h >= 0 ? '+' : ''}
                          {priceData.latest.priceChange24h.toFixed(1)}% 24h
                        </span>
                      )}
                      {priceData.latest.priceChange7d !== null && (
                        <span
                          className={`font-mono text-sm ${priceData.latest.priceChange7d >= 0 ? 'text-accent-green/70' : 'text-accent-red/70'}`}
                        >
                          {priceData.latest.priceChange7d >= 0 ? '+' : ''}
                          {priceData.latest.priceChange7d.toFixed(1)}% 7d
                        </span>
                      )}
                    </div>

                    {/* Volume and Market Cap */}
                    <div className="grid grid-cols-2 gap-4">
                      {priceData.latest.volume24h !== null && (
                        <div>
                          <div className="text-xs text-text-secondary font-mono uppercase">24h Volume</div>
                          <div className="text-sm font-body text-text-primary">
                            ${formatCompactNumber(priceData.latest.volume24h)}
                          </div>
                        </div>
                      )}
                      {priceData.latest.marketCap !== null && (
                        <div>
                          <div className="text-xs text-text-secondary font-mono uppercase">Market Cap</div>
                          <div className="text-sm font-body text-text-primary">
                            ${formatCompactNumber(priceData.latest.marketCap)}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Price History (simple list) */}
                    {priceData.history.length > 1 && (
                      <div>
                        <div className="text-xs text-text-secondary font-mono uppercase mb-2">Recent History</div>
                        <div className="space-y-1">
                          {priceData.history.slice(0, 7).map((snap) => (
                            <div key={snap.id} className="flex justify-between items-center text-xs font-mono">
                              <span className="text-text-secondary">
                                {new Date(snap.timestamp).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                              <span className="text-text-primary">
                                $
                                {snap.priceUsd.toLocaleString('en-US', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: snap.priceUsd < 1 ? 6 : 2,
                                })}
                              </span>
                              {snap.priceChange24h !== null && (
                                <span className={snap.priceChange24h >= 0 ? 'text-accent-green' : 'text-accent-red'}>
                                  {snap.priceChange24h >= 0 ? '+' : ''}
                                  {snap.priceChange24h.toFixed(1)}%
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Alpha Propagation Card */}
              <div className="bg-surface border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Alpha Propagation</h3>
                  <p className="text-text-secondary/70 text-sm font-body mt-1">7d tier timeline</p>
                </div>
                <div className="p-4">
                  {alphaPropagation == null || alphaPropagation.summary.length === 0 ? (
                    <p className="text-sm text-text-secondary font-body">No propagation data yet</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        {[...alphaPropagation.summary]
                          .sort((a, b) => a.firstMentionTime - b.firstMentionTime)
                          .map((entry, idx) => (
                            <div
                              key={`${entry.tier}-${entry.source}-${entry.sourceId}-${idx}`}
                              className="flex items-center gap-3"
                            >
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono uppercase tracking-wide ${
                                  entry.tier === 'alpha'
                                    ? 'bg-purple-500/15 text-purple-400'
                                    : entry.tier === 'influencer'
                                      ? 'bg-blue-500/15 text-blue-400'
                                      : entry.tier === 'mainstream'
                                        ? 'bg-green-500/15 text-green-400'
                                        : 'bg-border/50 text-text-secondary'
                                }`}
                              >
                                {entry.tier}
                              </span>
                              <span className="text-xs font-mono text-text-secondary">
                                {formatRelativeTime(entry.firstMentionTime)}
                              </span>
                              <span className="text-xs font-body text-text-primary truncate">
                                {entry.source}/{entry.sourceId}
                              </span>
                            </div>
                          ))}
                      </div>
                      {alphaPropagation.summary.length >= 2 &&
                        (() => {
                          const sorted = [...alphaPropagation.summary].sort(
                            (a, b) => a.firstMentionTime - b.firstMentionTime,
                          );
                          const first = sorted[0];
                          const last = sorted[sorted.length - 1];
                          const diffHours = (last.firstMentionTime - first.firstMentionTime) / 3_600_000;
                          return (
                            <div className="pt-2 border-t border-border">
                              <span className="text-xs font-mono text-text-secondary">
                                {first.tier} → {last.tier} in{' '}
                                {diffHours < 1 ? `${Math.round(diffHours * 60)}m` : `${diffHours.toFixed(1)}h`}
                              </span>
                            </div>
                          );
                        })()}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] gap-6">
                <div className="bg-surface border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Top Authors</h3>
                    <p className="text-text-secondary/70 text-sm font-body mt-1">
                      Most-linked voices for this entity based on raw mention overlap and extracted calls. First-mover
                      timing uses the earliest tracked call for this entity.
                    </p>
                  </div>
                  {authorsError ? (
                    <div className="p-4 text-red-400 text-sm font-body">{authorsError}</div>
                  ) : entityAuthors.length === 0 ? (
                    authorsLoading ? (
                      <div className="p-4 text-text-secondary text-sm font-body">Loading top authors...</div>
                    ) : (
                      <EmptyState
                        title="No tracked authors yet"
                        description="Stage 1 has not recorded any author-linked claims for this entity yet."
                      />
                    )
                  ) : (
                    <div className="divide-y divide-border" aria-label="Entity top authors">
                      {entityAuthors.map((author) => {
                        const isSelected = author.id === selectedAuthorId;
                        const displayHandle = formatAuthorHandle(author.platform, author.handle);
                        const primaryName = author.displayName?.trim() || displayHandle;
                        return (
                          <button
                            key={author.id}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => {
                              setSelectedAuthorId(author.id);
                              setActionError(null);
                            }}
                            className={`w-full text-left px-4 py-4 transition-colors ${
                              isSelected ? 'bg-accent/10' : 'hover:bg-surface-raised'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm text-text-primary font-body truncate">{primaryName}</div>
                                <div className="mt-1 text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                                  {formatAuthorPlatform(author.platform)} | {displayHandle}
                                </div>
                              </div>
                              <span
                                className={`px-2 py-1 rounded-full text-[11px] font-mono uppercase tracking-wide shrink-0 ${
                                  isSelected
                                    ? 'bg-accent/20 border border-accent/30 text-accent'
                                    : 'bg-background border border-border text-text-secondary'
                                }`}
                              >
                                {author.entityMentionCount} mention{author.entityMentionCount !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-mono uppercase tracking-wide">
                              <span className="px-2 py-1 rounded-full bg-background border border-border text-text-secondary">
                                {author.mentionCount} total mention{author.mentionCount !== 1 ? 's' : ''}
                              </span>
                              <span
                                className={`px-2 py-1 rounded-full border ${
                                  author.firstEntityCallTime == null
                                    ? 'bg-background border-border text-text-secondary'
                                    : author.firstMover
                                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                      : 'bg-background border-border text-text-secondary'
                                }`}
                              >
                                {formatAuthorTiming(author)}
                              </span>
                            </div>
                            {author.firstEntityCallTime != null && (
                              <div className="mt-2 text-xs text-text-secondary font-body">
                                First tracked call {formatRelativeTime(author.firstEntityCallTime)}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-surface border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Author Profile</h3>
                    <p className="text-text-secondary/70 text-sm font-body mt-1">
                      Recent extracted calls and timing for the selected author.
                    </p>
                  </div>
                  {authorProfileError ? (
                    <div className="p-4 text-red-400 text-sm font-body">{authorProfileError}</div>
                  ) : selectedAuthor == null ? (
                    authorsLoading ? (
                      <div className="p-4 text-text-secondary text-sm font-body">Loading author profile...</div>
                    ) : (
                      <EmptyState
                        title="Choose an author"
                        description="Select an author from the list to inspect recent claims and timing."
                      />
                    )
                  ) : authorProfile == null ? (
                    <div className="p-4 text-text-secondary text-sm font-body">
                      {authorProfileLoading ? 'Loading author profile...' : 'No author profile found.'}
                    </div>
                  ) : (
                    <div className="p-4 space-y-4">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="min-w-0">
                          <div className="text-lg text-text-primary font-heading">
                            {authorProfile.author.displayName?.trim() ||
                              formatAuthorHandle(authorProfile.author.platform, authorProfile.author.handle)}
                          </div>
                          <div className="mt-1 text-sm text-text-secondary font-body">
                            {formatAuthorPlatform(authorProfile.author.platform)} |{' '}
                            {formatAuthorHandle(authorProfile.author.platform, authorProfile.author.handle)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                        <div className="rounded-lg border border-border bg-background/70 p-3">
                          <div className="text-[10px] font-mono uppercase tracking-wide text-text-secondary">
                            Entity Mentions
                          </div>
                          <div className="mt-1 text-sm text-text-primary font-body">
                            {selectedEntityAuthor?.entityMentionCount ?? 0}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-background/70 p-3">
                          <div className="text-[10px] font-mono uppercase tracking-wide text-text-secondary">
                            First Tracked Call
                          </div>
                          <div className="mt-1 text-sm text-text-primary font-body">
                            {formatRelativeTime(selectedEntityAuthor?.firstEntityCallTime ?? null)}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-background/70 p-3">
                          <div className="text-[10px] font-mono uppercase tracking-wide text-text-secondary">
                            Entity Timing
                          </div>
                          <div
                            className={`mt-1 text-sm font-body ${
                              selectedEntityAuthor?.firstEntityCallTime != null && selectedEntityAuthor.firstMover
                                ? 'text-emerald-400'
                                : 'text-text-primary'
                            }`}
                          >
                            {formatAuthorTiming(selectedEntityAuthor)}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-background/70 p-3">
                          <div className="text-[10px] font-mono uppercase tracking-wide text-text-secondary">
                            Total Mentions
                          </div>
                          <div className="mt-1 text-sm text-text-primary font-body">
                            {authorProfile.author.mentionCount}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-background/70 p-3">
                          <div className="text-[10px] font-mono uppercase tracking-wide text-text-secondary">
                            Last Seen
                          </div>
                          <div className="mt-1 text-sm text-text-primary font-body">
                            {formatRelativeTime(authorProfile.author.lastSeen)}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 border-t border-border pt-4">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
                            Recent Calls
                          </div>
                          {authorProfileLoading && (
                            <div className="text-xs text-text-secondary font-body">Refreshing profile...</div>
                          )}
                        </div>
                        {authorCalls.length === 0 ? (
                          <EmptyState
                            title="No tracked calls yet"
                            description="This author has been observed, but there are no extracted calls stored yet."
                          />
                        ) : (
                          <div className="space-y-3">
                            {authorCalls.map((call) => (
                              <div
                                key={call.id}
                                className="rounded-lg border border-border bg-background/70 p-4 space-y-3"
                              >
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${getAuthorClaimTypeStyles(call.claimType)}`}
                                    >
                                      {formatAuthorClaimType(call.claimType)}
                                    </span>
                                  </div>
                                  <div className="text-xs text-text-secondary font-body">
                                    {formatRelativeTime(call.timestamp)}
                                  </div>
                                </div>

                                <p className="text-sm text-text-primary font-body leading-relaxed">{call.claimText}</p>

                                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                                  <span className="px-2 py-1 rounded-full bg-surface border border-border">
                                    {call.entityName ?? 'Unknown entity'}
                                  </span>
                                  <span className="px-2 py-1 rounded-full bg-surface border border-border">
                                    {Math.round(call.confidence * 100)}% confidence
                                  </span>
                                </div>

                                <div className="flex items-center gap-3 flex-wrap">
                                  {call.sourceItemId ? (
                                    <Link
                                      to={`/items/${call.sourceItemId}`}
                                      className="inline-flex items-center text-xs font-mono uppercase tracking-wide text-accent hover:opacity-80 transition-opacity"
                                    >
                                      Open source item
                                    </Link>
                                  ) : (
                                    <span className="text-xs text-text-secondary font-body">No source item linked</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-surface border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Relationship Graph</h3>
                  <p className="text-text-secondary/70 text-sm font-body mt-1">
                    First-pass neighborhood view of direct links around the selected entity. Click a node to focus the
                    list below.
                  </p>
                </div>
                <EntityRelationshipGraph
                  selectedEntity={selectedEntity}
                  connections={graphConnections}
                  graphData={relationshipGraph}
                  relationshipCount={relationships.length}
                  focusedConnectionId={focusedRelationshipEntityId}
                  onToggleConnectionFocus={toggleGraphConnectionFocus}
                  onInspectEntity={selectEntity}
                />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-6">
                <div className="bg-surface border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Competitors</h3>
                    <p className="text-text-secondary/70 text-sm font-body mt-1">
                      Direct `competes_with` relationships for this entity.
                    </p>
                  </div>
                  {competitors.length === 0 ? (
                    <EmptyState
                      title="No competitors mapped"
                      description="This entity does not have any direct competitor pairs yet."
                    />
                  ) : (
                    <div className="divide-y divide-border">
                      {competitors.map((relationship) => (
                        <div key={relationship.id} className="px-4 py-4 space-y-2">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="text-sm text-text-primary font-body">
                              {getRelatedEntityName(relationship, selectedEntity.id)}
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${ENTITY_RELATIONSHIP_SOURCE_STYLES[relationship.source]}`}
                            >
                              {formatEntityRelationshipSource(relationship.source)}
                            </span>
                          </div>
                          <div className="text-xs text-text-secondary font-body">
                            Confidence {relationship.confidence.toFixed(2)} | updated{' '}
                            {formatRelativeTime(relationship.updatedAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <div className="bg-surface border border-border rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-border">
                      <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Relationships</h3>
                      <p className="text-text-secondary/70 text-sm font-body mt-1">
                        {focusedGraphConnection
                          ? `Focused on ${focusedGraphConnection.relatedEntityName}; showing only that connection's mapped relationships.`
                          : 'All mapped relationships for this entity, including inferred and seeded links.'}
                      </p>
                    </div>
                    {relationships.length === 0 ? (
                      <EmptyState
                        title="No relationships mapped"
                        description="Use the admin controls below to add the first explicit relationship."
                      />
                    ) : (
                      <div className="divide-y divide-border">
                        {focusedGraphConnection && (
                          <div className="px-4 py-4 bg-background/70 flex items-start justify-between gap-4 flex-wrap">
                            <div className="space-y-2 min-w-0">
                              <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
                                Focused Connection
                              </div>
                              <div className="text-sm text-text-primary font-body">
                                Showing {visibleRelationships.length} mapped relationship
                                {visibleRelationships.length !== 1 ? 's' : ''} with{' '}
                                {focusedGraphConnection.relatedEntityName}.
                              </div>
                              <div className="flex flex-wrap gap-2 text-[11px] font-mono uppercase tracking-wide">
                                <span className="px-2 py-1 rounded-full bg-surface border border-border text-text-secondary">
                                  {getEntityRelationshipConnectionSummary(focusedGraphConnection)}
                                </span>
                                {focusedGraphConnection.hasEvidence && (
                                  <span className="px-2 py-1 rounded-full bg-surface border border-border text-text-secondary">
                                    Evidence-linked
                                  </span>
                                )}
                                {focusedGraphConnection.isEnded && (
                                  <span className="px-2 py-1 rounded-full bg-surface border border-border text-text-secondary">
                                    Ended
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() => inspectConnectedEntity(focusedGraphConnection)}
                                className="px-3 py-2 bg-accent/10 text-accent border border-accent/20 rounded-lg text-xs font-mono uppercase tracking-wide hover:opacity-90 transition-opacity"
                              >
                                Inspect {focusedGraphConnection.relatedEntityName}
                              </button>
                              <button
                                type="button"
                                onClick={() => setFocusedRelationshipEntityId(null)}
                                className="px-3 py-2 bg-background border border-border rounded-lg text-xs font-mono uppercase tracking-wide text-text-secondary hover:text-text-primary transition-colors"
                              >
                                Show all relationships
                              </button>
                            </div>
                          </div>
                        )}
                        {visibleRelationships.map((relationship) => (
                          <div key={relationship.id} className="px-4 py-4 flex items-start justify-between gap-4">
                            <div className="space-y-2 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-text-primary font-body">
                                  {getRelatedEntityName(relationship, selectedEntity.id)}
                                </span>
                                <span className="px-2 py-0.5 rounded bg-background border border-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
                                  {formatEntityRelationshipType(relationship.relationshipType)}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${ENTITY_RELATIONSHIP_SOURCE_STYLES[relationship.source]}`}
                                >
                                  {formatEntityRelationshipSource(relationship.source)}
                                </span>
                              </div>
                              <div className="text-xs text-text-secondary font-body">
                                Confidence {relationship.confidence.toFixed(2)} | updated{' '}
                                {formatRelativeTime(relationship.updatedAt)}
                              </div>
                              {(relationship.sinceAt != null || relationship.untilAt != null) && (
                                <div className="text-xs text-text-secondary font-body">
                                  {relationship.sinceAt != null
                                    ? `Since ${formatRelationshipBoundary(relationship.sinceAt)}`
                                    : 'Start unknown'}
                                  {relationship.untilAt != null
                                    ? ` | Until ${formatRelationshipBoundary(relationship.untilAt)}`
                                    : ''}
                                </div>
                              )}
                              {relationship.summaryId && (
                                <Link
                                  to={`/summaries/${relationship.summaryId}`}
                                  className="inline-flex items-center text-xs font-mono uppercase tracking-wide text-accent hover:opacity-80 transition-opacity"
                                >
                                  Open evidence summary
                                </Link>
                              )}
                            </div>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => {
                                  void handleRemoveRelationship(relationship.id);
                                }}
                                aria-label={`Remove ${getRelatedEntityName(relationship, selectedEntity.id)} ${formatEntityRelationshipType(relationship.relationshipType)} relationship`}
                                disabled={removingRelationshipId === relationship.id}
                                className="px-3 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-mono hover:bg-red-500/30 transition-colors disabled:opacity-50 shrink-0"
                              >
                                {removingRelationshipId === relationship.id ? 'Removing...' : 'Remove'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {isAdmin && (
                    <div className="bg-surface border border-border rounded-lg overflow-hidden">
                      <div className="px-4 py-3 border-b border-border">
                        <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">
                          Manage Relationships
                        </h3>
                        <p className="text-text-secondary/70 text-sm font-body mt-1">
                          Add or override a direct relationship for the selected entity.
                        </p>
                      </div>
                      <form onSubmit={handleAddRelationship} className="p-4 space-y-4">
                        <div className="space-y-1.5">
                          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">
                            Related Entity
                          </label>
                          <input
                            type="text"
                            value={relatedEntityQuery}
                            onChange={(e) => {
                              const nextQuery = e.target.value;
                              setRelatedEntityQuery(nextQuery);
                              if (
                                selectedRelatedEntity &&
                                nextQuery.trim().toLowerCase() !== selectedRelatedEntity.name.toLowerCase()
                              ) {
                                setSelectedRelatedEntity(null);
                              }
                            }}
                            placeholder="Search another entity to relate"
                            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
                          />
                          {shouldShowRelatedEntitySuggestions && (
                            <div className="bg-background border border-border rounded-lg overflow-hidden">
                              {relatedEntitySuggestionsLoading ? (
                                <div className="px-3 py-2 text-text-secondary text-xs font-body">
                                  Searching entities...
                                </div>
                              ) : relatedEntitySuggestions.length > 0 ? (
                                <div className="divide-y divide-border" aria-label="Relationship suggestions">
                                  {relatedEntitySuggestions.map((entity) => (
                                    <button
                                      key={entity.id}
                                      type="button"
                                      onClick={() => selectRelatedEntity(entity)}
                                      className="w-full text-left px-3 py-2 hover:bg-surface-raised transition-colors"
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="text-text-primary text-sm font-body">{entity.name}</span>
                                        {entity.matchedAlias && (
                                          <span className="text-text-secondary/70 text-[11px] font-mono uppercase tracking-wide">
                                            alias: {entity.matchedAlias}
                                          </span>
                                        )}
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="px-3 py-2 text-text-secondary text-xs font-body">
                                  No known entities match yet.
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="grid md:grid-cols-[minmax(0,1fr)_140px] gap-4">
                          <div className="space-y-1.5">
                            <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">
                              Relationship Type
                            </label>
                            <select
                              value={relationshipType}
                              onChange={(e) => setRelationshipType(e.target.value as EntityRelationshipType)}
                              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
                            >
                              {ENTITY_RELATIONSHIP_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">
                              Confidence
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="1"
                              step="0.05"
                              value={relationshipConfidence}
                              onChange={(e) => setRelationshipConfidence(e.target.value)}
                              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-mono focus:outline-none focus:border-accent"
                            />
                          </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label
                              htmlFor="relationship-since"
                              className="font-mono text-xs uppercase tracking-wider text-text-secondary"
                            >
                              Since
                            </label>
                            <input
                              id="relationship-since"
                              type="datetime-local"
                              value={relationshipSince}
                              onChange={(e) => setRelationshipSince(e.target.value)}
                              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label
                              htmlFor="relationship-until"
                              className="font-mono text-xs uppercase tracking-wider text-text-secondary"
                            >
                              Until
                            </label>
                            <input
                              id="relationship-until"
                              type="datetime-local"
                              value={relationshipUntil}
                              onChange={(e) => setRelationshipUntil(e.target.value)}
                              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <button
                            type="submit"
                            disabled={savingRelationship || !selectedRelatedEntity}
                            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity disabled:opacity-50"
                          >
                            {savingRelationship ? 'Saving...' : 'Save Relationship'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Users Tab ── */

function UsersTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [auditEvents, setAuditEvents] = useState<UserAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteDiscordId, setInviteDiscordId] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRecord['role']>('viewer');
  const [inviteSaving, setInviteSaving] = useState(false);
  const [requestRoleDrafts, setRequestRoleDrafts] = useState<Record<string, 'viewer' | 'admin'>>({});
  const [requestMutatingId, setRequestMutatingId] = useState<string | null>(null);

  const reloadUsersAuditAndRequests = async () => {
    const [usersResult, requestsResult, auditResult] = await Promise.allSettled([
      fetchUsersData(),
      fetchAccessRequestsData(),
      fetchUserAuditEventsData(),
    ]);

    if (usersResult.status === 'fulfilled') {
      setUsers(usersResult.value);
      setError(null);
    } else {
      setError('Failed to load users.');
    }

    if (requestsResult.status === 'fulfilled') {
      setAccessRequests(requestsResult.value);
      setRequestsError(null);
      setRequestRoleDrafts((prev) => {
        const next = { ...prev };
        for (const request of requestsResult.value) {
          if (!next[request.id]) next[request.id] = request.requestedRole;
        }
        return next;
      });
    } else {
      setRequestsError('Failed to load access requests.');
    }

    if (auditResult.status === 'fulfilled') {
      setAuditEvents(auditResult.value);
      setAuditError(null);
    } else {
      setAuditError('Failed to load recent activity.');
    }
  };

  useEffect(() => {
    reloadUsersAuditAndRequests().finally(() => setLoading(false));
  }, []);

  const openInviteModal = () => {
    setInviteDiscordId('');
    setInviteRole('viewer');
    setError(null);
    setInviteModalOpen(true);
  };

  const changeRole = async (discordId: string, role: string) => {
    setError(null);
    try {
      await apiFetch(`/users/${discordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await reloadUsersAuditAndRequests();
    } catch {
      setError(`Failed to update role for user.`);
    }
  };

  const inviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedDiscordId = inviteDiscordId.trim();
    if (!trimmedDiscordId) return;

    setInviteSaving(true);
    setError(null);
    try {
      await apiFetch<UserRecord>('/users/invite', {
        method: 'POST',
        body: JSON.stringify({ discordId: trimmedDiscordId, role: inviteRole }),
      });
      await reloadUsersAuditAndRequests();
      setInviteModalOpen(false);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('400')) {
        setError('Discord IDs must be 17-20 digits.');
      } else {
        setError('Failed to invite user.');
      }
    } finally {
      setInviteSaving(false);
    }
  };

  const reviewAccessRequest = async (requestId: string, decision: 'approved' | 'rejected') => {
    setRequestsError(null);
    setRequestMutatingId(requestId);
    try {
      await apiFetch(`/access-requests/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision,
          role: decision === 'approved' ? (requestRoleDrafts[requestId] ?? 'viewer') : undefined,
        }),
      });
      setRequestRoleDrafts((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
      await reloadUsersAuditAndRequests();
    } catch {
      setRequestsError(`Failed to ${decision === 'approved' ? 'approve' : 'reject'} access request.`);
    } finally {
      setRequestMutatingId(null);
    }
  };

  if (loading) return <div className="text-text-secondary font-body py-8">Loading...</div>;

  if (users.length === 0 && error) {
    return <p className="text-red-400 text-sm font-body py-4">{error}</p>;
  }

  const inviteModal = (
    <Modal open={inviteModalOpen} onClose={() => setInviteModalOpen(false)} title="Invite User">
      <form onSubmit={inviteUser} className="space-y-4">
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Discord ID</label>
          <input
            type="text"
            required
            value={inviteDiscordId}
            onChange={(e) => setInviteDiscordId(e.target.value)}
            placeholder="123456789012345678"
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-mono placeholder:text-[#555566] focus:outline-none focus:border-accent"
          />
          <p className="text-xs text-text-secondary/70 font-body">
            Pre-authorize this Discord account before the user signs in for the first time.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Starting Role</label>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as UserRecord['role'])}
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
          >
            <option value="viewer">viewer</option>
            <option value="admin">admin</option>
            <option value="blocked">blocked</option>
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => setInviteModalOpen(false)}
            className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={inviteSaving || !inviteDiscordId.trim()}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {inviteSaving ? 'Inviting...' : 'Invite User'}
          </button>
        </div>
      </form>
    </Modal>
  );

  return (
    <div className="space-y-4">
      {inviteModal}
      {error && <p className="text-red-400 text-sm font-body">{error}</p>}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-text-secondary/70 text-sm font-body">
          Podders is invite-only. Pre-authorize Discord IDs here before first login, then adjust roles as needed.
        </p>
        <button
          onClick={openInviteModal}
          className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity"
        >
          Invite User
        </button>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-secondary font-mono text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">Last Login</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.discordId}
                  className="border-b border-border last:border-b-0 hover:bg-surface-raised transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {u.avatar && !isPendingInvite(u) ? (
                        <img
                          src={`https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png?size=32`}
                          alt=""
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-surface-raised flex items-center justify-center text-text-secondary text-xs font-mono">
                          {(isPendingInvite(u) ? '?' : u.username.charAt(0)).toUpperCase()}
                        </div>
                      )}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-text-primary font-body">
                            {isPendingInvite(u) ? 'Pending invite' : u.username}
                          </span>
                          {isPendingInvite(u) && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-border text-text-secondary">
                              waiting for first login
                            </span>
                          )}
                        </div>
                        <div className="text-text-secondary/60 text-xs font-mono">{u.discordId}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-mono ${
                        u.role === 'admin'
                          ? 'bg-accent/20 text-accent'
                          : u.role === 'blocked'
                            ? 'bg-accent-red/20 text-accent-red'
                            : 'bg-border text-text-secondary'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                    {formatRelativeTime(u.lastLoginAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {u.discordId !== currentUser?.discordId && (
                      <select
                        value={u.role}
                        onChange={(e) => changeRole(u.discordId, e.target.value)}
                        className="bg-background border border-border rounded px-2 py-1 text-text-primary text-xs font-mono focus:outline-none focus:border-accent"
                      >
                        <option value="admin">admin</option>
                        <option value="viewer">viewer</option>
                        <option value="blocked">blocked</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">
                Pending Access Requests
              </h3>
              <p className="text-text-secondary/70 mt-1 text-sm font-body">
                Review self-service access requests from the login page.
              </p>
            </div>
            {requestsError && <p className="px-4 py-3 text-red-400 text-sm font-body">{requestsError}</p>}
            {!requestsError && accessRequests.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-text-secondary text-sm font-body">No pending access requests.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {accessRequests.map((request) => (
                  <div key={request.id} className="px-4 py-3 space-y-3">
                    <div className="space-y-1">
                      <div className="text-text-primary text-sm font-body">{request.discordId}</div>
                      <div className="flex items-center justify-between gap-3 text-xs font-mono">
                        <span className="text-text-secondary">requested {request.requestedRole}</span>
                        <span className="text-text-secondary">{formatRelativeTime(request.createdAt)}</span>
                      </div>
                    </div>
                    {request.note && <p className="text-text-secondary text-sm font-body">{request.note}</p>}
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={requestRoleDrafts[request.id] ?? request.requestedRole}
                        onChange={(e) =>
                          setRequestRoleDrafts((prev) => ({
                            ...prev,
                            [request.id]: e.target.value as 'viewer' | 'admin',
                          }))
                        }
                        className="bg-background border border-border rounded px-2 py-1 text-text-primary text-xs font-mono focus:outline-none focus:border-accent"
                      >
                        <option value="viewer">viewer</option>
                        <option value="admin">admin</option>
                      </select>
                      <button
                        onClick={() => reviewAccessRequest(request.id, 'approved')}
                        disabled={requestMutatingId === request.id}
                        className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-body hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => reviewAccessRequest(request.id, 'rejected')}
                        disabled={requestMutatingId === request.id}
                        className="px-3 py-1.5 bg-accent-red/20 text-accent-red border border-accent-red/30 rounded-lg text-xs font-body hover:bg-accent-red/30 transition-colors disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Recent Access Activity</h3>
              <p className="text-text-secondary/70 mt-1 text-sm font-body">
                Invites, request decisions, and role changes made by admins, newest first.
              </p>
            </div>
            {auditError && <p className="px-4 py-3 text-red-400 text-sm font-body">{auditError}</p>}
            {!auditError && auditEvents.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-text-secondary text-sm font-body">No recent user-management activity.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {auditEvents.map((event) => {
                  const targetLabel = getAuditTargetLabel(event);
                  let title = `Updated ${targetLabel}`;
                  let detail = `${event.previousRole ?? 'unknown'} -> ${event.newRole ?? 'unknown'}`;
                  let badge = 'role change';

                  if (event.action === 'invite') {
                    title = `Invited ${targetLabel}`;
                    detail = `Role ${event.newRole ?? 'viewer'}`;
                    badge = 'invite';
                  } else if (event.action === 'request_approved') {
                    title = `Approved request for ${targetLabel}`;
                    detail = `${event.previousRole ?? 'no access'} -> ${event.newRole ?? 'unknown'}`;
                    badge = 'request approved';
                  } else if (event.action === 'request_rejected') {
                    title = `Rejected request for ${targetLabel}`;
                    detail = event.previousRole ? `Current role ${event.previousRole}` : 'No access granted';
                    badge = 'request rejected';
                  } else if (event.action === 'role_change') {
                    title = `Changed ${targetLabel} to ${event.newRole ?? 'unknown'}`;
                    detail = `${event.previousRole ?? 'unknown'} -> ${event.newRole ?? 'unknown'}`;
                  }

                  return (
                    <div key={event.id} className="px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-text-primary text-sm font-body">{title}</div>
                          <div className="text-text-secondary/60 text-xs font-mono">{event.targetDiscordId}</div>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-border text-text-secondary">
                          {badge}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs font-mono">
                        <span className="text-text-secondary">{detail}</span>
                        <span className="text-text-secondary">{formatRelativeTime(event.createdAt)}</span>
                      </div>
                      <div className="text-text-secondary/60 text-xs font-body">by {event.actorUsername}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Settings Page ── */

export function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tabs: { key: Tab; label: string; adminOnly?: boolean }[] = [
    { key: 'sources', label: 'Sources', adminOnly: true },
    { key: 'delivery', label: 'Delivery', adminOnly: true },
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'entities', label: 'Entities' },
    { key: 'users', label: 'Users', adminOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin);
  const [activeTab, setActiveTab] = useState<Tab>(visibleTabs[0]?.key ?? 'pipeline');

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="font-heading text-2xl text-text-primary">Settings</h1>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-border">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors border-b-2 -mb-px ${
              activeTab === t.key
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'sources' && isAdmin && <SourcesTab />}
      {activeTab === 'delivery' && isAdmin && <DeliveryTab />}
      {activeTab === 'pipeline' && <PipelineTab />}
      {activeTab === 'entities' && <EntitiesTab />}
      {activeTab === 'users' && isAdmin && <UsersTab />}
    </div>
  );
}
