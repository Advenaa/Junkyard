import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../components/AuthProvider';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';

type Tab = 'sources' | 'delivery' | 'pipeline' | 'users';

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
}

interface PipelineStatus {
  itemsReady: number;
  itemsProcessing: number;
  summariesToday: number;
  costToday: number;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  checks: Record<string, unknown>;
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
  status: 'idle' | 'connecting' | 'connected' | 'backoff' | 'disabled';
  errorCount: number;
  connectedAt: number | null;
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

async function fetchEntitySuggestionsData(query: string): Promise<EntitySuggestion[]> {
  const res = await apiFetch<{ entities: EntitySuggestion[] }>(
    `/entities/search?q=${encodeURIComponent(query)}&limit=6`,
  );
  return res.entities;
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

function formatCalendarRecurrence(recurrenceRule: CalendarEvent['recurrenceRule']): string {
  if (recurrenceRule == null) return 'One-time';
  return CALENDAR_RECURRENCE_RULES.find((rule) => rule.value === recurrenceRule)?.label ?? recurrenceRule;
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
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
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
                    ? 'Username or list'
                    : 'Source identifier'
            }
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
          />
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
                      <span className="ml-2 text-text-secondary/60">
                        {s.pollInterval >= 3600
                          ? `${Math.floor(s.pollInterval / 3600)}h`
                          : `${Math.floor(s.pollInterval / 60)}m`}
                      </span>
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
                      <StatusBadge status={s.stateStatus ?? 'unknown'} />
                      {(s.lastError || s.stateStatus === 'halted') && (
                        <p className="text-accent-red text-xs mt-1 font-body">
                          {s.lastError || 'Source halted — check server logs for details'}
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
              <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Gateway Health</h3>
              <p className="text-text-secondary/70 text-sm font-body">
                Live runtime connection states. These include both env-managed and DB-managed tokens.
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
              <p className="text-text-secondary text-sm font-body">No active gateway connections.</p>
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
                    <span className="text-text-secondary">Connected</span>
                    <span className="text-text-primary">{formatRelativeTime(state.connectedAt)}</span>
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
    } catch {
      setTestResult('Failed to send test payload. Check the URL and try again.');
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
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
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
    apiFetch<PipelineStatus>('/status')
      .then(setStatus)
      .catch(() => setError('Failed to load pipeline status.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/v1/health')
      .then((r) => r.json())
      .then((data: HealthResponse) => setHealth(data))
      .catch(() => {
        /* health is best-effort */
      });
  }, []);

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

  if (loading) return <div className="text-text-secondary font-body py-8">Loading...</div>;
  if (!status)
    return <p className="text-red-400 text-sm font-body py-4">{error ?? 'Failed to load pipeline status.'}</p>;

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
            {Object.entries(health.checks).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between px-4 py-3">
                <span className="text-text-primary text-sm font-body">{key}</span>
                <span className="text-text-secondary text-sm font-mono">{String(value)}</span>
              </div>
            ))}
          </div>
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
      </div>

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
      {activeTab === 'users' && isAdmin && <UsersTab />}
    </div>
  );
}
