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
  SourceActivityBucket,
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
  fetchSourceActivity,
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

export default function SourcesTab() {
  const [sources, setSources] = useState<Source[]>([]);
  const [activityMap, setActivityMap] = useState<Record<string, SourceActivityBucket[]>>({});
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
  const [twitterApiKeyConfigured, setTwitterApiKeyConfigured] = useState<boolean | null>(null);
  const [guilds, setGuilds] = useState<
    Array<{
      id: string;
      name: string;
      icon: string | null;
    }>
  >([]);
  const [channels, setChannels] = useState<
    Array<{
      id: string;
      name: string;
      type: number;
      position: number;
      parentId: string | null;
    }>
  >([]);
  const [selectedGuild, setSelectedGuild] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'halted' | 'silent' | 'disabled'>('all');

  const now = Date.now();
  const sourceStatuses = sources.map((s) => {
    if (s.stateStatus === 'halted') return 'halted' as const;
    if (s.stateStatus === 'disabled' || s.enabled === false) return 'disabled' as const;
    if (s.lastFetchedAt != null && s.pollInterval > 0 && now - s.lastFetchedAt > s.pollInterval * 2 * 1000) {
      return 'silent' as const;
    }
    return 'active' as const;
  });

  const statusCounts = { active: 0, halted: 0, silent: 0, disabled: 0 };
  for (const st of sourceStatuses) statusCounts[st]++;

  const filteredSources = sources.filter((_, i) => statusFilter === 'all' || sourceStatuses[i] === statusFilter);

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
    if (sources.length === 0) return;

    let cancelled = false;
    Promise.all(
      sources.map(async (s) => {
        try {
          const buckets = await fetchSourceActivity(s.source, s.sourceId);
          return { key: `${s.source}-${s.sourceId}`, buckets };
        } catch {
          return { key: `${s.source}-${s.sourceId}`, buckets: [] };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, SourceActivityBucket[]> = {};
      for (const r of results) map[r.key] = r.buckets;
      setActivityMap(map);
    });

    return () => {
      cancelled = true;
    };
  }, [sources]);

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
    }, 15000);
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
      const res = await apiFetch<{
        guilds: Array<{
          id: string;
          name: string;
          icon: string | null;
        }>;
      }>('/discord/guilds');
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
        channels: Array<{
          id: string;
          name: string;
          type: number;
          position: number;
          parentId: string | null;
        }>;
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
      if (isApiError(err) && err.status === 409) {
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
      if (isApiError(err) && err.status === 400) {
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
      if (isApiError(err) && err.status === 409) {
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

        {addSource === 'twitter' && twitterApiKeyConfigured === false && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 text-yellow-400 text-sm font-body">
            Twitter API key (TWITTERAPI_KEY) is not configured in .env. Twitter sources will not poll until a key is
            set.
          </div>
        )}

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

                {browseLoading && (
                  <div className="px-4 py-6 text-center text-text-secondary text-sm font-body">Loading...</div>
                )}

                {browseError && !browseLoading && (
                  <div className="px-4 py-4 text-red-400 text-sm font-body">{browseError}</div>
                )}

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
  const renderSparkline = (buckets: SourceActivityBucket[]) => {
    const hours: number[] = [];
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const h = new Date(now);
      h.setMinutes(0, 0, 0);
      h.setHours(h.getHours() - i);
      const key = h.toISOString().replace(/:\d{2}\.\d{3}Z$/, ':00Z');
      const bucket = buckets.find((b) => b.hour === key);
      hours.push(bucket?.itemCount ?? 0);
    }
    const max = Math.max(...hours, 1);
    return (
      <div className="flex items-end gap-px h-4" title="24h ingestion activity">
        {hours.map((count, i) => (
          <div
            key={i}
            className={`w-1 rounded-sm ${count > 0 ? 'bg-accent-green' : 'bg-border/50'}`}
            style={{ height: `${Math.max((count / max) * 100, count > 0 ? 15 : 5)}%` }}
            title={`${count} item${count !== 1 ? 's' : ''}`}
          />
        ))}
      </div>
    );
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
      {sources.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {(
            [
              {
                key: 'all',
                label: 'All',
                count: sources.length,
                color: 'bg-text-secondary/20 text-text-secondary',
              },
              {
                key: 'active',
                label: 'Active',
                count: statusCounts.active,
                color: 'bg-accent-green/15 text-accent-green',
              },
              {
                key: 'halted',
                label: 'Halted',
                count: statusCounts.halted,
                color: 'bg-accent-red/15 text-accent-red',
              },
              {
                key: 'silent',
                label: 'Silent',
                count: statusCounts.silent,
                color: 'bg-yellow-500/15 text-yellow-400',
              },
              {
                key: 'disabled',
                label: 'Disabled',
                count: statusCounts.disabled,
                color: 'bg-border/50 text-text-secondary',
              },
            ] as const
          ).map(({ key, label, count, color }) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono uppercase tracking-wider transition-colors ${
                statusFilter === key
                  ? `${color} ring-1 ring-current`
                  : 'text-text-secondary/60 hover:text-text-secondary'
              }`}
            >
              {label} <span className="ml-1 tabular-nums">{count}</span>
            </button>
          ))}
        </div>
      )}
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
        ) : filteredSources.length === 0 ? (
          <div className="text-center py-8 px-6">
            <p className="text-text-secondary text-sm">No sources match the selected filter.</p>
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
                <th className="text-left px-4 py-3">Activity</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSources.map((s) => {
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
                          className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${s.sourceId.startsWith('@') ? 'bg-accent/15 text-accent' : 'bg-yellow-500/15 text-yellow-400'}`}
                        >
                          {s.sourceId.startsWith('@') ? '@handle' : 'search'}
                        </span>
                      )}
                      {s.source === 'discord' &&
                        (() => {
                          const discordTokensForSource = tokenHealth.filter(
                            (th) => th.channelCount > 0 && th.status === 'active',
                          );
                          const healthyCount = discordTokensForSource.length;
                          return healthyCount > 0 ? (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide bg-accent-green/15 text-accent-green">
                              {healthyCount} token{healthyCount !== 1 ? 's' : ''} ok
                            </span>
                          ) : tokenHealth.length > 0 ? (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide bg-accent-red/15 text-accent-red">
                              no healthy tokens
                            </span>
                          ) : null;
                        })()}
                      {s.source === 'rss' && getSourceDisplayName(s) !== s.sourceId && (
                        <span
                          className="ml-1.5 text-[10px] font-mono text-text-secondary/50 truncate max-w-[180px] inline-block align-bottom"
                          title={s.sourceId}
                        >
                          {s.sourceId}
                        </span>
                      )}
                      {s.source === 'news' && (
                        <span
                          className="ml-1.5 text-[10px] font-mono text-text-secondary/50 truncate max-w-[180px] inline-block align-bottom"
                          title={s.sourceId}
                        >
                          {(() => {
                            try {
                              return new URL(s.sourceId).hostname;
                            } catch {
                              return s.sourceId;
                            }
                          })()}
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
                    <td className="px-4 py-3">{renderSparkline(activityMap[`${s.source}-${s.sourceId}`] ?? [])}</td>
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
                          className={`relative w-10 h-5 rounded-full transition-colors ${isActive ? 'bg-accent-green' : s.stateStatus === 'halted' ? 'bg-accent-red/50' : 'bg-border'} disabled:cursor-not-allowed`}
                          title={
                            s.stateStatus === 'halted' ? 'Source is halted — fix the underlying issue first' : undefined
                          }
                        >
                          <span
                            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isActive ? 'left-5' : 'left-0.5'}`}
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
                            className={`relative w-10 h-5 rounded-full transition-colors ${isActive ? 'bg-accent-green' : 'bg-border'}`}
                            title={isActive ? 'Disable token' : 'Enable token'}
                          >
                            <span
                              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isActive ? 'left-5' : 'left-0.5'}`}
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
