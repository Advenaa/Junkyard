import { memo, useState } from 'react';
import { EntityLink } from '../../../components/EntityLink';
import type { AlphaWatchEntry, AlphaWatchOverview } from '../types';
import { ALPHA_WATCH_PREVIEW_LIMIT } from '../types';
import {
  alphaTierToneClasses,
  formatAlphaWatchNarrative,
  formatCompactDuration,
  formatDateTime,
  formatSourceTierLabel,
} from '../formatters';

interface AlphaWatchSectionProps {
  alphaWatch: AlphaWatchOverview | null;
  alphaWatchEntries: AlphaWatchEntry[];
}

export const AlphaWatchSection = memo(function AlphaWatchSection({
  alphaWatch,
  alphaWatchEntries,
}: AlphaWatchSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (alphaWatchEntries.length === 0) {
    return null;
  }

  const hasOverflow = alphaWatchEntries.length > ALPHA_WATCH_PREVIEW_LIMIT;
  const visibleEntries = expanded ? alphaWatchEntries : alphaWatchEntries.slice(0, ALPHA_WATCH_PREVIEW_LIMIT);
  const hiddenCount = alphaWatchEntries.length - ALPHA_WATCH_PREVIEW_LIMIT;

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Alpha Watch</h2>
          <p className="text-text-secondary/70 text-sm font-body mt-1">
            Recent higher-tier mentions and downstream spread. Detailed per-entity tier timelines remain in Settings
            &gt; Entities.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className="px-2 py-1 rounded bg-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
            {alphaWatch?.latestTimestamp ? formatDateTime(alphaWatch.latestTimestamp) : 'latest'}
          </span>
          <span className="px-2 py-1 rounded bg-accent/10 text-accent border border-accent/20 text-[11px] font-mono uppercase tracking-wide">
            {alphaWatch?.entries.length ?? alphaWatchEntries.length} tracked
          </span>
        </div>
      </div>

      <div className="p-4 grid gap-3 md:grid-cols-3">
        {visibleEntries.map((entry) => (
          <div key={entry.entityId} className="rounded-lg border border-border bg-background p-3 space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-body leading-snug">
                <EntityLink entityId={entry.entityId} displayName={entry.entityName} />
              </h3>
              <p className="text-text-secondary/70 text-sm font-body leading-relaxed">
                {formatAlphaWatchNarrative(entry)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs font-mono">
              <span
                className={`px-2 py-1 rounded border text-[11px] uppercase tracking-wide ${alphaTierToneClasses(entry.firstSignalTier)}`}
              >
                first {formatSourceTierLabel(entry.firstSignalTier)}
              </span>
              {entry.tierCount > 1 && (
                <span
                  className={`px-2 py-1 rounded border text-[11px] uppercase tracking-wide ${alphaTierToneClasses(entry.latestTier)}`}
                >
                  now {formatSourceTierLabel(entry.latestTier)}
                </span>
              )}
              {entry.propagationLagMs != null && (
                <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                  spread {formatCompactDuration(entry.propagationLagMs)}
                </span>
              )}
              <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                {entry.tierCount} tier{entry.tierCount === 1 ? '' : 's'}
              </span>
              <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                {entry.sourceCount} source{entry.sourceCount === 1 ? '' : 's'}
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
});
