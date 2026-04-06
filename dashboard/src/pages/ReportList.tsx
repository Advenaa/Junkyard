import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../lib/api';
import type { Report } from '../lib/types';
import {
  areReportChainRefreshActionsEqual,
  areReportChainToggleActionsEqual,
  buildLeadChainHref,
  buildLeadChainLabel,
  buildLeadReportHref,
  getReportChainRefreshAction,
  getReportChainStoryChipLabel,
  getReportChainToggleAction,
  type ReportChainRefreshAction,
  type ReportChainToggleAction,
} from '../lib/reportChains';
import { ReportChainPreviewSection } from '../components/ReportChainPreviewSection';
import { TypeBadge } from '../components/TypeBadge';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';

type FilterType = 'all' | 'daily' | 'flash' | 'pulse';
const FILTERS: FilterType[] = ['all', 'daily', 'flash', 'pulse'];
const PAGE_SIZE = 20;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ReportList() {
  const [filter, setFilter] = useState<FilterType>('all');
  const [reports, setReports] = useState<Report[]>([]);
  const [previewBodyOverrides, setPreviewBodyOverrides] = useState<Record<string, string>>({});
  const [leadChainLabelOverrides, setLeadChainLabelOverrides] = useState<Record<string, string>>({});
  const [leadChainHrefOverrides, setLeadChainHrefOverrides] = useState<Record<string, string>>({});
  const [focusedReportHrefOverrides, setFocusedReportHrefOverrides] = useState<Record<string, string>>({});
  const [visibleChainCountOverrides, setVisibleChainCountOverrides] = useState<Record<string, number>>({});
  const [storyChipActionOverrides, setStoryChipActionOverrides] = useState<Record<string, ReportChainToggleAction>>({});
  const [storyChipToggleRequests, setStoryChipToggleRequests] = useState<Record<string, number>>({});
  const [refreshChipActionOverrides, setRefreshChipActionOverrides] = useState<
    Record<string, ReportChainRefreshAction>
  >({});
  const [refreshChipRequests, setRefreshChipRequests] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const fetchReports = useCallback(
    async (offset: number, append: boolean) => {
      const typeParam = filter !== 'all' ? `&type=${filter}` : '';
      const res = await apiFetch<{ reports: Report[] }>(`/reports?limit=${PAGE_SIZE}&offset=${offset}${typeParam}`);
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
    setLoading(true);
    setError(null);
    fetchReports(0, false)
      .catch(() => setError('Failed to load reports. Please try again.'))
      .finally(() => setLoading(false));
  }, [fetchReports]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      await fetchReports(reports.length, true);
    } catch {
      setError('Failed to load more reports. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  };

  const updateReportPreviewBody = useCallback((reportId: string, fallbackBody: string, nextBody: string | null) => {
    if (!nextBody) return;

    setPreviewBodyOverrides((prev) => {
      if (nextBody === fallbackBody) {
        if (!(reportId in prev)) return prev;
        const next = { ...prev };
        delete next[reportId];
        return next;
      }
      if (prev[reportId] === nextBody) return prev;
      return { ...prev, [reportId]: nextBody };
    });
  }, []);

  const updateLeadChainLabel = useCallback(
    (reportId: string, fallbackLabel: string | null, nextLabel: string | null) => {
      if (!nextLabel) return;

      setLeadChainLabelOverrides((prev) => {
        if (nextLabel === fallbackLabel) {
          if (!(reportId in prev)) return prev;
          const next = { ...prev };
          delete next[reportId];
          return next;
        }
        if (prev[reportId] === nextLabel) return prev;
        return { ...prev, [reportId]: nextLabel };
      });
    },
    [],
  );

  const updateLeadChainHref = useCallback((reportId: string, fallbackHref: string | null, nextHref: string | null) => {
    if (!nextHref) return;

    setLeadChainHrefOverrides((prev) => {
      if (nextHref === fallbackHref) {
        if (!(reportId in prev)) return prev;
        const next = { ...prev };
        delete next[reportId];
        return next;
      }
      if (prev[reportId] === nextHref) return prev;
      return { ...prev, [reportId]: nextHref };
    });
  }, []);

  const updateFocusedReportHref = useCallback(
    (reportId: string, fallbackHref: string | null, nextHref: string | null) => {
      if (!nextHref) return;

      setFocusedReportHrefOverrides((prev) => {
        if (nextHref === fallbackHref) {
          if (!(reportId in prev)) return prev;
          const next = { ...prev };
          delete next[reportId];
          return next;
        }
        if (prev[reportId] === nextHref) return prev;
        return { ...prev, [reportId]: nextHref };
      });
    },
    [],
  );

  const updateVisibleChainCount = useCallback((reportId: string, fallbackCount: number, nextCount: number) => {
    setVisibleChainCountOverrides((prev) => {
      if (nextCount === fallbackCount) {
        if (!(reportId in prev)) return prev;
        const next = { ...prev };
        delete next[reportId];
        return next;
      }
      if (prev[reportId] === nextCount) return prev;
      return { ...prev, [reportId]: nextCount };
    });
  }, []);

  const updateStoryChipAction = useCallback(
    (reportId: string, fallbackAction: ReportChainToggleAction, nextAction: ReportChainToggleAction) => {
      setStoryChipActionOverrides((prev) => {
        if (areReportChainToggleActionsEqual(nextAction, fallbackAction)) {
          if (!(reportId in prev)) return prev;
          const next = { ...prev };
          delete next[reportId];
          return next;
        }
        if (prev[reportId] && areReportChainToggleActionsEqual(prev[reportId], nextAction)) return prev;
        return { ...prev, [reportId]: nextAction };
      });
    },
    [],
  );

  const requestStoryChipToggle = useCallback((reportId: string) => {
    setStoryChipToggleRequests((prev) => ({
      ...prev,
      [reportId]: (prev[reportId] ?? 0) + 1,
    }));
  }, []);

  const updateRefreshChipAction = useCallback(
    (reportId: string, fallbackAction: ReportChainRefreshAction, nextAction: ReportChainRefreshAction) => {
      setRefreshChipActionOverrides((prev) => {
        if (areReportChainRefreshActionsEqual(nextAction, fallbackAction)) {
          if (!(reportId in prev)) return prev;
          const next = { ...prev };
          delete next[reportId];
          return next;
        }
        if (prev[reportId] && areReportChainRefreshActionsEqual(prev[reportId], nextAction)) return prev;
        return { ...prev, [reportId]: nextAction };
      });
    },
    [],
  );

  const requestRefreshChip = useCallback((reportId: string) => {
    setRefreshChipRequests((prev) => ({
      ...prev,
      [reportId]: (prev[reportId] ?? 0) + 1,
    }));
  }, []);

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

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          <p>{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              fetchReports(0, false)
                .catch(() => setError('Failed to load reports. Please try again.'))
                .finally(() => setLoading(false));
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
      ) : reports.length === 0 ? (
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

            return (
              <div
                key={report.id}
                className="bg-surface border border-border rounded-lg overflow-hidden transition-all duration-[160ms] hover:-translate-y-px hover:shadow-lg hover:border-[#3a3a4f]"
              >
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <TypeBadge type={report.type} />
                      <span className="font-mono text-xs text-text-secondary">{formatDate(report.date)}</span>
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
                    {activeChains.length === 0 && report.eventChains && report.eventChains.length > 0 && (
                      <p className="mt-2 text-xs font-body text-text-secondary leading-relaxed line-clamp-1">
                        <span className="font-mono uppercase tracking-wider text-[10px] text-text-secondary/80">
                          Event Chain
                        </span>{' '}
                        {report.eventChains[0]}
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
