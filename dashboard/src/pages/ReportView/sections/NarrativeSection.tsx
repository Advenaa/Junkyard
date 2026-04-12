import { memo } from 'react';
import type { DisabledFeatureSummary } from '../../../lib/types';
import { FeatureDisabledCard } from '../../../components/FeatureDisabledCard';
import type { NarrativeWatchlistEntry, NarrativeWatchlistOverview } from '../types';
import { formatNarrativeSentiment, formatNarrativeSignalLabel, narrativeSignalClasses } from '../formatters';

interface NarrativeSectionProps {
  embeddingsDisabled: boolean;
  disabledEmbeddings: DisabledFeatureSummary | null;
  narratives: NarrativeWatchlistOverview | null;
  narrativeEntries: NarrativeWatchlistEntry[];
}

export const NarrativeSection = memo(function NarrativeSection({
  embeddingsDisabled,
  disabledEmbeddings,
  narratives,
  narrativeEntries,
}: NarrativeSectionProps) {
  return (
    <>
      {embeddingsDisabled && disabledEmbeddings ? (
        <FeatureDisabledCard
          feature={disabledEmbeddings}
          title="Narrative Snapshot"
          description="Narrative clustering is currently disabled — embeddings are required to group related summaries."
        />
      ) : null}

      {!embeddingsDisabled && narrativeEntries.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
            <div>
              <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Narrative Snapshot</h2>
              <p className="text-text-secondary/70 text-sm font-body mt-1">
                Latest clustered themes from the daily embedding pass. Detailed evidence remains in Settings &gt;
                Pipeline.
              </p>
            </div>
            <span className="px-2 py-1 rounded bg-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
              {narratives?.latestDate ?? 'latest'}
            </span>
          </div>

          <div className="p-4 grid gap-3 md:grid-cols-3">
            {narrativeEntries.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border bg-background p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-text-primary text-sm font-body leading-snug">{entry.name}</h3>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${narrativeSignalClasses(entry.signalStrength)}`}
                  >
                    {formatNarrativeSignalLabel(entry.signalStrength)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 text-xs font-mono">
                  <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                    {entry.memberCount} summaries
                  </span>
                  <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                    {formatNarrativeSentiment(entry.avgSentiment)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
});
