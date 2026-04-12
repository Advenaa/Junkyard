import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../lib/api';
import { formatShortDate } from '../lib/formatting';
import { buildMacroRegimePreviewTitle, formatMacroRegimePreview, macroRegimeToneClasses } from '../lib/macroRegime';
import { getReportSecondaryPreview } from '../lib/reportPreview';
import { useReportPreviewState } from '../lib/useReportPreviewState';
import type { MacroRegime, MacroRegimeHistory, ReportChainDrilldown } from '../lib/types';
import {
  buildLeadChainHref,
  buildLeadChainLabel,
  buildLeadReportHref,
  getReportChainRefreshAction,
  getReportChainStoryChipLabel,
  getReportChainToggleAction,
} from '../lib/reportChains';
import { Badge } from '../components/Badge';
import { DataShell } from '../components/DataShell';
import { ReportChainPreviewSection } from '../components/ReportChainPreviewSection';
import { TypeBadge } from '../components/TypeBadge';

type SearchScope = 'all' | 'summary' | 'report';

interface SearchResult {
  id: string;
  resultType?: 'summary' | 'report';
  source?: string | null;
  sourceId?: string | null;
  body: string;
  createdAt: number;
  reportType?: 'daily' | 'flash' | 'pulse' | null;
  date?: string | null;
  eventChains?: string[];
  marketCatalysts?: string[];
  regionalDivergence?: string[];
  narrativeShifts?: string[];
  firstMovers?: string[];
  priceAlerts?: string[];
  alphaSignals?: string[];
  unusualActivity?: string[];
  macroAlerts?: string[];
  macroRegime?: MacroRegime | null;
  macroRegimeHistory?: MacroRegimeHistory | null;
  chainDrilldowns?: ReportChainDrilldown[];
  hasMoreActiveChains?: boolean;
  hiddenActiveChainCount?: number;
}

interface SearchResponse {
  results: SearchResult[];
}

const DAYS_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '365 days', value: 365 },
];

const SCOPE_OPTIONS: Array<{ label: string; value: SearchScope }> = [
  { label: 'All', value: 'all' },
  { label: 'Summaries', value: 'summary' },
  { label: 'Reports', value: 'report' },
];

const SOURCE_COLORS: Record<string, string> = {
  discord: 'bg-accent/20 text-accent',
  twitter: 'bg-accent-orange/20 text-accent-orange',
  rss: 'bg-accent-green/20 text-accent-green',
  news: 'bg-border text-text-secondary',
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

function isReportResult(result: SearchResult): boolean {
  return result.resultType === 'report';
}

function getResultHref(result: SearchResult): string {
  return isReportResult(result) ? `/reports/${result.id}` : `/summaries/${result.id}`;
}

export function Search() {
  const [query, setQuery] = useState('');
  const [days, setDays] = useState(30);
  const [scope, setScope] = useState<SearchScope>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || loading) return;

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const data = await apiFetch<SearchResponse>(
        `/search?q=${encodeURIComponent(q)}&limit=20&days=${days}&mode=keyword&scope=${scope}`,
      );
      setResults(data.results);
    } catch {
      setError('Search failed. Please try again.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="font-heading text-2xl text-text-primary">Search</h1>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            scope === 'report'
              ? 'Search reports...'
              : scope === 'summary'
                ? 'Search summaries...'
                : 'Search summaries and reports...'
          }
          className="flex-1 bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as SearchScope)}
          className="bg-background border border-border rounded-lg px-3 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
        >
          {SCOPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-background border border-border rounded-lg px-3 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
        >
          {DAYS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40 transition-opacity"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          <p>{error}</p>
        </div>
      )}

      {/* Results */}
      <DataShell
        loading={loading}
        error={null}
        data={results}
        isEmpty={(data) => searched && data.length === 0}
        emptyTitle="No results found"
        emptyDescription="Try different keywords or a wider time range."
      >
        {(results) =>
          results.length > 0 ? (
            <div className="space-y-3">
              {results.map((result) => {
                if (!isReportResult(result)) {
                  return (
                    <div
                      key={result.id}
                      className="bg-surface border border-border rounded-lg overflow-hidden transition-colors hover:border-accent/50 focus-within:ring-2 focus-within:ring-accent/40"
                    >
                      <Link to={getResultHref(result)} className="block p-4 space-y-2 focus:outline-none">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge
                              label={result.source ?? 'summary'}
                              colorClass={SOURCE_COLORS[result.source ?? 'summary']}
                              uppercase
                            />
                            {result.sourceId && (
                              <span className="text-text-secondary text-xs font-mono">{result.sourceId}</span>
                            )}
                          </div>
                          <span className="text-text-secondary text-xs font-mono">
                            {formatShortDate(result.createdAt)}
                          </span>
                        </div>
                        <p className="text-text-primary text-sm font-body leading-relaxed">
                          {truncate(result.body, 200)}
                        </p>
                      </Link>
                    </div>
                  );
                }

                const activeChains = isReportResult(result) ? (result.chainDrilldowns ?? []) : [];
                const hiddenActiveChainCount = isReportResult(result) ? (result.hiddenActiveChainCount ?? 0) : 0;
                const previewBody = isReportResult(result)
                  ? (previewBodyOverrides[result.id] ?? result.body)
                  : result.body;
                const fallbackLeadChainLabel = buildLeadChainLabel(activeChains[0]);
                const leadChainLabel = leadChainLabelOverrides[result.id] ?? fallbackLeadChainLabel;
                const fallbackLeadChainHref = buildLeadChainHref(activeChains[0]);
                const leadChainHref = leadChainHrefOverrides[result.id] ?? fallbackLeadChainHref;
                const fallbackFocusedReportHref =
                  buildLeadReportHref(result.id, activeChains[0]) ?? `/reports/${result.id}`;
                const focusedReportHref = focusedReportHrefOverrides[result.id] ?? fallbackFocusedReportHref;
                const visibleChainCount = visibleChainCountOverrides[result.id] ?? activeChains.length;
                const fallbackStoryChipAction = getReportChainToggleAction({
                  previewChainCount: activeChains.length,
                  visibleChainCount: activeChains.length,
                  hiddenActiveChainCount,
                });
                const storyChipAction = storyChipActionOverrides[result.id] ?? fallbackStoryChipAction;
                const fallbackRefreshChipAction = getReportChainRefreshAction({
                  previewChainCount: activeChains.length,
                  visibleChainCount: activeChains.length,
                  hiddenActiveChainCount,
                });
                const refreshChipAction = refreshChipActionOverrides[result.id] ?? fallbackRefreshChipAction;
                const secondaryPreview = getReportSecondaryPreview({
                  activeChainCount: activeChains.length,
                  eventChains: result.eventChains,
                  marketCatalysts: result.marketCatalysts,
                  regionalDivergence: result.regionalDivergence,
                  narrativeShifts: result.narrativeShifts,
                  firstMovers: result.firstMovers,
                  priceAlerts: result.priceAlerts,
                  alphaSignals: result.alphaSignals,
                  unusualActivity: result.unusualActivity,
                  macroAlerts: result.macroAlerts,
                });

                return (
                  <div
                    key={result.id}
                    className="bg-surface border border-border rounded-lg overflow-hidden transition-colors hover:border-accent/50 focus-within:ring-2 focus-within:ring-accent/40"
                  >
                    <div className="p-4 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <TypeBadge type={result.reportType ?? 'report'} />
                          <span className="text-text-secondary text-xs font-mono uppercase tracking-wider">report</span>
                          {result.date && <span className="text-text-secondary text-xs font-mono">{result.date}</span>}
                          {result.macroRegime && (
                            <span
                              title={buildMacroRegimePreviewTitle(result.macroRegime, result.macroRegimeHistory)}
                              className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${macroRegimeToneClasses(result.macroRegime.classification)}`}
                            >
                              Macro regime · {formatMacroRegimePreview(result.macroRegime, result.macroRegimeHistory)}
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
                                onClick={() => requestStoryChipToggle(result.id)}
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
                              onClick={() => requestRefreshChip(result.id)}
                              disabled={refreshChipAction.disabled}
                              className="font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:text-accent hover:underline disabled:opacity-60"
                            >
                              {refreshChipAction.controlLabel ?? 'Refresh stories'}
                            </button>
                          )}
                        </div>
                        <span className="text-text-secondary text-xs font-mono">
                          {formatShortDate(result.createdAt)}
                        </span>
                      </div>
                      <Link
                        to={focusedReportHref}
                        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
                      >
                        <p className="text-text-primary text-sm font-body leading-relaxed">
                          {truncate(previewBody, 200)}
                        </p>
                        {secondaryPreview && (
                          <p className="text-xs font-body text-text-secondary leading-relaxed">
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
                        reportId={result.id}
                        chainDrilldowns={activeChains}
                        hiddenActiveChainCount={hiddenActiveChainCount}
                        previewSummary={result.eventChains?.[0]}
                        previewBody={result.body}
                        onFocusedReportHrefChange={(nextHref) =>
                          updateFocusedReportHref(result.id, fallbackFocusedReportHref, nextHref)
                        }
                        onPreviewBodyChange={(nextBody) => updateReportPreviewBody(result.id, result.body, nextBody)}
                        onLeadChainLabelChange={(nextLabel) =>
                          updateLeadChainLabel(result.id, fallbackLeadChainLabel, nextLabel)
                        }
                        onLeadChainHrefChange={(nextHref) =>
                          updateLeadChainHref(result.id, fallbackLeadChainHref, nextHref)
                        }
                        onVisibleChainCountChange={(nextCount) =>
                          updateVisibleChainCount(result.id, activeChains.length, nextCount)
                        }
                        onHeaderStoryActionChange={(nextAction) =>
                          updateStoryChipAction(result.id, fallbackStoryChipAction, nextAction)
                        }
                        onHeaderRefreshActionChange={(nextAction) =>
                          updateRefreshChipAction(result.id, fallbackRefreshChipAction, nextAction)
                        }
                        toggleVisibleChainsRequest={storyChipToggleRequests[result.id]}
                        refreshVisibleChainsRequest={refreshChipRequests[result.id]}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : null
        }
      </DataShell>
    </div>
  );
}
