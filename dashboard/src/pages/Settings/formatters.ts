import type {
  Source,
  EntitySuggestion,
  MacroBias,
  MacroSignal,
  MacroOverviewEntry,
  MacroIndicator,
  UnusualActivityEntry,
  NarrativeSignalStrength,
  NarrativeWatchlistEntry,
  CalendarEvent,
  EntityRelationshipType,
  EntityRelationshipSource,
  EntityAliasOrigin,
  EntityRelationship,
  AuthorClaimType,
  EntityAuthor,
  EntityRelationshipGraphConnection,
  EntityRelationshipGraphNode,
  EntityRelationshipGraphData,
  EntityRelationshipSecondDegreeGroup,
  UserRecord,
  UserAuditEvent,
} from './types.js';

export function getSourceDisplayName(source: Pick<Source, 'source' | 'sourceId' | 'label'>): string {
  const trimmedLabel = typeof source.label === 'string' ? source.label.trim() : '';
  if (trimmedLabel) return trimmedLabel;

  const trimmedSourceId = source.sourceId.trim();
  if (trimmedSourceId) return trimmedSourceId;

  return `${source.source} source`;
}

export function buildSourceActionPath(source: Pick<Source, 'source' | 'sourceId'>): string {
  const params = new URLSearchParams();
  params.set('sourceId', source.sourceId);
  return `/sources/${encodeURIComponent(source.source)}?${params.toString()}`;
}

export function isApi404(err: unknown): boolean {
  return err instanceof Error && /^API 404\b/.test(err.message);
}

export function clampEntityRelevance(relevance: number): number {
  if (!Number.isFinite(relevance)) return 0;
  return Math.min(Math.max(relevance, 0), 1);
}

export function getEntityStatusBadgeClasses(status: EntitySuggestion['status']): string {
  return status === 'active'
    ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-300'
    : 'bg-background border border-border text-text-secondary';
}

export function formatEntityRelevancePercent(relevance: number): string {
  return `${Math.round(clampEntityRelevance(relevance) * 100)}%`;
}

export function buildFallbackEntitySuggestion(id: string, name: string): EntitySuggestion {
  return {
    id,
    name,
    matchedAlias: null,
    status: 'active',
    relevance: 0,
    lastSeen: Date.now(),
  };
}

export function formatCompactNumber(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(2);
}

export function macroToneClasses(tone: MacroBias | MacroSignal): string {
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

export function formatMacroValue(entry: MacroOverviewEntry): string {
  if (entry.indicator === 'spx') {
    return entry.value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return entry.value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatMacroChange(value: number | null, indicator: MacroIndicator): string {
  if (value == null) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString('en-US', {
    minimumFractionDigits: indicator === 'spx' ? 0 : 2,
    maximumFractionDigits: indicator === 'spx' ? 0 : 2,
  })}`;
}

export function formatUnusualActivityRatio(ratio: number | null): string {
  if (ratio == null) return 'New breakout';
  return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}x baseline`;
}

export function formatUnusualActivityRelevance(score: number | null): string {
  if (score == null) return 'n/a';
  return score >= 10 ? score.toFixed(0) : score.toFixed(1);
}

export function unusualActivityBadgeClasses(entry: UnusualActivityEntry): string {
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

export function formatSignedFixed(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

export function formatUnusualActivityNarrative(entry: UnusualActivityEntry): string {
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

export function narrativeSignalClasses(signalStrength: NarrativeSignalStrength): string {
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

export function formatNarrativeSignalLabel(signalStrength: NarrativeSignalStrength): string {
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

export function formatNarrativeSentiment(avgSentiment: number | null): string {
  if (avgSentiment == null) return 'sentiment n/a';
  return `sentiment ${formatSignedFixed(avgSentiment)}`;
}

export function formatNarrativeLifecycleCopy(entry: NarrativeWatchlistEntry): string {
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

export const TIMEZONES = (() => {
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

export const CALENDAR_EVENT_CATEGORIES: Array<{ value: CalendarEvent['category']; label: string }> = [
  { value: 'macro', label: 'Macro' },
  { value: 'unlock', label: 'Unlock' },
  { value: 'expiry', label: 'Expiry' },
  { value: 'governance', label: 'Governance' },
  { value: 'launch', label: 'Launch' },
  { value: 'legal', label: 'Legal' },
  { value: 'custom', label: 'Custom' },
];

export const CALENDAR_RECURRENCE_RULES: Array<{ value: NonNullable<CalendarEvent['recurrenceRule']>; label: string }> =
  [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
  ];

export const ENTITY_RELATIONSHIP_TYPE_OPTIONS: Array<{ value: EntityRelationshipType; label: string }> = [
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

export const ENTITY_RELATIONSHIP_SOURCE_STYLES: Record<EntityRelationshipSource, string> = {
  llm_inferred: 'bg-accent/10 border border-accent/20 text-accent',
  manual: 'bg-accent-green/10 border border-accent-green/20 text-accent-green',
  coingecko: 'bg-background border border-border text-text-secondary',
};

export const ENTITY_ALIAS_ORIGIN_STYLES: Record<EntityAliasOrigin, string> = {
  seed: 'bg-background border border-border text-text-secondary',
  llm: 'bg-accent/10 border border-accent/20 text-accent',
  manual: 'bg-accent-green/10 border border-accent-green/20 text-accent-green',
  unknown: 'bg-yellow-500/15 border border-yellow-500/25 text-yellow-300',
};

export const ENTITY_RELATIONSHIP_GRAPH_STYLES: Record<
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

export const MAX_ENTITY_GRAPH_CONNECTIONS = 6;

export function formatRelativeTime(dateValue: number | null): string {
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

export function formatDateLabel(dateValue: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(dateValue);
}

export function formatCountdown(futureMs: number): string {
  const diff = futureMs - Date.now();
  if (diff <= 0) return 'imminently';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `in ${secs}s`;
  const mins = Math.ceil(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.ceil(mins / 60);
  return `in ${hours}h`;
}

export function decodeTwitterError(source: Source): string {
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

export function formatCalendarEventTime(dateValue: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateValue);
}

export function toDatetimeLocalInputValue(dateValue: number): string {
  const date = new Date(dateValue);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function defaultCalendarEventInputValue(): string {
  const next = new Date(Date.now() + 24 * 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  return toDatetimeLocalInputValue(next.getTime());
}

export function parseDatetimeLocalInputValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateValue = new Date(trimmed).getTime();
  return Number.isFinite(dateValue) ? dateValue : null;
}

export function formatCalendarRecurrence(recurrenceRule: CalendarEvent['recurrenceRule']): string {
  if (recurrenceRule == null) return 'One-time';
  return CALENDAR_RECURRENCE_RULES.find((rule) => rule.value === recurrenceRule)?.label ?? recurrenceRule;
}

export function formatEntityRelationshipType(type: EntityRelationshipType): string {
  return ENTITY_RELATIONSHIP_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

export function formatEntityAliasOrigin(origin: EntityAliasOrigin): string {
  switch (origin) {
    case 'seed':
      return 'Seed';
    case 'llm':
      return 'LLM';
    case 'manual':
      return 'Manual';
    case 'unknown':
      return 'Unknown';
  }
}

export function formatEntityRelationshipSource(source: EntityRelationshipSource): string {
  if (source === 'llm_inferred') return 'LLM inferred';
  if (source === 'coingecko') return 'CoinGecko';
  return 'Manual';
}

export function formatRelationshipBoundary(dateValue: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateValue);
}

export function getRelatedEntityName(relationship: EntityRelationship, entityId: string): string {
  return relationship.entityIdA === entityId ? relationship.entityNameB : relationship.entityNameA;
}

export function getRelatedEntityId(relationship: EntityRelationship, entityId: string): string {
  return relationship.entityIdA === entityId ? relationship.entityIdB : relationship.entityIdA;
}

export function formatAuthorHandle(platform: string, handle: string): string {
  if (platform === 'twitter' && !handle.startsWith('@')) {
    return `@${handle}`;
  }
  return handle;
}

export function formatAuthorPlatform(platform: string): string {
  if (platform === 'twitter') return 'Twitter/X';
  if (platform === 'discord') return 'Discord';
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

export function formatAuthorClaimType(type: AuthorClaimType): string {
  if (type === 'bullish') return 'Bullish';
  if (type === 'bearish') return 'Bearish';
  if (type === 'event') return 'Event';
  return 'Neutral';
}

export function getAuthorClaimTypeStyles(type: AuthorClaimType): string {
  if (type === 'bullish') return 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400';
  if (type === 'bearish') return 'bg-red-500/10 border border-red-500/20 text-red-400';
  if (type === 'event') return 'bg-blue-500/10 border border-blue-500/20 text-blue-400';
  return 'bg-background border border-border text-text-secondary';
}

export function formatCompactDuration(durationMs: number): string {
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

export function formatIsoDateTime(dateValue: string | null): string {
  if (!dateValue) return 'Never';
  const timestamp = Date.parse(dateValue);
  if (!Number.isFinite(timestamp)) return dateValue;
  return formatRelationshipBoundary(timestamp);
}

export function formatIsoAge(dateValue: string): string {
  const timestamp = Date.parse(dateValue);
  if (!Number.isFinite(timestamp)) return 'Unknown';
  return formatCompactDuration(Date.now() - timestamp);
}

export function truncateDiagnosticText(value: string | null, maxLength = 100): string {
  if (!value) return 'None';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function getDiagSeverityClasses(severity: string): string {
  if (severity === 'critical') return 'bg-accent-red/20 text-accent-red';
  if (severity === 'error') return 'bg-yellow-500/20 text-yellow-400';
  if (severity === 'warn') return 'bg-yellow-500/10 text-yellow-400';
  return 'bg-background border border-border text-text-secondary';
}

export function formatAuthorTiming(
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

export function getEntityRelationshipConnectionSummary(connection: EntityRelationshipGraphConnection): string {
  if (connection.relationships.length === 1) {
    return formatEntityRelationshipType(connection.primaryRelationship.relationshipType);
  }

  return `${connection.relationships.length} mapped links`;
}

export function buildEntityRelationshipGraphConnections(
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

export function getEntityRelationshipGraphPosition(index: number, total: number): { x: number; y: number } {
  if (total <= 1) return { x: 50, y: 19 };

  const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
  return {
    x: 50 + Math.cos(angle) * 28,
    y: 50 + Math.sin(angle) * 31,
  };
}

export function buildEntityRelationshipSecondDegreeGroups(
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

export function isPendingInvite(user: UserRecord): boolean {
  return user.lastLoginAt == null;
}

export function getAuditTargetLabel(event: UserAuditEvent): string {
  if (event.targetUsername && event.targetUsername !== 'Pending invite') return event.targetUsername;
  return event.targetDiscordId;
}
