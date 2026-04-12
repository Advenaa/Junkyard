import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../lib/api.js';
import { Sparkline } from '../components/Sparkline.js';
import { SentimentIndicator } from '../components/SentimentIndicator.js';
import { EntityLink } from '../components/EntityLink.js';
import { CollapsibleSection } from '../components/CollapsibleSection.js';
import { LoadingSkeleton } from '../components/LoadingSkeleton.js';

interface StatusData {
  itemsReady: number;
  itemsProcessing: number;
  summariesToday: number;
  costToday: number;
}

interface HealthData {
  status: 'ok' | 'degraded' | 'error';
  checks: unknown[] | Record<string, unknown>;
}

interface ReportSummary {
  id: string;
  type: string;
  createdAt: number;
  headline?: string;
  tldr?: string;
  macroRegime?:
    | string
    | {
        classification: string;
        confidence: number;
        rationale: string;
      };
  macroConfidence?: number;
  narrativeShifts?: string[];
  keyEvents?: string[];
}

interface PriceWatchEntry {
  entityId: string;
  entityName: string;
  priceUsd: number;
  priceChange24h: number | null;
  priceChange7d?: number | null;
  volume24h?: number | null;
  marketCap?: number | null;
  avgSentiment: number | null;
  momentum?: number | null;
  contrarianSignal?: string | null;
}

interface FirstMoverEntry {
  entityId: string;
  entityName: string;
  handle: string;
  displayName: string | null;
  platform: string;
  timestamp: number;
}

interface AlphaWatchEntry {
  entityId: string;
  entityName: string;
  firstSignalTier: string;
  latestTier: string;
  tierCount: number;
  sourceCount: number;
  propagationLagMs: number | null;
}

interface UnusualActivityEntry {
  entityId: string;
  entityName: string;
  mentionCount: number;
  spikeRatio: number | null;
  avgSentiment: number | null;
}

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function useFetch<T>(path: string): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: true,
    error: false,
  });

  useEffect(() => {
    let cancelled = false;

    apiFetch<T>(path)
      .then((res) => {
        if (!cancelled) {
          setState({
            data: res,
            loading: false,
            error: false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: true,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}

function timeAgo(epochMs: number): string {
  const seconds = Math.floor((Date.now() - epochMs) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

function formatConfidence(value?: number): string | null {
  if (value == null || Number.isNaN(value)) {
    return null;
  }

  const percent = value <= 1 ? value * 100 : value;
  return `${Math.round(Math.min(100, Math.max(0, percent)))}% confidence`;
}

function extractRegimeString(regime: ReportSummary['macroRegime']): string | undefined {
  if (!regime) return undefined;
  if (typeof regime === 'string') return regime;
  return regime.classification;
}

function formatMacroRegime(regime?: string): string {
  if (!regime) {
    return 'Unclear';
  }

  switch (regime.toLowerCase()) {
    case 'risk-on':
      return 'Risk-on';
    case 'risk-off':
      return 'Risk-off';
    case 'transition':
      return 'Transition';
    default:
      return regime;
  }
}

function macroRegimeClass(regime?: string): string {
  switch (regime?.toLowerCase()) {
    case 'risk-on':
      return 'bg-accent-green/15 text-accent-green';
    case 'risk-off':
      return 'bg-accent-red/15 text-accent-red';
    case 'transition':
      return 'bg-[#c68a2b]/15 text-[#f2c66d]';
    default:
      return 'bg-surface-raised text-text-secondary';
  }
}

function changeBadgeClass(change24h: number | null | undefined): string {
  if (change24h == null || Number.isNaN(change24h)) {
    return 'bg-surface-raised text-text-secondary';
  }

  if (change24h > 0) {
    return 'bg-accent-green/15 text-accent-green';
  }

  if (change24h < 0) {
    return 'bg-accent-red/15 text-accent-red';
  }

  return 'bg-surface-raised text-text-secondary';
}

function formatChange(change24h: number | null | undefined): string {
  if (change24h == null || Number.isNaN(change24h)) {
    return '—';
  }

  return `${change24h > 0 ? '+' : ''}${change24h.toFixed(1)}%`;
}

function healthDotClass(status: HealthData['status']): string {
  switch (status) {
    case 'ok':
      return 'bg-accent-green';
    case 'degraded':
      return 'bg-[#f2c66d]';
    case 'error':
      return 'bg-accent-red';
  }
}

function truncateText(value: string, max = 120): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1)}…`;
}

function unusualActivityDescription(entry: UnusualActivityEntry): string {
  if (entry.spikeRatio == null || Number.isNaN(entry.spikeRatio)) {
    return `${entry.mentionCount} mentions`;
  }

  return `${entry.mentionCount} mentions (${entry.spikeRatio.toFixed(1)}× spike)`;
}

function sentimentPreviousValue(entry: PriceWatchEntry): number | undefined {
  if (entry.avgSentiment == null || entry.momentum == null || Number.isNaN(entry.momentum)) {
    return undefined;
  }

  return entry.avgSentiment - entry.momentum;
}

export function Dashboard() {
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);

  const status = useFetch<StatusData>('/status');
  const health = useFetch<HealthData>('/health');
  const reports = useFetch<{ reports: ReportSummary[] }>('/reports?limit=1');
  const priceWatch = useFetch<{ entries: PriceWatchEntry[] }>('/price-watch');
  const firstMovers = useFetch<{ entries: FirstMoverEntry[] }>('/first-movers?limit=6');
  const alphaWatch = useFetch<{ entries: AlphaWatchEntry[] }>('/alpha-watch?limit=6');
  const unusual = useFetch<{ entries: UnusualActivityEntry[] }>('/unusual-activity');

  const report = reports.data?.reports[0] ?? null;
  const macroRegime = extractRegimeString(report?.macroRegime);
  const macroConfidence =
    report?.macroConfidence ??
    (report?.macroRegime != null && typeof report.macroRegime !== 'string' ? report.macroRegime.confidence : undefined);
  const changes = [...(report?.keyEvents ?? []), ...(report?.narrativeShifts ?? [])];
  const showAllChanges = report != null && expandedReportId === report.id;
  const visibleChanges = showAllChanges ? changes : changes.slice(0, 3);
  const hiddenChangeCount = Math.max(0, changes.length - visibleChanges.length);

  return (
    <div className="p-6 space-y-6">
      <section>
        {status.loading || health.loading ? (
          <LoadingSkeleton variant="text" className="h-6 w-72" />
        ) : status.error || health.error || !status.data || !health.data ? (
          <p className="text-sm text-accent-red">Failed to load</p>
        ) : (
          <div className="flex items-center gap-4 text-xs font-mono text-text-secondary">
            <span className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${healthDotClass(health.data.status)}`}
                aria-label={`System health: ${health.data.status}`}
                title={`System health: ${health.data.status}`}
              />
              health
            </span>
            <span>{formatCurrency(status.data.costToday)}</span>
            <span>{status.data.itemsReady + status.data.itemsProcessing} items</span>
            <span>{status.data.summariesToday} summaries</span>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        {reports.loading ? (
          <LoadingSkeleton variant="card" />
        ) : reports.error ? (
          <p className="text-sm text-accent-red">Failed to load</p>
        ) : report ? (
          <div className="space-y-4">
            <blockquote className="border-l-4 border-accent pl-4 italic text-lg text-text-primary">
              {report.tldr ?? 'No thesis available yet.'}
            </blockquote>
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${macroRegimeClass(macroRegime)}`}
              >
                {formatMacroRegime(macroRegime)}
              </span>
              {formatConfidence(macroConfidence) ? (
                <span className="text-sm font-mono text-text-secondary">{formatConfidence(macroConfidence)}</span>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium text-text-primary">Report not found</p>
            <p className="text-sm text-text-secondary">No report available yet.</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        {reports.loading ? (
          <LoadingSkeleton variant="card" />
        ) : reports.error ? (
          <p className="text-sm text-accent-red">Failed to load</p>
        ) : report ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-lg text-text-primary">What Changed</h2>
              {hiddenChangeCount > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedReportId((current) =>
                      report != null && current === report.id ? null : (report?.id ?? null),
                    )
                  }
                  className="text-sm font-mono text-accent hover:underline"
                >
                  {showAllChanges ? 'Show less' : `+${hiddenChangeCount} more`}
                </button>
              ) : null}
            </div>
            {changes.length > 0 ? (
              <ul className="space-y-2 text-sm text-text-secondary">
                {visibleChanges.map((item, index) => (
                  <li key={`${item}-${index}`} className="list-disc ml-4">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-secondary">No major changes called out in the latest report.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">No report available yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg text-text-primary">Price Watch</h2>
          <span className="text-xs font-mono text-text-secondary">Top 8 movers</span>
        </div>
        {priceWatch.loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <LoadingSkeleton variant="card" />
            <LoadingSkeleton variant="card" />
            <LoadingSkeleton variant="card" />
          </div>
        ) : priceWatch.error ? (
          <p className="text-sm text-accent-red">Failed to load</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {(priceWatch.data?.entries ?? []).slice(0, 8).map((entry) => (
              <article key={entry.entityId} className="rounded-xl border border-border bg-surface p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-base font-medium text-text-primary">
                      <EntityLink entityId={entry.entityId} name={entry.entityName} />
                    </div>
                    <div className="font-mono text-lg text-text-primary">{formatCurrency(entry.priceUsd)}</div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-mono ${changeBadgeClass(entry.priceChange24h)}`}
                  >
                    {formatChange(entry.priceChange24h)}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <Sparkline
                    variant="line"
                    data={[]}
                    width={240}
                    height={52}
                    color={
                      entry.priceChange24h != null && entry.priceChange24h < 0
                        ? 'var(--color-accent-red)'
                        : 'var(--color-accent-green)'
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-mono uppercase tracking-wide text-text-secondary">Sentiment</span>
                  <SentimentIndicator value={entry.avgSentiment ?? 0} previous={sentimentPreviousValue(entry)} />
                </div>
              </article>
            ))}
            {(priceWatch.data?.entries ?? []).length === 0 ? (
              <p className="text-sm text-text-secondary">No movers available yet.</p>
            ) : null}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg text-text-primary">Signals</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <CollapsibleSection title="First Movers" defaultOpen storageKey="dashboard-first-movers">
            {firstMovers.loading ? (
              <LoadingSkeleton variant="card" />
            ) : firstMovers.error ? (
              <p className="text-sm text-accent-red">Failed to load</p>
            ) : (firstMovers.data?.entries.length ?? 0) > 0 ? (
              <div className="space-y-3">
                {(firstMovers.data?.entries ?? []).slice(0, 3).map((entry) => (
                  <article
                    key={`${entry.entityId}-${entry.timestamp}`}
                    className="space-y-2 border-b border-border pb-3 last:border-b-0 last:pb-0"
                  >
                    <div className="text-sm font-medium text-text-primary">
                      <EntityLink entityId={entry.entityId} name={entry.entityName} />
                    </div>
                    <div className="text-sm text-text-secondary">{entry.displayName ?? entry.handle}</div>
                    <div className="flex items-center gap-2 text-xs font-mono text-text-secondary">
                      <span className="rounded-full bg-surface-raised px-2 py-0.5">{entry.platform}</span>
                      <span>{timeAgo(entry.timestamp)}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">No first movers detected yet.</p>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Alpha Watch" defaultOpen storageKey="dashboard-alpha-watch">
            {alphaWatch.loading ? (
              <LoadingSkeleton variant="card" />
            ) : alphaWatch.error ? (
              <p className="text-sm text-accent-red">Failed to load</p>
            ) : (alphaWatch.data?.entries.length ?? 0) > 0 ? (
              <div className="space-y-3">
                {(alphaWatch.data?.entries ?? []).slice(0, 3).map((entry) => (
                  <article
                    key={`${entry.entityId}-${entry.latestTier}`}
                    className="space-y-2 border-b border-border pb-3 last:border-b-0 last:pb-0"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-text-primary">
                        <EntityLink entityId={entry.entityId} name={entry.entityName} />
                      </div>
                      <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs font-mono text-text-secondary">
                        {entry.latestTier}
                      </span>
                    </div>
                    <p className="text-sm text-text-secondary">{`${entry.tierCount} tiers across ${entry.sourceCount} sources`}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">No alpha watch entries yet.</p>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Unusual Activity" defaultOpen storageKey="dashboard-unusual-activity">
            {unusual.loading ? (
              <LoadingSkeleton variant="card" />
            ) : unusual.error ? (
              <p className="text-sm text-accent-red">Failed to load</p>
            ) : (unusual.data?.entries.length ?? 0) > 0 ? (
              <div className="space-y-3">
                {(unusual.data?.entries ?? []).slice(0, 3).map((entry) => (
                  <article
                    key={`${entry.entityId}-${entry.mentionCount}-${entry.spikeRatio ?? 'none'}`}
                    className="space-y-2 border-b border-border pb-3 last:border-b-0 last:pb-0"
                  >
                    <div className="text-sm font-medium text-text-primary">
                      <EntityLink entityId={entry.entityId} name={entry.entityName} />
                    </div>
                    <p className="text-sm text-text-secondary">{truncateText(unusualActivityDescription(entry))}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">No unusual activity detected yet.</p>
            )}
          </CollapsibleSection>
        </div>
      </section>

      <section>
        {reports.loading ? (
          <LoadingSkeleton variant="text" className="h-5 w-40" />
        ) : reports.error ? (
          <p className="text-sm text-accent-red">Failed to load</p>
        ) : report ? (
          <Link to={`/reports/${report.id}`} className="text-accent hover:underline font-mono text-sm">
            Read full report →
          </Link>
        ) : (
          <p className="text-sm text-text-secondary">No report available yet.</p>
        )}
      </section>
    </div>
  );
}
