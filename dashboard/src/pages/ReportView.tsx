import { useState, useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { apiFetch } from '../lib/api';
import type { Report, ReportChainDrilldown } from '../lib/types';
import { buildFocusedReportHref, buildSummaryChainHref } from '../lib/reportChains';
import { TypeBadge } from '../components/TypeBadge';
import { EmptyState } from '../components/EmptyState';

interface EntitySentiment {
  name: string;
  sentiment: number;
  reason: string;
}

interface Section {
  title: string;
  body: string;
}

interface FullReport extends Report {
  body: string | null;
  keyEvents: string[];
  marketCatalysts: string[];
  eventChains: string[];
  chainDrilldowns?: ReportChainDrilldown[];
  entitySentiment: EntitySentiment[];
  sections: Section[];
}

function sentimentColor(val: number): string {
  if (val >= 0.3) return 'bg-accent-green';
  if (val <= -0.3) return 'bg-accent-red';
  return 'bg-[#888899]';
}

function sentimentTextColor(val: number): string {
  if (val >= 0.3) return 'text-accent-green';
  if (val <= -0.3) return 'text-accent-red';
  return 'text-[#888899]';
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRange(start: number, end: number): string {
  return `${formatDateTime(start)} - ${formatDateTime(end)}`;
}

function SentimentBar({ entity }: { entity: EntitySentiment }) {
  const pct = Math.abs(entity.sentiment) * 50;
  const isPositive = entity.sentiment >= 0;

  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-28 text-sm text-text-primary font-body truncate">{entity.name}</span>
      <div className="flex-1 h-2 bg-surface-raised rounded-full relative overflow-hidden">
        <div className="absolute inset-0 flex">
          <div className="w-1/2 flex justify-end">
            {!isPositive && (
              <div
                className={`h-full ${sentimentColor(entity.sentiment)} rounded-l-full`}
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
          <div className="w-px bg-border" />
          <div className="w-1/2">
            {isPositive && (
              <div
                className={`h-full ${sentimentColor(entity.sentiment)} rounded-r-full`}
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
        </div>
      </div>
      <span className={`w-12 text-right font-mono text-xs ${sentimentTextColor(entity.sentiment)}`}>
        {entity.sentiment > 0 ? '+' : ''}
        {entity.sentiment.toFixed(2)}
      </span>
    </div>
  );
}

function CollapsibleSection({ section }: { section: Section }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-raised transition-colors"
      >
        <span className="font-heading text-sm text-text-primary">{section.title}</span>
        <span className="text-text-secondary text-xs">{open ? '\u25BC' : '\u25B6'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-text-secondary text-sm font-body leading-relaxed whitespace-pre-wrap">
          {section.body}
        </div>
      )}
    </div>
  );
}

export function ReportView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const requestKey = id ?? '__latest__';
  const [report, setReport] = useState<FullReport | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
