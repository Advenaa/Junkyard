import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { apiFetch } from '../lib/api';
import { EmptyState } from '../components/EmptyState';

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

function SourceBadge({ source }: { source: string }) {
  const color = SOURCE_COLORS[source] ?? 'bg-border text-text-secondary';
  return <span className={`px-2 py-0.5 rounded text-xs font-mono uppercase ${color}`}>{source}</span>;
}

function UrgencyBadge({ urgency }: { urgency: string | null }) {
  const value = urgency ?? 'unknown';
  const color = URGENCY_COLORS[value] ?? 'bg-border text-text-secondary';
  return <span className={`px-2 py-0.5 rounded text-xs font-mono uppercase ${color}`}>{value}</span>;
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

function sentimentClass(sentiment: number): string {
  if (sentiment >= 0.3) return 'text-accent-green';
  if (sentiment <= -0.3) return 'text-accent-red';
  return 'text-text-secondary';
}

export function SummaryView() {
  const { id } = useParams<{ id: string }>();
  const requestKey = id ?? '';
  const [summary, setSummary] = useState<FullSummary | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        if (!cancelled) {
          setSummary(null);
          setError(err.message);
          setLoadedKey(id);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const loading = Boolean(id) && loadedKey !== requestKey;

  if (loading) {
    return <div className="p-6 text-text-secondary font-body">Loading...</div>;
  }

  if (error) {
    return <div className="p-6 text-accent-red font-body">Error: {error}</div>;
  }

  if (!summary) {
    return (
      <div className="p-6">
        <EmptyState title="Summary not found" description="This summary is no longer available." />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <SourceBadge source={summary.source} />
          <UrgencyBadge urgency={summary.urgency} />
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
            {formatRange(summary.windowStart, summary.windowEnd)}
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
                <span className={sentimentClass(summary.sentiment)}>
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
              <div key={index} className="bg-surface border border-border rounded-lg p-4 text-sm text-text-primary">
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
              <div key={`${entity.name}:${entity.type}`} className="px-4 py-3 flex items-start justify-between gap-4">
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
                <div className={`text-xs font-mono ${sentimentClass(entity.sentiment)}`}>
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
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Extracted Events</h2>
          <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
            {summary.events.map((event, index) => (
              <div key={`${event.entityName}:${event.eventType}:${index}`} className="px-4 py-3 space-y-1">
                <div className="text-xs font-mono uppercase tracking-wider text-text-secondary">
                  {event.eventType} | {event.entityName}
                </div>
                <div className="text-sm text-text-primary font-body leading-relaxed">{event.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
