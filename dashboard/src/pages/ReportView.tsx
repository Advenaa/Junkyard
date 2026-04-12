import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { apiFetch, isApiError, isFeatureDisabledError } from '../lib/api';
import { formatMacroRegimeLabel, macroRegimeToneClasses } from '../lib/macroRegime';
import { buildFocusedReportHref, buildSummaryChainHref } from '../lib/reportChains';
import { BookmarkButton } from '../components/BookmarkButton';
import { DataShell } from '../components/DataShell';
import { FlagButton } from '../components/FlagButton';
import { TypeBadge } from '../components/TypeBadge';
import { useStatus } from '../components/StatusProvider';
import type {
  AlphaWatchOverview,
  CalendarEventSnapshotEntry,
  FirstMoverWatchlistOverview,
  FullReport,
  MacroOverview,
  NarrativeWatchlistOverview,
  PriceWatchOverview,
  RegionalDivergenceEntry,
  UnusualActivityOverview,
} from './ReportView/types';
import {
  CALENDAR_PREVIEW_LIMIT,
  MACRO_PREVIEW_LIMIT,
  NARRATIVE_PREVIEW_LIMIT,
  PRICE_WATCH_PREVIEW_LIMIT,
  REGIONAL_DIVERGENCE_DAYS,
  REGIONAL_DIVERGENCE_PREVIEW_LIMIT,
  UNUSUAL_ACTIVITY_PREVIEW_LIMIT,
} from './ReportView/types';
import { CollapsibleSection, SentimentBar, formatDate, formatDateTime, formatRange } from './ReportView/formatters';
import { MacroSection } from './ReportView/sections/MacroSection';
import { PriceWatchSection } from './ReportView/sections/PriceWatchSection';
import { NarrativeSection } from './ReportView/sections/NarrativeSection';
import { UnusualActivitySection } from './ReportView/sections/UnusualActivitySection';
import { RegionalDivergenceSection } from './ReportView/sections/RegionalDivergenceSection';
import { FirstMoverSection } from './ReportView/sections/FirstMoverSection';
import { AlphaWatchSection } from './ReportView/sections/AlphaWatchSection';
import { CalendarSection } from './ReportView/sections/CalendarSection';

export function ReportView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const requestKey = id ?? '__latest__';
  const { ready: statusReady, isFeatureDisabled, getDisabledFeature, registerDisabledFeature } = useStatus();
  const macroDisabled = isFeatureDisabled('macro');
  const pricesDisabled = isFeatureDisabled('prices');
  const embeddingsDisabled = isFeatureDisabled('embeddings');
  const disabledMacro = getDisabledFeature('macro');
  const disabledPrices = getDisabledFeature('prices');
  const disabledEmbeddings = getDisabledFeature('embeddings');
  const [report, setReport] = useState<FullReport | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [macroOverviewState, setMacroOverviewState] = useState<MacroOverview | null>(null);
  const [priceWatchState, setPriceWatchState] = useState<PriceWatchOverview | null>(null);
  const [narrativesState, setNarrativesState] = useState<NarrativeWatchlistOverview | null>(null);
  const [unusualActivity, setUnusualActivity] = useState<UnusualActivityOverview | null>(null);
  const [regionalDivergences, setRegionalDivergences] = useState<RegionalDivergenceEntry[] | null>(null);
  const [firstMoverWatchlist, setFirstMoverWatchlist] = useState<FirstMoverWatchlistOverview | null>(null);
  const [alphaWatch, setAlphaWatch] = useState<AlphaWatchOverview | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventSnapshotEntry[] | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [shareConfirm, setShareConfirm] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const macroOverview = macroDisabled ? null : macroOverviewState;
  const priceWatch = pricesDisabled ? null : priceWatchState;
  const narratives = embeddingsDisabled ? null : narrativesState;

  useEffect(() => {
    let cancelled = false;

    const fetchReport = id
      ? apiFetch<{ report: FullReport }>(`/reports/${id}`)
      : apiFetch<{ reports: Array<{ id: string }> }>('/reports?limit=1').then((res) => {
          const latest = res.reports[0];
          if (!latest) return { report: null } as { report: FullReport | null };
          return apiFetch<{ report: FullReport }>(`/reports/${latest.id}`);
        });

    fetchReport
      .then((res) => {
        if (!cancelled) {
          setReport((res as { report: FullReport | null }).report ?? null);
          setError(null);
          setLoadedKey(requestKey);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setReport(null);
        if (isApiError(err) && err.status === 404) {
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
        setLoadedKey(requestKey);
      });

    return () => {
      cancelled = true;
    };
  }, [id, requestKey]);

  useEffect(() => {
    if (!report) return;
    let cancelled = false;

    apiFetch<{ reportIds: string[] }>('/bookmarks')
      .then((res) => {
        if (!cancelled) {
          setBookmarked(res.reportIds.includes(report.id));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBookmarked(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [report]);

  useEffect(() => {
    if (!statusReady) return;
    if (macroDisabled) return;
    let cancelled = false;

    apiFetch<MacroOverview>('/macro')
      .then((overview) => {
        if (!cancelled) {
          setMacroOverviewState(overview);
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
          setMacroOverviewState(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [statusReady, macroDisabled, registerDisabledFeature]);

  useEffect(() => {
    if (!statusReady) return;
    if (pricesDisabled) return;
    let cancelled = false;

    apiFetch<PriceWatchOverview>('/price-watch')
      .then((overview) => {
        if (!cancelled) {
          setPriceWatchState(overview);
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
          setPriceWatchState(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [statusReady, pricesDisabled, registerDisabledFeature]);

  useEffect(() => {
    let cancelled = false;

    apiFetch<{ divergences: RegionalDivergenceEntry[] }>(
      `/divergence?days=${REGIONAL_DIVERGENCE_DAYS}&limit=${REGIONAL_DIVERGENCE_PREVIEW_LIMIT}`,
    )
      .then((overview) => {
        if (!cancelled) {
          setRegionalDivergences(overview.divergences);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRegionalDivergences(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!statusReady) return;
    if (embeddingsDisabled) return;
    let cancelled = false;

    apiFetch<NarrativeWatchlistOverview>('/narratives')
      .then((overview) => {
        if (!cancelled) {
          setNarrativesState(overview);
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
          setNarrativesState(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [statusReady, embeddingsDisabled, registerDisabledFeature]);

  useEffect(() => {
    let cancelled = false;

    apiFetch<UnusualActivityOverview>('/unusual-activity')
      .then((overview) => {
        if (!cancelled) {
          setUnusualActivity(overview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnusualActivity(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiFetch<FirstMoverWatchlistOverview>('/first-movers')
      .then((overview) => {
        if (!cancelled) {
          setFirstMoverWatchlist(overview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFirstMoverWatchlist(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiFetch<AlphaWatchOverview>('/alpha-watch')
      .then((overview) => {
        if (!cancelled) {
          setAlphaWatch(overview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAlphaWatch(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiFetch<{ events: CalendarEventSnapshotEntry[] }>('/calendar-events')
      .then((overview) => {
        if (!cancelled) {
          setCalendarEvents(overview.events);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCalendarEvents(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const macroEntries = useMemo(() => macroOverview?.entries.slice(0, MACRO_PREVIEW_LIMIT) ?? [], [macroOverview]);
  const priceEntries = useMemo(() => priceWatch?.entries.slice(0, PRICE_WATCH_PREVIEW_LIMIT) ?? [], [priceWatch]);
  const narrativeEntries = useMemo(() => narratives?.entries.slice(0, NARRATIVE_PREVIEW_LIMIT) ?? [], [narratives]);
  const unusualEntries = useMemo(
    () => unusualActivity?.entries.slice(0, UNUSUAL_ACTIVITY_PREVIEW_LIMIT) ?? [],
    [unusualActivity],
  );
  const regionalDivergenceEntries = useMemo(
    () => regionalDivergences?.slice(0, REGIONAL_DIVERGENCE_PREVIEW_LIMIT) ?? [],
    [regionalDivergences],
  );
  const firstMoverEntries = useMemo(() => firstMoverWatchlist?.entries ?? [], [firstMoverWatchlist]);
  const alphaWatchEntries = useMemo(() => alphaWatch?.entries ?? [], [alphaWatch]);
  const calendarEntries = useMemo(() => calendarEvents?.slice(0, CALENDAR_PREVIEW_LIMIT) ?? [], [calendarEvents]);
  const loading = loadedKey !== requestKey;

  const handleExport = (format: 'md' | 'json') => {
    setExportOpen(false);
    const reportId = report?.id;
    if (!reportId) return;
    const url = `/api/v1/reports/${reportId}/export?format=${format}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${reportId}.${format === 'md' ? 'md' : 'json'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleShare = () => {
    void navigator.clipboard.writeText(window.location.href).then(() => {
      setShareConfirm(true);
      setTimeout(() => setShareConfirm(false), 2000);
    });
  };

  return (
    <DataShell
      loading={loading}
      error={error ? `Error: ${error}` : null}
      data={report}
      skeleton={<div className="p-6 text-text-secondary font-body">Loading...</div>}
      emptyTitle="Report not found"
      emptyDescription="This report may have been removed or the link is stale."
    >
      {(loadedReport) => {
        const report = loadedReport;
        const focusedChainId = searchParams.get('chain');
        const allChains = report.chainDrilldowns ?? [];
        const focusedChain = focusedChainId
          ? (allChains.find((chain) => chain.rootId === focusedChainId) ?? null)
          : null;
        const orderedChains = focusedChain
          ? [focusedChain, ...allChains.filter((chain) => chain.rootId !== focusedChain.rootId)]
          : allChains;

        return (
          <div className="p-6 max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TypeBadge type={report.type} />
                <span className="font-mono text-xs text-text-secondary uppercase tracking-wider">Report</span>
                <span className="font-mono text-xs text-text-secondary">{formatDate(report.date)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative" ref={exportDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setExportOpen((prev) => !prev)}
                    className="px-3 py-1.5 rounded-lg border border-border text-text-secondary text-xs font-mono uppercase tracking-wider hover:text-text-primary hover:border-text-secondary transition-colors"
                  >
                    Export
                  </button>
                  {exportOpen && (
                    <div className="absolute right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-lg z-10 min-w-[120px]">
                      <button
                        type="button"
                        onClick={() => handleExport('md')}
                        className="w-full text-left px-4 py-2 text-xs font-mono text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors rounded-t-lg"
                      >
                        Markdown
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExport('json')}
                        className="w-full text-left px-4 py-2 text-xs font-mono text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors rounded-b-lg"
                      >
                        JSON
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleShare}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-mono uppercase tracking-wider transition-colors ${
                    shareConfirm
                      ? 'border-accent-green text-accent-green'
                      : 'border-border text-text-secondary hover:text-text-primary hover:border-text-secondary'
                  }`}
                >
                  {shareConfirm ? 'Copied!' : 'Share'}
                </button>
              </div>
              <div className="flex items-center gap-3">
                <BookmarkButton
                  reportId={report.id}
                  bookmarked={bookmarked}
                  onToggle={(_reportId, isBookmarked) => setBookmarked(isBookmarked)}
                  size="md"
                />
                <span className="font-mono text-xs text-text-secondary">{formatDate(report.date)}</span>
              </div>
            </div>

            {/* TL;DR Hero */}
            <blockquote className="font-heading text-xl leading-relaxed text-text-primary border-l-2 border-accent pl-6 py-2">
              {report.tldr}
            </blockquote>

            <MacroSection
              macroDisabled={macroDisabled}
              disabledMacro={disabledMacro}
              macroOverview={macroOverview}
              macroEntries={macroEntries}
            />

            <PriceWatchSection
              pricesDisabled={pricesDisabled}
              disabledPrices={disabledPrices}
              priceWatch={priceWatch}
              priceEntries={priceEntries}
            />

            <NarrativeSection
              embeddingsDisabled={embeddingsDisabled}
              disabledEmbeddings={disabledEmbeddings}
              narratives={narratives}
              narrativeEntries={narrativeEntries}
            />

            <UnusualActivitySection unusualActivity={unusualActivity} unusualEntries={unusualEntries} />

            <RegionalDivergenceSection
              regionalDivergences={regionalDivergences}
              regionalDivergenceEntries={regionalDivergenceEntries}
            />

            <FirstMoverSection firstMoverWatchlist={firstMoverWatchlist} firstMoverEntries={firstMoverEntries} />

            <AlphaWatchSection alphaWatch={alphaWatch} alphaWatchEntries={alphaWatchEntries} />

            <CalendarSection calendarEvents={calendarEvents} calendarEntries={calendarEntries} />

            {report.macroRegime && (
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-2">
                    <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Macro Regime</h2>
                    <p className="text-text-primary text-sm font-body leading-relaxed">
                      {report.macroRegime.rationale}
                    </p>
                    {report.macroRegimeHistory && report.macroRegimeHistory.streakDays > 0 && (
                      <p className="text-text-secondary text-xs font-mono uppercase tracking-wide">
                        Day {report.macroRegimeHistory.streakDays} of current daily regime | since{' '}
                        {formatDate(report.macroRegimeHistory.regimeStartedAt)}
                        {report.macroRegimeHistory.previousClassification
                          ? ` | previous ${formatMacroRegimeLabel(report.macroRegimeHistory.previousClassification)}`
                          : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wide ${macroRegimeToneClasses(report.macroRegime.classification)}`}
                    >
                      {formatMacroRegimeLabel(report.macroRegime.classification)}
                    </span>
                    <span className="text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                      {Math.round(report.macroRegime.confidence * 100)}% confidence
                    </span>
                  </div>
                </div>
              </div>
            )}

            {report.marketCatalysts && report.marketCatalysts.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">
                  Market Catalysts
                </h2>
                <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {report.marketCatalysts.map((catalyst, i) => (
                    <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                      {catalyst}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.regionalDivergence && report.regionalDivergence.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">
                  Cross-Language Signals
                </h2>
                <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {report.regionalDivergence.map((entry, i) => (
                    <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                      {entry}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.narrativeShifts && report.narrativeShifts.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">
                  Narrative Shifts
                </h2>
                <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {report.narrativeShifts.map((entry, i) => (
                    <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                      {entry}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.firstMovers && report.firstMovers.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">First Movers</h2>
                <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {report.firstMovers.map((entry, i) => (
                    <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                      {entry}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.alphaSignals && report.alphaSignals.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Alpha Signals</h2>
                <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {report.alphaSignals.map((signal, i) => (
                    <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                      {signal}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.newProjects && report.newProjects.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">New Projects</h2>
                <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {report.newProjects.map((project, i) => (
                    <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                      <span className="font-semibold">{project.name}</span>
                      <span className="text-text-secondary"> — </span>
                      {project.description}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.priceAlerts && report.priceAlerts.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Price Alerts</h2>
                <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {report.priceAlerts.map((alert, i) => (
                    <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                      {alert}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.unusualActivity && report.unusualActivity.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">
                  Unusual Activity
                </h2>
                <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {report.unusualActivity.map((alert, i) => (
                    <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                      {alert}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.macroAlerts && report.macroAlerts.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Macro Alerts</h2>
                <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {report.macroAlerts.map((alert, i) => (
                    <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                      {alert}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.eventChains && report.eventChains.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Event Chains</h2>
                <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {report.eventChains.map((chain, i) => (
                    <div
                      key={`${i}:${chain}`}
                      className="px-4 py-3 space-y-1 text-sm font-body leading-relaxed text-text-primary"
                    >
                      <div>{chain}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {allChains.length > 0 && (
              <div>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                  <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Chain Drilldowns</h2>
                  {focusedChain && (
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
                        Focused chain | {focusedChain.entityName} | {focusedChain.latestEventType}
                      </span>
                      <Link
                        to={`/reports/${report.id}`}
                        className="text-[10px] font-mono uppercase tracking-wider text-text-secondary hover:text-accent hover:underline"
                      >
                        Show all chains
                      </Link>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {orderedChains.map((chain) => {
                    const isFocused = focusedChain?.rootId === chain.rootId;

                    return (
                      <div
                        key={chain.rootId}
                        className={`bg-surface border rounded-lg p-4 space-y-2 ${
                          isFocused ? 'border-accent/60 bg-accent/5' : 'border-border'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="text-sm font-body text-text-primary">{chain.entityName}</div>
                            <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary">
                              {chain.eventCount} linked event{chain.eventCount !== 1 ? 's' : ''} |{' '}
                              {chain.eventTypes.join(' -> ')}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            {isFocused ? (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-accent">
                                Focused chain
                              </span>
                            ) : allChains.length > 1 ? (
                              <Link
                                to={buildFocusedReportHref(report.id, chain.rootId)}
                                className="text-[10px] font-mono uppercase tracking-wider text-text-secondary hover:text-accent hover:underline"
                              >
                                Focus chain
                              </Link>
                            ) : null}
                            <div className="flex items-center gap-3">
                              <FlagButton targetType="summary" targetId={chain.latestSummaryId} />
                              <Link
                                to={buildSummaryChainHref(chain.latestSummaryId, chain.rootId)}
                                className="text-xs font-mono uppercase tracking-wider text-accent hover:underline"
                              >
                                Open latest linked summary
                              </Link>
                            </div>
                          </div>
                        </div>
                        <div className="text-xs font-body text-text-secondary leading-relaxed">
                          {formatRange(chain.firstEventTime, chain.latestEventTime)}
                        </div>
                        <div className="text-xs font-mono uppercase tracking-wider text-text-secondary">
                          Latest event | {chain.latestEventType} | {formatDateTime(chain.latestEventTime)}
                        </div>
                        <div className="text-sm font-body text-text-primary leading-relaxed">
                          {chain.latestEventDescription}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Key Events */}
            {report.keyEvents && report.keyEvents.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Key Events</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {report.keyEvents.map((event, i) => (
                    <div
                      key={i}
                      className="bg-surface border border-border rounded-lg p-4 text-sm font-body text-text-primary leading-relaxed"
                    >
                      {event}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Entity Sentiment */}
            {report.entitySentiment && report.entitySentiment.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">
                  Entity Sentiment
                </h2>
                <div className="bg-surface border border-border rounded-lg p-4">
                  {report.entitySentiment.map((entity) => (
                    <SentimentBar key={entity.name} entity={entity} />
                  ))}
                </div>
              </div>
            )}

            {/* Collapsible Sections */}
            {report.sections && report.sections.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Sections</h2>
                <div className="space-y-2">
                  {report.sections.map((section) => (
                    <CollapsibleSection key={section.title} section={section} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }}
    </DataShell>
  );
}
