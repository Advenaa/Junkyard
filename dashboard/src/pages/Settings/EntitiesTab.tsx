import { Fragment, useState, useEffect } from 'react';
import { Link } from 'react-router';
import { apiFetch, isApiError, isFeatureDisabledError } from '../../lib/api.js';
import { useAuth } from '../../components/AuthProvider.js';
import { useStatus } from '../../components/StatusProvider.js';
import { FeatureDisabledCard } from '../../components/FeatureDisabledCard.js';
import { StatusBadge } from '../../components/StatusBadge.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Modal } from '../../components/Modal.js';
import type {
  EntitySuggestion,
  EntityRelationshipGraphData,
  EntityRelationshipGraphConnection,
  Source,
  PipelineStatus,
  DiscordManagedToken,
  DiscordTokenHealthState,
  Config,
  MacroOverview,
  UnusualActivityOverview,
  NarrativeWatchlistOverview,
  NarrativeDrilldown,
  HealthResponse,
  DiagBackpressure,
  DiagStuckItems,
  DiagHaltedSources,
  DiagHealthEvents,
  LlmCostByModelResponse,
  CalendarEvent,
  EntityAlias,
  EntityRelationshipType,
  EntityRelationship,
  EntityDivergence,
  EntityPriceData,
  AlphaPropagationData,
  EntityAuthor,
  AuthorProfileData,
  UserRecord,
  UserAuditEvent,
  AccessRequest,
  SessionInfo,
  Tab,
} from './types.js';
import {
  fetchSourcesData,
  fetchDiscordTokensData,
  fetchDiscordTokenHealthData,
  fetchCalendarEventsData,
  fetchMacroOverviewData,
  fetchDiagBackpressure,
  fetchLlmCostByModel,
  fetchDiagStuckItems,
  fetchDiagHaltedSources,
  fetchDiagHealthEvents,
  fetchUnusualActivityOverviewData,
  fetchNarrativeWatchlistData,
  fetchNarrativeDrilldownData,
  fetchEntitySuggestionsData,
  fetchEntityAliasesData,
  fetchEntityRelationshipsData,
  fetchEntityCompetitorsData,
  fetchEntityRelationshipGraphData,
  fetchEntityDivergenceData,
  fetchEntityPriceData,
  fetchAlphaPropagation,
  fetchEntityAuthorsData,
  fetchAuthorProfileData,
  fetchUsersData,
  fetchUserSessions,
  fetchUserAuditEventsData,
  fetchAccessRequestsData,
  revokeUserSession,
} from './api.js';
import {
  getEntityStatusBadgeClasses,
  formatEntityRelevancePercent,
  buildFallbackEntitySuggestion,
  ENTITY_RELATIONSHIP_GRAPH_STYLES,
  MAX_ENTITY_GRAPH_CONNECTIONS,
  getEntityRelationshipConnectionSummary,
  getEntityRelationshipGraphPosition,
  buildEntityRelationshipSecondDegreeGroups,
  getSourceDisplayName,
  buildSourceActionPath,
  formatRelativeTime,
  decodeTwitterError,
  TIMEZONES,
  macroToneClasses,
  formatMacroValue,
  formatMacroChange,
  formatUnusualActivityRatio,
  formatUnusualActivityRelevance,
  unusualActivityBadgeClasses,
  formatSignedFixed,
  formatUnusualActivityNarrative,
  narrativeSignalClasses,
  formatNarrativeSignalLabel,
  formatNarrativeSentiment,
  formatNarrativeLifecycleCopy,
  CALENDAR_EVENT_CATEGORIES,
  CALENDAR_RECURRENCE_RULES,
  formatCalendarEventTime,
  toDatetimeLocalInputValue,
  defaultCalendarEventInputValue,
  formatCalendarRecurrence,
  formatCompactDuration,
  formatIsoDateTime,
  formatIsoAge,
  truncateDiagnosticText,
  getDiagSeverityClasses,
  isApi404,
  formatCompactNumber,
  ENTITY_RELATIONSHIP_TYPE_OPTIONS,
  ENTITY_RELATIONSHIP_SOURCE_STYLES,
  ENTITY_ALIAS_ORIGIN_STYLES,
  formatDateLabel,
  parseDatetimeLocalInputValue,
  formatEntityRelationshipType,
  formatEntityAliasOrigin,
  formatEntityRelationshipSource,
  formatRelationshipBoundary,
  getRelatedEntityName,
  formatAuthorHandle,
  formatAuthorPlatform,
  formatAuthorClaimType,
  getAuthorClaimTypeStyles,
  formatAuthorTiming,
  buildEntityRelationshipGraphConnections,
  isPendingInvite,
  getAuditTargetLabel,
} from './formatters.js';

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

export default function EntitiesTab() {
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
  const [aliases, setAliases] = useState<EntityAlias[]>([]);
  const [relationships, setRelationships] = useState<EntityRelationship[]>([]);
  const [competitors, setCompetitors] = useState<EntityRelationship[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const [savingAlias, setSavingAlias] = useState(false);
  const [removingAliasId, setRemovingAliasId] = useState<string | null>(null);
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
      setAliases([]);
      setAliasDraft('');
      setSavingAlias(false);
      setRemovingAliasId(null);
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
      fetchEntityAliasesData(selectedEntity.id),
      fetchEntityRelationshipsData(selectedEntity.id),
      fetchEntityCompetitorsData(selectedEntity.id),
      fetchEntityRelationshipGraphData(selectedEntity.id),
      pricePromise,
      fetchAlphaPropagation(selectedEntity.id, 7),
    ])
      .then(
        ([
          nextAliases,
          nextRelationships,
          nextCompetitors,
          nextRelationshipGraph,
          nextPriceData,
          nextAlphaPropagation,
        ]) => {
          if (cancelled) return;
          setAliases(nextAliases);
          setRelationships(nextRelationships);
          setCompetitors(nextCompetitors);
          setRelationshipGraph(nextRelationshipGraph);
          setPriceData(nextPriceData);
          setAlphaPropagation(nextAlphaPropagation);
        },
      )
      .catch(() => {
        if (cancelled) return;
        setAliases([]);
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
        nextAliases,
        nextRelationships,
        nextCompetitors,
        nextRelationshipGraph,
        nextDivergence,
        nextPriceData,
        nextAlphaPropagation,
      ] = await Promise.all([
        fetchEntityAliasesData(selectedEntity.id),
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
      setAliases(nextAliases);
      setRelationships(nextRelationships);
      setCompetitors(nextCompetitors);
      setRelationshipGraph(nextRelationshipGraph);
      setDivergence(nextDivergence);
      setPriceData(nextPriceData);
      setAlphaPropagation(nextAlphaPropagation);
    } catch {
      setAliases([]);
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
    setAliases([]);
    setDetailsError(null);
    setActionError(null);
    setAliasDraft('');
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
  async function handleAddAlias(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!selectedEntity) return;
    const alias = aliasDraft.trim();
    if (!alias) {
      setActionError('Alias cannot be empty.');
      return;
    }
    setSavingAlias(true);
    setActionError(null);
    try {
      const { alias: createdAlias } = await apiFetch<{
        alias: EntityAlias;
      }>(`/entities/${selectedEntity.id}/aliases`, {
        method: 'POST',
        body: JSON.stringify({ alias }),
      });
      setAliases((current) =>
        [...current, createdAlias].sort((a, b) => a.createdAt - b.createdAt || a.alias.localeCompare(b.alias)),
      );
      setAliasDraft('');
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        if (err.detail?.includes('another entity')) {
          setActionError('Alias is already claimed by another entity.');
        } else {
          setActionError('Alias already exists for this entity.');
        }
      } else {
        setActionError('Failed to add alias.');
      }
    } finally {
      setSavingAlias(false);
    }
  }
  async function handleRemoveAlias(aliasId: string): Promise<void> {
    if (!selectedEntity) return;
    setRemovingAliasId(aliasId);
    setActionError(null);
    try {
      const { alias } = await apiFetch<{
        alias: EntityAlias;
      }>(`/entities/${selectedEntity.id}/aliases/${aliasId}`, {
        method: 'DELETE',
      });
      setAliases((current) => current.filter((entry) => entry.id !== alias.id));
    } catch {
      setActionError('Failed to remove alias.');
    } finally {
      setRemovingAliasId(null);
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

          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Aliases</h3>
                <p className="text-text-secondary/70 text-sm font-body mt-1">
                  Lookup aliases saved for this entity, including seeded, inferred, and manual entries.
                </p>
              </div>
              <div className="text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                {aliases.length} alias{aliases.length !== 1 ? 'es' : ''}
              </div>
            </div>
            <div className="p-4 space-y-3">
              {isAdmin && (
                <form onSubmit={handleAddAlias} className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={aliasDraft}
                    onChange={(e) => setAliasDraft(e.target.value)}
                    placeholder="Add alias"
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
                  />
                  <button
                    type="submit"
                    disabled={savingAlias}
                    className="px-3 py-2 rounded-lg bg-accent text-background text-sm font-mono uppercase tracking-wide disabled:opacity-50"
                  >
                    {savingAlias ? 'Saving...' : 'Add Alias'}
                  </button>
                </form>
              )}

              {detailsLoading ? (
                <div className="text-text-secondary text-sm font-body">Loading aliases...</div>
              ) : aliases.length === 0 ? (
                <EmptyState title="No aliases saved" description="This entity only has its canonical name right now." />
              ) : (
                <div
                  className="divide-y divide-border rounded-lg border border-border bg-background"
                  aria-label="Entity aliases"
                >
                  {aliases.map((alias) => (
                    <div key={alias.id} className="px-3 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-text-primary text-sm font-body break-all">{alias.alias}</div>
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${ENTITY_ALIAS_ORIGIN_STYLES[alias.origin]}`}
                          >
                            {formatEntityAliasOrigin(alias.origin)}
                          </span>
                          <span className="text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                            Created {formatDateLabel(alias.createdAt)}
                          </span>
                        </div>
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleRemoveAlias(alias.id)}
                          disabled={removingAliasId === alias.id}
                          aria-label={`Delete alias ${alias.alias}`}
                          className="shrink-0 h-8 w-8 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-surface-raised disabled:opacity-50"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
                          const diffHours = (last.firstMentionTime - first.firstMentionTime) / 3600000;
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
                            className={`w-full text-left px-4 py-4 transition-colors ${isSelected ? 'bg-accent/10' : 'hover:bg-surface-raised'}`}
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
