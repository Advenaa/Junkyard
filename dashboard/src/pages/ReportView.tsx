import { useState, useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { apiFetch, isFeatureDisabledError } from '../lib/api';
import { formatMacroRegimeLabel, macroRegimeToneClasses } from '../lib/macroRegime';
import { buildFocusedReportHref, buildSummaryChainHref } from '../lib/reportChains';
import { TypeBadge } from '../components/TypeBadge';
import { EmptyState } from '../components/EmptyState';
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
  ALPHA_WATCH_PREVIEW_LIMIT,
  CALENDAR_PREVIEW_LIMIT,
  FIRST_MOVER_PREVIEW_LIMIT,
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
        if (!cancelled) {
          setReport(null);
          setError(err.message);
          setLoadedKey(requestKey);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, requestKey]);

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
          registerDisabledFeature({ feature: err.feature, missingEnv: err.missingEnv, disables: err.disables });
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
          registerDisabledFeature({ feature: err.feature, missingEnv: err.missingEnv, disables: err.disables });
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
          registerDisabledFeature({ feature: err.feature, missingEnv: err.missingEnv, disables: err.disables });
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

  const loading = loadedKey !== requestKey;

  if (loading) {
    return <div className="p-6 text-text-secondary font-body">Loading...</div>;
  }

  if (error) {
    return <div className="p-6 text-accent-red font-body">Error: {error}</div>;
  }

  if (!report) {
    return (
      <div className="p-6">
        <EmptyState
          title="No reports yet"
          description="Add your first source in Settings to start generating market reports."
        />
      </div>
    );
  }

  const focusedChainId = searchParams.get('chain');
  const allChains = report.chainDrilldowns ?? [];
  const focusedChain = focusedChainId ? (allChains.find((chain) => chain.rootId === focusedChainId) ?? null) : null;
  const focusedChainIndex = focusedChain ? allChains.findIndex((chain) => chain.rootId === focusedChain.rootId) : -1;
  const focusedChainSummary =
    focusedChainIndex >= 0 && report.eventChains[focusedChainIndex] ? report.eventChains[focusedChainIndex] : null;
  const orderedEventChains = focusedChainSummary
    ? [focusedChainSummary, ...report.eventChains.filter((_, index) => index !== focusedChainIndex)]
    : report.eventChains;
  const orderedChains = focusedChain
    ? [focusedChain, ...allChains.filter((chain) => chain.rootId !== focusedChain.rootId)]
    : allChains;
  const macroEntries = macroOverview?.entries.slice(0, MACRO_PREVIEW_LIMIT) ?? [];
  const priceEntries = priceWatch?.entries.slice(0, PRICE_WATCH_PREVIEW_LIMIT) ?? [];
  const narrativeEntries = narratives?.entries.slice(0, NARRATIVE_PREVIEW_LIMIT) ?? [];
  const unusualEntries = unusualActivity?.entries.slice(0, UNUSUAL_ACTIVITY_PREVIEW_LIMIT) ?? [];
  const regionalDivergenceEntries = regionalDivergences?.slice(0, REGIONAL_DIVERGENCE_PREVIEW_LIMIT) ?? [];
  const firstMoverEntries = firstMoverWatchlist?.entries.slice(0, FIRST_MOVER_PREVIEW_LIMIT) ?? [];
  const alphaWatchEntries = alphaWatch?.entries.slice(0, ALPHA_WATCH_PREVIEW_LIMIT) ?? [];
  const calendarEntries = calendarEvents?.slice(0, CALENDAR_PREVIEW_LIMIT) ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TypeBadge type={report.type} />
          <span className="font-mono text-xs text-text-secondary uppercase tracking-wider">Report</span>
        </div>
        <span className="font-mono text-xs text-text-secondary">{formatDate(report.date)}</span>
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
              <p className="text-text-primary text-sm font-body leading-relaxed">{report.macroRegime.rationale}</p>
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
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Market Catalysts</h2>
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
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Narrative Shifts</h2>
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
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Unusual Activity</h2>
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
            {orderedEventChains.map((chain, i) => {
              const isFocusedSummary = focusedChainSummary !== null && i === 0;

              return (
                <div
                  key={`${i}:${chain}`}
                  className={`px-4 py-3 space-y-1 text-sm font-body leading-relaxed ${
                    isFocusedSummary ? 'bg-accent/5 text-text-primary' : 'text-text-primary'
                  }`}
                >
                  {isFocusedSummary && (
                    <div className="font-mono text-[10px] uppercase tracking-wider text-accent">
                      Focused chain summary
                    </div>
                  )}
                  <div>{chain}</div>
                </div>
              );
            })}
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
                      <Link
                        to={buildSummaryChainHref(chain.latestSummaryId, chain.rootId)}
                        className="text-xs font-mono uppercase tracking-wider text-accent hover:underline"
                      >
                        Open latest linked summary
                      </Link>
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
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Entity Sentiment</h2>
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
}
