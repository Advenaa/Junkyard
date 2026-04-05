import { useState, useEffect } from 'react';
import { useParams } from 'react-router';
import { apiFetch } from '../lib/api';
import type { Report } from '../lib/types';
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

function SentimentBar({ entity }: { entity: EntitySentiment }) {
  const pct = Math.abs(entity.sentiment) * 50;
  const isPositive = entity.sentiment >= 0;

  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-28 text-sm text-text-primary font-body truncate">
        {entity.name}
      </span>
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
        {entity.sentiment > 0 ? '+' : ''}{entity.sentiment.toFixed(2)}
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
  const [report, setReport] = useState<FullReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

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
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="p-6 text-text-secondary font-body">Loading...</div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-accent-red font-body">Error: {error}</div>
    );
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

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TypeBadge type={report.type} />
          <span className="font-mono text-xs text-text-secondary uppercase tracking-wider">
            Report
          </span>
        </div>
        <span className="font-mono text-xs text-text-secondary">
          {formatDate(report.date)}
        </span>
      </div>

      {/* TL;DR Hero */}
      <blockquote className="font-heading text-xl leading-relaxed text-text-primary border-l-2 border-accent pl-6 py-2">
        {report.tldr}
      </blockquote>

      {/* Key Events */}
      {report.keyEvents && report.keyEvents.length > 0 && (
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">
            Key Events
          </h2>
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
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">
            Sections
          </h2>
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
