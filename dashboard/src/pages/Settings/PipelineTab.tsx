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
  SchedulerDiagnostics,
  FeedbackItem,
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
  fetchDiagCostSpikes,
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
  fetchSchedulerDiagnostics,
  fetchFeedbackList,
  revokeUserSession,
  updateFeedbackStatus,
  type DiagCostSpikes,
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

const costSpikeTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default function PipelineTab() {
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
  const [diagCostSpikes, setDiagCostSpikes] = useState<DiagCostSpikes | null>(null);
  const [diagCostSpikesLoading, setDiagCostSpikesLoading] = useState(false);
  const [schedulerDiag, setSchedulerDiag] = useState<SchedulerDiagnostics | null>(null);
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[] | null>(null);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState<'all' | 'pending' | 'dismissed' | 'acknowledged'>(
    'all',
  );
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackActionId, setFeedbackActionId] = useState<string | null>(null);
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
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!isAdmin || !diagExpanded) return;
    let cancelled = false;
    setDiagError(null);
    setDiagCostSpikesLoading(true);
    Promise.allSettled([
      fetchDiagBackpressure(),
      fetchDiagStuckItems(),
      fetchDiagHaltedSources(),
      fetchDiagHealthEvents(),
      fetchSchedulerDiagnostics(),
      fetchDiagCostSpikes(),
    ]).then(
      ([
        backpressureResult,
        stuckItemsResult,
        haltedSourcesResult,
        healthEventsResult,
        schedulerResult,
        costSpikesResult,
      ]) => {
        if (cancelled) return;
        setDiagBackpressure(backpressureResult.status === 'fulfilled' ? backpressureResult.value : null);
        setDiagStuckItems(stuckItemsResult.status === 'fulfilled' ? stuckItemsResult.value : null);
        setDiagHaltedSources(haltedSourcesResult.status === 'fulfilled' ? haltedSourcesResult.value : null);
        setDiagHealthEvents(healthEventsResult.status === 'fulfilled' ? healthEventsResult.value : null);
        setSchedulerDiag(schedulerResult.status === 'fulfilled' ? schedulerResult.value : null);
        setDiagCostSpikes(costSpikesResult.status === 'fulfilled' ? costSpikesResult.value : null);
        setDiagCostSpikesLoading(false);
        if (
          backpressureResult.status === 'rejected' ||
          stuckItemsResult.status === 'rejected' ||
          haltedSourcesResult.status === 'rejected' ||
          healthEventsResult.status === 'rejected' ||
          schedulerResult.status === 'rejected' ||
          costSpikesResult.status === 'rejected'
        ) {
          setDiagError('Some diagnostic endpoints could not be loaded.');
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [diagExpanded, isAdmin]);
  useEffect(() => {
    if (!isAdmin || !diagExpanded) return;
    let cancelled = false;
    setFeedbackLoading(true);
    setFeedbackError(null);
    fetchFeedbackList(feedbackStatusFilter === 'all' ? undefined : feedbackStatusFilter)
      .then((data) => {
        if (cancelled) return;
        setFeedbackItems(data.feedback);
        setFeedbackTotal(data.total);
      })
      .catch(() => {
        if (cancelled) return;
        setFeedbackItems(null);
        setFeedbackTotal(0);
        setFeedbackError('Feedback review is unavailable right now.');
      })
      .finally(() => {
        if (!cancelled) setFeedbackLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [diagExpanded, feedbackStatusFilter, isAdmin]);
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetchLlmCostByModel()
      .then((data) => {
        if (cancelled) return;
        setLlmCostByModel(data);
      })
      .catch(() => {});
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
      if (isApiError(err) && err.status === 400) {
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
  async function handleFeedbackAction(feedbackId: string, status: 'dismissed' | 'acknowledged'): Promise<void> {
    setFeedbackActionId(feedbackId);
    setFeedbackError(null);
    try {
      await updateFeedbackStatus(feedbackId, status);
      const data = await fetchFeedbackList(feedbackStatusFilter === 'all' ? undefined : feedbackStatusFilter);
      setFeedbackItems(data.feedback);
      setFeedbackTotal(data.total);
    } catch {
      setFeedbackError('Failed to update feedback status.');
    } finally {
      setFeedbackActionId(null);
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

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h4 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Cost Spikes</h4>
                  {diagCostSpikes && (
                    <div className="flex flex-wrap gap-2 text-xs font-mono">
                      <span className="px-2 py-1 rounded bg-background border border-border text-text-secondary">
                        {diagCostSpikes.spikes.length} spike{diagCostSpikes.spikes.length === 1 ? '' : 's'}
                      </span>
                      <span className="px-2 py-1 rounded bg-background border border-border text-text-secondary">
                        {diagCostSpikes.windowHours}h window
                      </span>
                    </div>
                  )}
                </div>

                {diagCostSpikesLoading ? (
                  <div className="overflow-x-auto rounded-lg border border-border bg-background">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-text-secondary font-mono text-xs uppercase tracking-wider">
                          <th className="text-left px-3 py-2">Model</th>
                          <th className="text-left px-3 py-2">Timestamp</th>
                          <th className="text-left px-3 py-2">Actual</th>
                          <th className="text-left px-3 py-2">Baseline</th>
                          <th className="text-left px-3 py-2">Ratio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[0, 1, 2].map((rowIndex) => (
                          <tr key={rowIndex} className="border-b border-border/70 last:border-b-0">
                            <td className="px-3 py-3">
                              <div className="h-3 w-28 rounded bg-surface animate-pulse" />
                            </td>
                            <td className="px-3 py-3">
                              <div className="h-3 w-36 rounded bg-surface animate-pulse" />
                            </td>
                            <td className="px-3 py-3">
                              <div className="h-3 w-16 rounded bg-surface animate-pulse" />
                            </td>
                            <td className="px-3 py-3">
                              <div className="h-3 w-16 rounded bg-surface animate-pulse" />
                            </td>
                            <td className="px-3 py-3">
                              <div className="h-3 w-14 rounded bg-surface animate-pulse" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : !diagCostSpikes ? (
                  <p className="text-text-secondary text-sm font-body">Cost spike diagnostics unavailable.</p>
                ) : diagCostSpikes.spikes.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-text-secondary font-mono text-xs uppercase tracking-wider">
                          <th className="text-left px-3 py-2">Model</th>
                          <th className="text-left px-3 py-2">Timestamp</th>
                          <th className="text-left px-3 py-2">Actual</th>
                          <th className="text-left px-3 py-2">Baseline</th>
                          <th className="text-left px-3 py-2">Ratio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagCostSpikes.spikes.map((spike) => (
                          <tr
                            key={`${spike.model}:${spike.hourEpochMs}`}
                            className="border-b border-border/70 last:border-b-0"
                          >
                            <td className="px-3 py-2 text-text-primary font-mono text-xs">{spike.model}</td>
                            <td className="px-3 py-2 text-text-secondary text-sm font-body">
                              {costSpikeTimestampFormatter.format(spike.hourEpochMs)}
                            </td>
                            <td className="px-3 py-2 text-text-primary font-mono text-xs">
                              ${spike.actualUsd.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-text-secondary font-mono text-xs">
                              ${spike.baselineUsd.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-text-primary font-mono text-xs">
                              {Number.isFinite(spike.ratio) ? `${spike.ratio.toFixed(1)}×` : '∞'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-text-secondary text-sm font-body">No cost spikes detected</p>
                )}
              </div>

              {schedulerDiag && (
                <div className="bg-surface border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Scheduler Jobs</h3>
                    {schedulerDiag.processTimezone && (
                      <p className="text-text-secondary/60 text-xs font-body mt-1">
                        Process timezone: {schedulerDiag.processTimezone}
                      </p>
                    )}
                  </div>
                  {schedulerDiag.jobs.length === 0 ? (
                    <div className="px-4 py-6 text-text-secondary text-sm font-body text-center">
                      No scheduler jobs registered.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-text-secondary font-mono text-xs uppercase tracking-wider">
                          <th className="text-left px-4 py-2">Job</th>
                          <th className="text-left px-4 py-2">Cron</th>
                          <th className="text-left px-4 py-2">Status</th>
                          <th className="text-left px-4 py-2">Next Run</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schedulerDiag.jobs.map((j) => {
                          const isStuck = j.status === 'running';
                          return (
                            <tr
                              key={j.job}
                              className="border-b border-border last:border-b-0 hover:bg-surface-raised transition-colors"
                            >
                              <td className="px-4 py-2 font-mono text-xs text-text-primary">{j.job}</td>
                              <td className="px-4 py-2 font-mono text-xs text-text-secondary">{j.cron}</td>
                              <td className="px-4 py-2">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${
                                    isStuck
                                      ? 'bg-yellow-500/20 text-yellow-400'
                                      : j.status === 'idle'
                                        ? 'bg-accent-green/20 text-accent-green'
                                        : 'bg-border text-text-secondary'
                                  }`}
                                >
                                  {j.status}
                                </span>
                              </td>
                              <td className="px-4 py-2 font-mono text-xs text-text-secondary">
                                {j.nextRun ? new Date(j.nextRun).toLocaleString() : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h4 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Feedback</h4>
                    <p className="mt-1 text-sm font-body text-text-secondary/70">
                      Review user-submitted flags on summaries and entity associations.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(['all', 'pending', 'dismissed', 'acknowledged'] as const).map((statusOption) => (
                      <button
                        key={statusOption}
                        type="button"
                        onClick={() => setFeedbackStatusFilter(statusOption)}
                        className={`rounded border px-2.5 py-1 text-[11px] font-mono uppercase tracking-wide transition-colors ${
                          feedbackStatusFilter === statusOption
                            ? 'border-accent/40 bg-accent/10 text-accent'
                            : 'border-border bg-background text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {statusOption}
                      </button>
                    ))}
                    <span className="rounded border border-border bg-background px-2.5 py-1 text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                      {feedbackTotal} total
                    </span>
                  </div>
                </div>

                {feedbackError ? <p className="text-red-400 text-sm font-body">{feedbackError}</p> : null}

                {feedbackLoading ? (
                  <p className="text-text-secondary text-sm font-body">Loading feedback...</p>
                ) : !feedbackItems ? null : feedbackItems.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-text-secondary font-mono text-xs uppercase tracking-wider">
                          <th className="px-3 py-2 text-left">Target Type</th>
                          <th className="px-3 py-2 text-left">Target ID</th>
                          <th className="px-3 py-2 text-left">Category</th>
                          <th className="px-3 py-2 text-left">Status</th>
                          <th className="px-3 py-2 text-left">Date</th>
                          <th className="px-3 py-2 text-left">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feedbackItems.map((feedback) => (
                          <tr key={feedback.id} className="border-b border-border/70 last:border-b-0 align-top">
                            <td className="px-3 py-2 text-text-primary font-body">{feedback.targetType}</td>
                            <td className="px-3 py-2 font-mono text-xs text-text-secondary">{feedback.targetId}</td>
                            <td className="px-3 py-2 text-text-secondary font-body">
                              {feedback.category.replace(/_/g, ' ')}
                              {feedback.note ? (
                                <div className="mt-1 text-xs text-text-secondary/70">{feedback.note}</div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-text-secondary">{feedback.status}</td>
                            <td className="px-3 py-2 text-text-secondary">
                              <div className="text-sm font-body">{formatDateLabel(feedback.createdAt)}</div>
                              <div className="text-xs font-mono">{formatRelativeTime(feedback.createdAt)}</div>
                            </td>
                            <td className="px-3 py-2">
                              {feedback.status === 'pending' ? (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    type="button"
                                    onClick={() => void handleFeedbackAction(feedback.id, 'dismissed')}
                                    disabled={feedbackActionId === feedback.id}
                                    className="rounded border border-border bg-background px-2.5 py-1 text-[11px] font-mono uppercase tracking-wide text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
                                  >
                                    Dismiss
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleFeedbackAction(feedback.id, 'acknowledged')}
                                    disabled={feedbackActionId === feedback.id}
                                    className="rounded border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-wide text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
                                  >
                                    Acknowledge
                                  </button>
                                </div>
                              ) : (
                                <span className="font-mono text-xs text-text-secondary">No actions</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-text-secondary text-sm font-body">No feedback matches the current filter.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

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
