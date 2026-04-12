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

export default function DeliveryTab() {
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
    apiFetch<{
      digestTime?: string;
      timezone?: string;
      webhookUrl?: string;
      apiKey?: string;
    }>('/config')
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

      <ApiAccessSection apiKey={config.apiKey} />
    </div>
  );
}

function ApiAccessSection({ apiKey }: { apiKey: string | null }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const maskedKey = apiKey ? `${'*'.repeat(Math.max(0, apiKey.length - 4))}${apiKey.slice(-4)}` : null;

  const copyKey = async () => {
    if (!apiKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
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
      {apiKey ? (
        <div className="space-y-2">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">API Key</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-background border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary select-all overflow-x-auto">
              {revealed ? apiKey : maskedKey}
            </code>
            <button
              onClick={() => setRevealed((revealedValue) => !revealedValue)}
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
      <div className="space-y-2">
        <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Authorization Header</label>
        <code className="block bg-background border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary">
          Authorization: Bearer {'<your-api-key>'}
        </code>
      </div>
      <div className="space-y-2">
        <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Endpoints</label>
        <div className="bg-background border border-border rounded-lg overflow-hidden">
          {endpoints.map((endpoint) => (
            <div
              key={`${endpoint.method}-${endpoint.path}`}
              className="flex items-center gap-3 px-4 py-2 border-b border-border last:border-b-0"
            >
              <span
                className={`font-mono text-xs font-bold w-10 shrink-0 ${endpoint.method === 'GET' ? 'text-accent-green' : 'text-accent'}`}
              >
                {endpoint.method}
              </span>
              <code className="font-mono text-xs text-text-primary">{endpoint.path}</code>
              <span className="text-text-secondary text-xs font-body ml-auto shrink-0">{endpoint.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
