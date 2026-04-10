import type { UnusualActivityEntry, UnusualActivityOverview } from '../types';
import {
  formatSignedFixed,
  formatUnusualActivityNarrative,
  formatUnusualActivityRatio,
  formatUnusualActivityRelevance,
  unusualActivityBadgeClasses,
} from '../formatters';

interface UnusualActivitySectionProps {
  unusualActivity: UnusualActivityOverview | null;
  unusualEntries: UnusualActivityEntry[];
}

export function UnusualActivitySection({ unusualActivity, unusualEntries }: UnusualActivitySectionProps) {
  if (unusualEntries.length === 0) {
    return null;
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Unusual Activity</h2>
          <p className="text-text-secondary/70 text-sm font-body mt-1">
            Latest daily mention spikes and copy-cluster breakouts. Full heuristic detail remains in Settings &gt;
            Pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className="px-2 py-1 rounded bg-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
            {unusualActivity?.latestDate ?? 'latest'}
          </span>
          <span className="px-2 py-1 rounded bg-accent/10 text-accent border border-accent/20 text-[11px] font-mono uppercase tracking-wide">
            {unusualActivity?.entries.length ?? unusualEntries.length} flagged
          </span>
        </div>
      </div>

      <div className="p-4 grid gap-3 md:grid-cols-3">
        {unusualEntries.map((entry) => (
          <div key={entry.entityId} className="rounded-lg border border-border bg-background p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-text-primary text-sm font-body leading-snug">{entry.entityName}</h3>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${unusualActivityBadgeClasses(entry)}`}
              >
                {formatUnusualActivityRatio(entry.spikeRatio)}
              </span>
            </div>

            <p className="text-text-secondary/80 text-sm font-body leading-relaxed">
              {formatUnusualActivityNarrative(entry)}
            </p>

            <div className="flex flex-wrap gap-2 text-xs font-mono">
              <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                today {entry.mentionCount} mentions
              </span>
              {entry.lowRelevance && (
                <span className="px-2 py-1 rounded bg-surface border border-border text-yellow-300">
                  low relevance {formatUnusualActivityRelevance(entry.relevanceScore)}
                </span>
              )}
              {entry.duplicateClusterSize != null && (
                <span className="px-2 py-1 rounded bg-surface border border-border text-yellow-300">
                  copy cluster {entry.duplicateClusterSize} posts
                </span>
              )}
              {entry.avgSentiment != null && (
                <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                  sentiment {formatSignedFixed(entry.avgSentiment)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
