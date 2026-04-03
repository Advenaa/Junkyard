import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../components/AuthProvider';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';

type Tab = 'sources' | 'delivery' | 'pipeline' | 'users';

interface Source {
  source: string;
  sourceId: string;
  label: string;
  enabled: boolean;
  pollInterval: number;
  lastFetchedAt: string | null;
  errorCount: number;
  lastError: string | null;
  status: string;
}

interface PipelineStatus {
  stages: Record<string, { lastRun: string | null; status: string }>;
  llmCostToday: number;
  allSourcesDisabled: boolean;
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

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
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

  useEffect(() => {
    apiFetch<{ sources: Source[] }>('/sources')
      .then((res) => setSources(res.sources))
      .catch(() => setError('Failed to load sources.'))
      .finally(() => setLoading(false));
  }, []);

  const toggleSource = async (s: Source) => {
    setError(null);
    try {
      await apiFetch(`/sources/${s.source}/${s.sourceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      setSources((prev) =>
        prev.map((src) =>
          src.sourceId === s.sourceId && src.source === s.source
            ? { ...src, enabled: !src.enabled }
            : src,
        ),
      );
    } catch {
      setError(`Failed to toggle source "${s.label}".`);
    }
  };

  if (loading) return <div className="text-text-secondary font-body py-8">Loading...</div>;

  if (sources.length === 0 && error) {
    return <p className="text-red-400 text-sm font-body py-4">{error}</p>;
  }

  if (sources.length === 0) {
    return (
      <EmptyState
        title="No sources configured"
        description="Add your first source to start collecting market intelligence."
      />
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-red-400 text-sm font-body">{error}</p>}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-secondary font-mono text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3">Source</th>
              <th className="text-left px-4 py-3">Label</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Last Fetched</th>
              <th className="text-right px-4 py-3">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr
                key={`${s.source}-${s.sourceId}`}
                className="border-b border-border last:border-b-0 hover:bg-surface-raised transition-colors"
              >
                <td className="px-4 py-3 font-mono text-xs text-text-secondary">{s.source}</td>
                <td className="px-4 py-3 text-text-primary font-body">{s.label}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={s.status} />
                  {s.lastError && (
                    <p className="text-accent-red text-xs mt-1 font-body">{s.lastError}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                  {formatRelativeTime(s.lastFetchedAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => toggleSource(s)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      s.enabled ? 'bg-accent-green' : 'bg-border'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        s.enabled ? 'left-5' : 'left-0.5'
                      }`}
                    />
                  </button>
                </td>
              </tr>
            ))}
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ digest_time?: string; timezone?: string; webhook_url?: string }>('/config').then((res) => {
      const mapped: Config = {
        webhookUrl: res.webhook_url ?? '',
        digestTime: res.digest_time ?? '09:00',
        timezone: res.timezone ?? 'Asia/Jakarta',
        publicUrl: null,
      };
      setConfig(mapped);
      setWebhookUrl(res.webhook_url ?? '');
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
        body: JSON.stringify({ webhook_url: webhookUrl }),
      });
      setConfig((prev) => (prev ? { ...prev, webhookUrl } : prev));
    } catch {
      setError('Failed to save webhook configuration.');
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

  if (!config) return <div className="text-text-secondary font-body py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      {error && <p className="text-red-400 text-sm font-body">{error}</p>}
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
      {/* Pipeline Stages */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary px-4 py-3 border-b border-border">
          Pipeline Status
        </h3>
        <div className="divide-y divide-border">
          {Object.entries(status.stages).map(([name, stage]) => (
            <div key={name} className="flex items-center justify-between px-4 py-3">
              <span className="text-text-primary text-sm font-body capitalize">{name}</span>
              <div className="flex items-center gap-3">
                <span className="text-text-secondary text-xs font-mono">
                  {stage.lastRun ? formatRelativeTime(stage.lastRun) : 'Never'}
                </span>
                <StatusBadge status={stage.status} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cost Summary */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-3">
          LLM Cost
        </h3>
        <p className="text-text-primary text-lg font-mono">
          ${status.llmCostToday.toFixed(2)}{' '}
          <span className="text-text-secondary text-xs">today</span>
        </p>
      </div>

      {/* All Sources Disabled Warning */}
      {status.allSourcesDisabled && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-4">
          <p className="text-accent-red text-sm font-body">
            All sources are currently disabled. The pipeline cannot collect data.
          </p>
        </div>
      )}
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
                  {u.lastLoginAt
                    ? formatRelativeTime(new Date(u.lastLoginAt).toISOString())
                    : 'Never'}
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
