import { useState } from 'react';
import type { FirstMoverWatchlistEntry, FirstMoverWatchlistOverview } from '../types';
import { FIRST_MOVER_PREVIEW_LIMIT } from '../types';
import {
  formatDateTime,
  formatFirstMoverAuthor,
  formatFirstMoverClaimType,
  formatFirstMoverLeadWindow,
} from '../formatters';

interface FirstMoverSectionProps {
  firstMoverWatchlist: FirstMoverWatchlistOverview | null;
  firstMoverEntries: FirstMoverWatchlistEntry[];
}

export function FirstMoverSection({ firstMoverWatchlist, firstMoverEntries }: FirstMoverSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (firstMoverEntries.length === 0) {
    return null;
  }

  const hasOverflow = firstMoverEntries.length > FIRST_MOVER_PREVIEW_LIMIT;
  const visibleEntries = expanded ? firstMoverEntries : firstMoverEntries.slice(0, FIRST_MOVER_PREVIEW_LIMIT);
  const hiddenCount = firstMoverEntries.length - FIRST_MOVER_PREVIEW_LIMIT;

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">First Mover Watch</h2>
          <p className="text-text-secondary/70 text-sm font-body mt-1">
            Recent tracked first calls from monitored authors. Detailed author timing remains in Settings &gt; Entities.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className="px-2 py-1 rounded bg-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
            {firstMoverWatchlist?.latestTimestamp ? formatDateTime(firstMoverWatchlist.latestTimestamp) : 'latest'}
          </span>
          <span className="px-2 py-1 rounded bg-accent/10 text-accent border border-accent/20 text-[11px] font-mono uppercase tracking-wide">
            {firstMoverWatchlist?.entries.length ?? firstMoverEntries.length} recent
          </span>
        </div>
      </div>

      <div className="p-4 grid gap-3 md:grid-cols-3">
        {visibleEntries.map((entry) => (
          <div
            key={`${entry.entityId}:${entry.authorId}:${entry.timestamp}`}
            className="rounded-lg border border-border bg-background p-3 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-text-primary text-sm font-body leading-snug">{entry.entityName}</h3>
                <p className="text-text-secondary/70 text-sm font-body leading-relaxed">
                  First tracked by {formatFirstMoverAuthor(entry)}.
                </p>
              </div>
              <span className="px-2 py-0.5 rounded bg-surface border border-border text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                {formatFirstMoverClaimType(entry.claimType)}
              </span>
            </div>

            <p className="text-text-primary text-sm font-body leading-relaxed">"{entry.claimText}"</p>

            <div className="flex flex-wrap gap-2 text-xs font-mono">
              <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                {entry.platform}
              </span>
              <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                {formatDateTime(entry.timestamp)}
              </span>
              <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                {formatFirstMoverLeadWindow(entry)}
              </span>
            </div>
          </div>
        ))}
      </div>
      {hasOverflow && (
        <div className="px-4 pb-4 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="font-mono text-[11px] uppercase tracking-wider text-text-secondary hover:text-accent hover:underline"
          >
            {expanded ? 'Show fewer' : `+${hiddenCount} more`}
          </button>
        </div>
      )}
    </div>
  );
}
