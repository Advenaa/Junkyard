import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router';
import { apiFetch, isFeatureDisabledError } from '../lib/api';
import type { NarrativeSignalStrength, NarrativeWatchlistOverview, Report } from '../lib/types';
import { useStatus } from '../components/StatusProvider';
import { formatDayMonthYear, formatNarrativeSignalLabel } from '../lib/formatting';
import { buildMacroRegimePreviewTitle, formatMacroRegimePreview, macroRegimeToneClasses } from '../lib/macroRegime';
import { getReportSecondaryPreview } from '../lib/reportPreview';
import {
  buildLeadChainHref,
  buildLeadChainLabel,
  buildLeadReportHref,
  getReportChainRefreshAction,
  getReportChainStoryChipLabel,
  getReportChainToggleAction,
} from '../lib/reportChains';
import { useReportPreviewState } from '../lib/useReportPreviewState';
import { ReportChainPreviewSection } from '../components/ReportChainPreviewSection';
import { TypeBadge } from '../components/TypeBadge';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { FeatureDisabledCard } from '../components/FeatureDisabledCard';

type FilterType = 'all' | 'daily' | 'flash' | 'pulse';
const FILTERS: FilterType[] = ['all', 'daily', 'flash', 'pulse'];
const PAGE_SIZE = 20;
const NARRATIVE_PREVIEW_LIMIT = 3;

function narrativeSignalClasses(signalStrength: NarrativeSignalStrength): string {
  switch (signalStrength) {
    case 'new':
      return 'bg-accent/15 text-accent border border-accent/20';
    case 'emerging':
      return 'bg-accent-green/15 text-accent-green border border-accent-green/20';
    case 'strong':
      return 'bg-accent-orange/15 text-accent-orange border border-accent-orange/20';
    case 'stable':
      return 'bg-border text-text-secondary border border-border';
    case 'fading':
      return 'bg-accent-red/15 text-accent-red border border-accent-red/20';
  }
}

function formatNarrativeSentiment(sentiment: number | null): string {
  if (sentiment == null) {
    return 'sentiment n/a';
  }
  return `sentiment ${sentiment > 0 ? '+' : ''}${sentiment.toFixed(2)}`;
}

export function ReportList() {
  const { ready: statusReady, isFeatureDisabled, getDisabledFeature, registerDisabledFeature } = useStatus();
  const embeddingsDisabled = isFeatureDisabled('embeddings');
  const disabledEmbeddings = getDisabledFeature('embeddings');
  const [filter, setFilter] = useState<FilterType>('all');
  const [reports, setReports] = useState<Report[]>([]);
  const [narratives, setNarratives] = useState<NarrativeWatchlistOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const {
    previewBodyOverrides,
    leadChainLabelOverrides,
    leadChainHrefOverrides,
    focusedReportHrefOverrides,
    visibleChainCountOverrides,
    storyChipActionOverrides,
    storyChipToggleRequests,
    refreshChipActionOverrides,
    refreshChipRequests,
    updateReportPreviewBody,
    updateLeadChainLabel,
    updateLeadChainHref,
    updateFocusedReportHref,
    updateVisibleChainCount,
    updateStoryChipAction,
    requestStoryChipToggle,
    updateRefreshChipAction,
    requestRefreshChip,
  } = useReportPreviewState();
  const [retryNonce, setRetryNonce] = useState(0);
  const latestReportsRequestRef = useRef(0);

  const fetchReports = useCallback(
    async (offset: number, append: boolean, isCancelled: () => boolean = () => false) => {
      const requestId = append ? latestReportsRequestRef.current : latestReportsRequestRef.current + 1;
      if (!append) {
        latestReportsRequestRef.current = requestId;
      }
      const typeParam = filter !== 'all' ? `&type=${filter}` : '';
      const res = await apiFetch<{ reports: Report[] }>(`/reports?limit=${PAGE_SIZE}&offset=${offset}${typeParam}`);
      if (isCancelled() || requestId !== latestReportsRequestRef.current) {
        return;
      }
      if (append) {
        setReports((prev) => [...prev, ...res.reports]);
      } else {
        setReports(res.reports);
      }
      setHasMore(res.reports.length === PAGE_SIZE);
    },
    [filter],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    fetchReports(0, false, () => cancelled)
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load reports. Please try again.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fetchReports, retryNonce]);

  useEffect(() => {
    if (!statusReady) return;
    if (embeddingsDisabled) {
      setNarratives(null);
      return;
    }
    let cancelled = false;

    apiFetch<NarrativeWatchlistOverview>('/narratives')
      .then((overview) => {
        if (!cancelled) {
          setNarratives(overview);
        }
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
        } else {
          setNarratives(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [statusReady, embeddingsDisabled, registerDisabledFeature]);

  const narrativeEntries = narratives?.entries.slice(0, NARRATIVE_PREVIEW_LIMIT) ?? [];

  const loadMore = async () => {
    const requestId = latestReportsRequestRef.current;
    setLoadingMore(true);
    try {
      await fetchReports(reports.length, true, () => requestId !== latestReportsRequestRef.current);
    } catch {
      if (requestId === latestReportsRequestRef.current) {
        setError('Failed to load more reports. Please try again.');
      }
    } finally {
      if (requestId === latestReportsRequestRef.current) {
        setLoadingMore(false);
      }
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="font-heading text-2xl text-text-primary">Reports</h1>

      {/* Filter Pills */}
      <div className="flex gap-2" role="radiogroup" aria-label="Report type filter">
        {FILTERS.map((f) => (
          <button
            key={f}
            role="radio"
            aria-checked={filter === f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2.5 min-h-[44px] rounded-full font-mono text-xs uppercase tracking-wider transition-colors ${
              filter === f
                ? 'bg-accent text-white'
                : 'bg-surface border border-border text-text-secondary hover:text-text-primary hover:border-[#3a3a4f]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {embeddingsDisabled && disabledEmbeddings ? (
        <FeatureDisabledCard
          feature={disabledEmbeddings}
          title="Narrative Snapshot"
          description="Narrative clustering is currently disabled — embeddings are required to group related summaries."
        />
      ) : null}

      {!embeddingsDisabled && narrativeEntries.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
            <div>
              <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Narrative Snapshot</h2>
              <p className="text-text-secondary/70 text-sm font-body mt-1">
                Latest clustered themes from the daily embedding pass. Detailed evidence remains in Settings &gt;
                Pipeline.
              </p>
            </div>
            <span className="px-2 py-1 rounded bg-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
              {narratives?.latestDate ?? 'latest'}
            </span>
          </div>

          <div className="p-4 grid gap-3 md:grid-cols-3">
            {narrativeEntries.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border bg-background p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-text-primary text-sm font-body leading-snug">{entry.name}</h3>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${narrativeSignalClasses(entry.signalStrength)}`}
                  >
                    {formatNarrativeSignalLabel(entry.signalStrength)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 text-xs font-mono">
                  <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                    {entry.memberCount} summaries
                  </span>
                  <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                    {formatNarrativeSentiment(entry.avgSentiment)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          <p>{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              setRetryNonce((prev) => prev + 1);
            }}
            className="mt-2 text-sm underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Report Cards */}
      {loading ? (
        <div className="text-text-secondary font-body">Loading...</div>
      ) : reports.length === 0 && !error ? (
        <EmptyState
          title="No reports yet"
          description="Your first report will generate after sources are configured and the daily digest runs."
        />
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            const activeChains = report.chainDrilldowns ?? [];
            const hiddenActiveChainCount = report.hiddenActiveChainCount ?? 0;
            const previewBody = previewBodyOverrides[report.id] ?? report.tldr;
            const fallbackLeadChainLabel = buildLeadChainLabel(activeChains[0]);
            const leadChainLabel = leadChainLabelOverrides[report.id] ?? fallbackLeadChainLabel;
            const fallbackLeadChainHref = buildLeadChainHref(activeChains[0]);
            const leadChainHref = leadChainHrefOverrides[report.id] ?? fallbackLeadChainHref;
            const fallbackFocusedReportHref =
              buildLeadReportHref(report.id, activeChains[0]) ?? `/reports/${report.id}`;
            const focusedReportHref = focusedReportHrefOverrides[report.id] ?? fallbackFocusedReportHref;
            const visibleChainCount = visibleChainCountOverrides[report.id] ?? activeChains.length;
            const fallbackStoryChipAction = getReportChainToggleAction({
              previewChainCount: activeChains.length,
              visibleChainCount: activeChains.length,
              hiddenActiveChainCount,
            });
            const storyChipAction = storyChipActionOverrides[report.id] ?? fallbackStoryChipAction;
            const fallbackRefreshChipAction = getReportChainRefreshAction({
              previewChainCount: activeChains.length,
              visibleChainCount: activeChains.length,
              hiddenActiveChainCount,
            });
            const refreshChipAction = refreshChipActionOverrides[report.id] ?? fallbackRefreshChipAction;
            const secondaryPreview = getReportSecondaryPreview({
              activeChainCount: activeChains.length,
              eventChains: report.eventChains,
              firstMovers: report.firstMovers,
              priceAlerts: report.priceAlerts,
              alphaSignals: report.alphaSignals,
              marketCatalysts: report.marketCatalysts,
              regionalDivergence: report.regionalDivergence,
              narrativeShifts: report.narrativeShifts,
              unusualActivity: report.unusualActivity,
              macroAlerts: report.macroAlerts,
            });

            return (
              <div
                key={report.id}
                className="bg-surface border border-border rounded-lg overflow-hidden transition-all duration-[160ms] hover:-translate-y-px hover:shadow-lg hover:border-[#3a3a4f]"
              >
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <TypeBadge type={report.type} />
                      <span className="font-mono text-xs text-text-secondary">{formatDayMonthYear(report.date)}</span>
                      {report.macroRegime && (
                        <span
                          title={buildMacroRegimePreviewTitle(report.macroRegime, report.macroRegimeHistory)}
                          className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${macroRegimeToneClasses(report.macroRegime.classification)}`}
                        >
                          Macro regime · {formatMacroRegimePreview(report.macroRegime, report.macroRegimeHistory)}
                        </span>
                      )}
                      {report.sourceFamilies && report.sourceFamilies.length > 1 && (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
                          Sources · {report.sourceFamilies.join(' + ')}
                        </span>
                      )}
                      {visibleChainCount > 0 &&
                        (storyChipAction.mode === 'none' ? (
                          <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
                            Active stories · {visibleChainCount}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => requestStoryChipToggle(report.id)}
                            disabled={storyChipAction.disabled}
                            title={storyChipAction.controlLabel ?? undefined}
                            className="font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:text-accent hover:underline disabled:opacity-60"
                          >
                            {getReportChainStoryChipLabel(visibleChainCount, storyChipAction)}
                          </button>
                        ))}
                      {leadChainLabel && leadChainHref && (
                        <Link
                          to={leadChainHref}
                          className="font-mono text-[10px] uppercase tracking-wider text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
                        >
                          Lead chain · {leadChainLabel}
                        </Link>
                      )}
                      {leadChainLabel && !leadChainHref && (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
                          Lead chain · {leadChainLabel}
                        </span>
                      )}
                      {refreshChipAction.visible && (
                        <button
                          type="button"
                          onClick={() => requestRefreshChip(report.id)}
                          disabled={refreshChipAction.disabled}
                          className="font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:text-accent hover:underline disabled:opacity-60"
                        >
                          {refreshChipAction.controlLabel ?? 'Refresh stories'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {report.sentiment !== null && (
                        <span
                          className={`font-mono text-xs ${
                            report.sentiment >= 0.3
                              ? 'text-accent-green'
                              : report.sentiment <= -0.3
                                ? 'text-accent-red'
                                : 'text-text-secondary'
                          }`}
                        >
                          {report.sentiment > 0 ? '+' : ''}
                          {report.sentiment.toFixed(2)}
                        </span>
                      )}
                      <StatusBadge status={report.deliveryStatus} />
                    </div>
                  </div>
                  <Link
                    to={focusedReportHref}
                    className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
                  >
                    <p className="text-text-primary text-sm font-body leading-relaxed line-clamp-2">{previewBody}</p>
                    {secondaryPreview && (
                      <p className="mt-2 text-xs font-body text-text-secondary leading-relaxed line-clamp-1">
                        <span className="font-mono uppercase tracking-wider text-[10px] text-text-secondary/80">
                          {secondaryPreview.label}
                        </span>{' '}
                        {secondaryPreview.text}
                      </p>
                    )}
                  </Link>
                </div>
                {activeChains.length > 0 && (
                  <ReportChainPreviewSection
                    reportId={report.id}
                    chainDrilldowns={activeChains}
                    hiddenActiveChainCount={hiddenActiveChainCount}
                    previewSummary={report.eventChains?.[0]}
                    previewBody={report.tldr}
                    onFocusedReportHrefChange={(nextHref) =>
                      updateFocusedReportHref(report.id, fallbackFocusedReportHref, nextHref)
                    }
                    onPreviewBodyChange={(nextBody) => updateReportPreviewBody(report.id, report.tldr, nextBody)}
                    onLeadChainLabelChange={(nextLabel) =>
                      updateLeadChainLabel(report.id, fallbackLeadChainLabel, nextLabel)
                    }
                    onLeadChainHrefChange={(nextHref) =>
                      updateLeadChainHref(report.id, fallbackLeadChainHref, nextHref)
                    }
                    onVisibleChainCountChange={(nextCount) =>
                      updateVisibleChainCount(report.id, activeChains.length, nextCount)
                    }
                    onHeaderStoryActionChange={(nextAction) =>
                      updateStoryChipAction(report.id, fallbackStoryChipAction, nextAction)
                    }
                    onHeaderRefreshActionChange={(nextAction) =>
                      updateRefreshChipAction(report.id, fallbackRefreshChipAction, nextAction)
                    }
                    toggleVisibleChainsRequest={storyChipToggleRequests[report.id]}
                    refreshVisibleChainsRequest={refreshChipRequests[report.id]}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Load More */}
      {!loading && hasMore && reports.length > 0 && (
        <div className="text-center pt-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-6 py-2 bg-surface border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary hover:border-[#3a3a4f] transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
