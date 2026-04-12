import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { apiFetch, isApiError } from '../lib/api';
import { formatDateTime, formatDateTimeRange, sentimentTextColor } from '../lib/formatting';
import { Badge } from '../components/Badge';
import { DataShell } from '../components/DataShell';

interface SummaryEntity {
  name: string;
  aliases: string[];
  type: string;
  mentionCount: number;
  sentiment: number;
}

interface SummaryEvent {
  entityName: string;
  eventType: string;
  description: string;
  eventTime?: number | null;
  chain?: {
    previousSummary?: {
      summaryId: string;
      eventType: string;
      description: string;
      eventTime: number;
    } | null;
    nextSummary?: {
      summaryId: string;
      eventType: string;
      description: string;
      eventTime: number;
    } | null;
    rootId: string;
    position: number;
    eventCount: number;
    firstEventTime: number;
    latestEventTime: number;
    eventTypes: string[];
  } | null;
}

interface FullSummary {
  id: string;
  source: string;
  sourceId: string;
  windowStart: number;
  windowEnd: number;
  sentiment: number | null;
  urgency: 'routine' | 'elevated' | 'breaking' | null;
  itemCount: number;
  createdAt: number;
  text: string;
  confidence: number | null;
  keyEvents: string[];
  entities: SummaryEntity[];
  events: SummaryEvent[];
}

const SOURCE_COLORS: Record<string, string> = {
  discord: 'bg-accent/20 text-accent',
  twitter: 'bg-accent-orange/20 text-accent-orange',
  rss: 'bg-accent-green/20 text-accent-green',
  news: 'bg-border text-text-secondary',
};

const URGENCY_COLORS: Record<string, string> = {
  routine: 'bg-border text-text-secondary',
  elevated: 'bg-accent/20 text-accent',
  breaking: 'bg-accent-red/20 text-accent-red',
};

function formatLinkedChainLabel(position: number, eventCount: number): string {
  return `Event ${position} of ${eventCount} in linked chain`;
}

function buildSummaryChainHref(summaryId: string, chainRootId: string): string {
  const params = new URLSearchParams({ chain: chainRootId });
  return `/summaries/${summaryId}?${params.toString()}`;
}

function ChainSummaryLink({
  label,
  summary,
  chainRootId,
}: {
  label: string;
  summary: NonNullable<NonNullable<SummaryEvent['chain']>['previousSummary']>;
  chainRootId: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-3 space-y-1">
      <Link
        to={buildSummaryChainHref(summary.summaryId, chainRootId)}
        className="text-xs font-mono uppercase tracking-wider text-accent hover:underline"
      >
        {label}
      </Link>
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary">
        {summary.eventType} | {formatDateTime(summary.eventTime)}
      </div>
      <div className="text-sm text-text-primary font-body leading-relaxed">{summary.description}</div>
    </div>
  );
}

export function SummaryView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const requestKey = id ?? '';
  const [summary, setSummary] = useState<FullSummary | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focusedChainRootId = searchParams.get('chain')?.trim() ?? '';

  useEffect(() => {
    if (!id) {
      return;
    }

    let cancelled = false;

    apiFetch<{ summary: FullSummary }>(`/summaries/${id}`)
      .then((res) => {
        if (!cancelled) {
          setSummary(res.summary);
          setError(null);
          setLoadedKey(id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setSummary(null);
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
  }, [id]);

  const loading = Boolean(id) && loadedKey !== requestKey;

  return (
    <DataShell
      loading={loading}
      error={error ? `Error: ${error}` : null}
      data={summary}
      skeleton={<div className="p-6 text-text-secondary font-body">Loading...</div>}
      emptyTitle="Summary not found"
      emptyDescription="This summary is no longer available."
    >
      {(loadedSummary) => {
        const summary = loadedSummary;
        const focusedChainEventCount =
          focusedChainRootId.length > 0
            ? summary.events.filter((event) => event.chain?.rootId === focusedChainRootId).length
            : 0;
        const hasFocusedChain = focusedChainEventCount > 0;

        return (
          <div className="p-6 max-w-4xl mx-auto space-y-8">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge label={summary.source} colorClass={SOURCE_COLORS[summary.source]} uppercase />
                <Badge
                  label={summary.urgency ?? 'unknown'}
                  colorClass={URGENCY_COLORS[summary.urgency ?? 'unknown']}
                  uppercase
                />
                <span className="font-mono text-xs text-text-secondary uppercase tracking-wider">Summary</span>
              </div>
              <span className="font-mono text-xs text-text-secondary">{formatDateTime(summary.createdAt)}</span>
            </div>

            <blockquote className="font-heading text-xl leading-relaxed text-text-primary border-l-2 border-accent pl-6 py-2">
              {summary.text}
            </blockquote>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Source</div>
                <div className="text-sm text-text-primary font-body break-all">{summary.sourceId}</div>
              </div>
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Window</div>
                <div className="text-sm text-text-primary font-body leading-relaxed">
                  {formatDateTimeRange(summary.windowStart, summary.windowEnd)}
                </div>
              </div>
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Signals</div>
                <div className="text-sm text-text-primary font-body leading-relaxed">
                  {summary.itemCount} item{summary.itemCount !== 1 ? 's' : ''}
                  {summary.confidence != null && ` | confidence ${summary.confidence}/10`}
                  {summary.sentiment != null && (
                    <>
                      {' '}
                      | sentiment{' '}
                      <span className={sentimentTextColor(summary.sentiment)}>
                        {summary.sentiment > 0 ? '+' : ''}
                        {summary.sentiment.toFixed(2)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {summary.keyEvents.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Key Events</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {summary.keyEvents.map((event, index) => (
                    <div
                      key={index}
                      className="bg-surface border border-border rounded-lg p-4 text-sm text-text-primary"
                    >
                      {event}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.entities.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Entities</h2>
                <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {summary.entities.map((entity) => (
                    <div
                      key={`${entity.name}:${entity.type}`}
                      className="px-4 py-3 flex items-start justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="text-sm text-text-primary font-body">
                          {entity.name}{' '}
                          <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
                            {entity.type}
                          </span>
                        </div>
                        <div className="text-xs text-text-secondary font-body">
                          {entity.mentionCount} mention{entity.mentionCount !== 1 ? 's' : ''}
                          {entity.aliases.length > 0 && ` | aliases: ${entity.aliases.join(', ')}`}
                        </div>
                      </div>
                      <div className={`text-xs font-mono ${sentimentTextColor(entity.sentiment)}`}>
                        {entity.sentiment > 0 ? '+' : ''}
                        {entity.sentiment.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.events.length > 0 && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">
                  Extracted Events
                </h2>
                {hasFocusedChain ? (
                  <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 space-y-1">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-accent">Focused Chain</div>
                    <div className="text-sm text-text-primary font-body leading-relaxed">
                      Highlighting {focusedChainEventCount} linked event{focusedChainEventCount !== 1 ? 's' : ''} in
                      this summary chain so cross-summary navigation stays anchored to the same story.
                    </div>
                  </div>
                ) : null}
                <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {summary.events.map((event, index) => {
                    const isFocusedChainEvent = event.chain?.rootId === focusedChainRootId;

                    return (
                      <div
                        key={`${event.entityName}:${event.eventType}:${index}`}
                        className={`px-4 py-3 space-y-1 ${isFocusedChainEvent ? 'bg-accent/5 ring-1 ring-inset ring-accent/30' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="text-xs font-mono uppercase tracking-wider text-text-secondary">
                            {event.eventType} | {event.entityName}
                            {isFocusedChainEvent ? (
                              <span className="ml-2 rounded bg-accent/15 px-2 py-0.5 text-[10px] text-accent">
                                Focused chain
                              </span>
                            ) : null}
                          </div>
                          {typeof event.eventTime === 'number' ? (
                            <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary">
                              {formatDateTime(event.eventTime)}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-sm text-text-primary font-body leading-relaxed">{event.description}</div>
                        {event.chain ? (
                          <div className="space-y-2">
                            <div className="text-xs text-text-secondary font-body leading-relaxed">
                              {formatLinkedChainLabel(event.chain.position, event.chain.eventCount)}
                              {' | '}
                              {event.chain.eventTypes.join(' -> ')}
                              {' | '}
                              {formatDateTimeRange(event.chain.firstEventTime, event.chain.latestEventTime)}
                            </div>
                            {(event.chain.previousSummary || event.chain.nextSummary) && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {event.chain.previousSummary ? (
                                  <ChainSummaryLink
                                    label="Previous summary in chain"
                                    summary={event.chain.previousSummary}
                                    chainRootId={event.chain.rootId}
                                  />
                                ) : null}
                                {event.chain.nextSummary ? (
                                  <ChainSummaryLink
                                    label="Next summary in chain"
                                    summary={event.chain.nextSummary}
                                    chainRootId={event.chain.rootId}
                                  />
                                ) : null}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      }}
    </DataShell>
  );
}
