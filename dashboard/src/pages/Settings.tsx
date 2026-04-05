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
  label: string;
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

interface Config {
  webhookUrl: string | null;
  digestTime: string | null;
  timezone: string | null;
  publicUrl: string | null;
}

interface UserRecord {
  discordId: string;
  username: string;
  avatar: string | null;
  role: 'admin' | 'viewer' | 'blocked';
  createdAt: number;
  lastLoginAt: number | null;
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

/* ── Sources Tab ── */

function SourcesTab() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [addSource, setAddSource] = useState('discord');
  const [addSourceId, setAddSourceId] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    apiFetch<{ sources: Source[] }>('/sources')
      .then((res) => setSources(res.sources))
      .catch(() => setError('Failed to load sources.'))
      .finally(() => setLoading(false));
  }, []);

  const openModal = () => {
    setAddSource('discord');
    setAddSourceId('');
    setAddLabel('');
    setAddError(null);
    setModalOpen(true);
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      const created = await apiFetch<Source>('/sources', {
        method: 'POST',
        body: JSON.stringify({ source: addSource, sourceId: addSourceId, label: addLabel || undefined }),
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

  const toggleSource = async (s: Source) => {
    setError(null);
    const isActive = s.stateStatus == null || s.stateStatus === 'active';
    try {
      await apiFetch(`/sources/${s.source}/${s.sourceId}`, {
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
    } catch {
      setError(`Failed to toggle source "${s.label}".`);
    }
  };

  const deleteSource = async (s: Source) => {
    if (!window.confirm(`Delete source "${s.label}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await apiFetch(`/sources/${s.source}/${s.sourceId}`, { method: 'DELETE' });
      setSources((prev) => prev.filter((src) => !(src.source === s.source && src.sourceId === s.sourceId)));
    } catch {
      setError(`Failed to delete source "${s.label}".`);
    }
  };

  const addSourceButton = (
    <button
      onClick={openModal}
      className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity"
    >
      Add Source
    </button>
  );

  const addSourceModal = (
    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Source">
      <form onSubmit={handleAddSource} className="space-y-4">
        {addError && <p className="text-red-400 text-sm font-body">{addError}</p>}
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">
            Source Type
          </label>
          <select
            value={addSource}
            onChange={(e) => setAddSource(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
          >
            <option value="discord">discord</option>
            <option value="twitter">twitter</option>
            <option value="rss">rss</option>
            <option value="news">news</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">
            Source ID
          </label>
          <input
            type="text"
            required
            value={addSourceId}
            onChange={(e) => setAddSourceId(e.target.value)}
            placeholder={
              addSource === 'rss' ? 'https://example.com/feed.xml' :
              addSource === 'discord' ? 'Channel ID' :
              addSource === 'twitter' ? 'Username or list' :
              'Source identifier'
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

  if (loading) return <div className="text-text-secondary font-body py-8">Loading...</div>;

  if (sources.length === 0 && error) {
    return <p className="text-red-400 text-sm font-body py-4">{error}</p>;
  }

  if (sources.length === 0) {
    return (
      <>
        {addSourceModal}
        <div className="text-center py-16">
          <p className="text-text-secondary text-lg">No sources configured</p>
          <p className="text-text-secondary/60 mt-2 text-sm">Add your first source to start collecting market intelligence.</p>
          <div className="mt-6">{addSourceButton}</div>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-2">
      {addSourceModal}
      <div className="flex items-center justify-between">
        {error ? <p className="text-red-400 text-sm font-body">{error}</p> : <span />}
        {addSourceButton}
      </div>
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
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
                  <td className="px-4 py-3 font-mono text-xs text-text-secondary">{s.source}</td>
                  <td className="px-4 py-3 text-text-primary font-body">{s.label}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.stateStatus ?? 'unknown'} />
                    {s.lastError && (
                      <p className="text-accent-red text-xs mt-1 font-body">{s.lastError}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                    {formatRelativeTime(s.lastFetchedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => deleteSource(s)}
                        className="text-accent-red/70 hover:text-accent-red text-xs font-mono transition-colors"
                        title={`Delete ${s.label}`}
                      >
                        &times;
                      </button>
                      <button
                        onClick={() => toggleSource(s)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${
                          isActive ? 'bg-accent-green' : 'bg-border'
                        }`}
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
    apiFetch<{ digestTime?: string; timezone?: string; webhookUrl?: string }>('/config').then((res) => {
      const mapped: Config = {
        webhookUrl: res.webhookUrl ?? '',
        digestTime: res.digestTime ?? '09:00',
        timezone: res.timezone ?? 'Asia/Jakarta',
        publicUrl: null,
      };
      setConfig(mapped);
      setWebhookUrl(res.webhookUrl ?? '');
      setDigestTime(res.digestTime ?? '09:00');
      setTimezone(res.timezone ?? 'Asia/Jakarta');
    }).catch(() => {
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
        body: JSON.stringify({ webhook_url: webhookUrl, digest_time: digestTime, timezone: timezone }),
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
        <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">
          Digest Time
        </h3>
        <input
          type="time"
          value={digestTime}
          onChange={(e) => setDigestTime(e.target.value)}
          className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
        />
      </div>
      <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
        <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">
          Timezone
        </h3>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
        >
          <option value="Asia/Jakarta">Asia/Jakarta</option>
          <option value="UTC">UTC</option>
          <option value="America/New_York">America/New_York</option>
          <option value="America/Los_Angeles">America/Los_Angeles</option>
          <option value="Europe/London">Europe/London</option>
          <option value="Europe/Berlin">Europe/Berlin</option>
          <option value="Asia/Tokyo">Asia/Tokyo</option>
          <option value="Asia/Singapore">Asia/Singapore</option>
          <option value="Asia/Hong_Kong">Asia/Hong_Kong</option>
          <option value="Australia/Sydney">Australia/Sydney</option>
        </select>
      </div>
      <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
        <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">
          Webhook URL
        </h3>
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
        {testResult && (
          <p className="text-sm text-text-secondary font-body">{testResult}</p>
        )}
      </div>
    </div>
  );
}

/* ── Pipeline Tab ── */

function PipelineTab() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PipelineStatus>('/status')
      .then(setStatus)
      .catch(() => setError('Failed to load pipeline status.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-text-secondary font-body py-8">Loading...</div>;
  if (!status) return <p className="text-red-400 text-sm font-body py-4">{error ?? 'Failed to load pipeline status.'}</p>;

  return (
    <div className="space-y-6">
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
        <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-3">
          LLM Cost
        </h3>
        <p className="text-text-primary text-lg font-mono">
          ${status.costToday.toFixed(2)}{' '}
          <span className="text-text-secondary text-xs">today</span>
        </p>
      </div>
    </div>
  );
}

/* ── Users Tab ── */

function UsersTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ users: UserRecord[] }>('/users')
      .then((res) => setUsers(res.users))
      .catch(() => setError('Failed to load users.'))
      .finally(() => setLoading(false));
  }, []);

  const changeRole = async (discordId: string, role: string) => {
    setError(null);
    try {
      await apiFetch(`/users/${discordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setUsers((prev) =>
        prev.map((u) =>
          u.discordId === discordId ? { ...u, role: role as UserRecord['role'] } : u,
        ),
      );
    } catch {
      setError(`Failed to update role for user.`);
    }
  };

  if (loading) return <div className="text-text-secondary font-body py-8">Loading...</div>;

  if (users.length === 0 && error) {
    return <p className="text-red-400 text-sm font-body py-4">{error}</p>;
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-red-400 text-sm font-body">{error}</p>}
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
                    {u.avatar ? (
                      <img
                        src={`https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png?size=32`}
                        alt=""
                        className="w-8 h-8 rounded-full"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-surface-raised flex items-center justify-center text-text-secondary text-xs font-mono">
                        {u.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="text-text-primary font-body">{u.username}</span>
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
