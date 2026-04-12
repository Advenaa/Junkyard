import { memo } from 'react';
import type { RegionalDivergenceEntry } from '../types';
import { REGIONAL_DIVERGENCE_DAYS } from '../types';
import {
  formatRegionalDivergenceLabel,
  formatRegionalDivergenceNarrative,
  formatRegionalSentimentTone,
  formatSignedFixed,
  regionalDivergenceBadgeClasses,
  regionalSentimentTone,
  regionalSentimentToneClasses,
} from '../formatters';

interface RegionalDivergenceSectionProps {
  regionalDivergences: RegionalDivergenceEntry[] | null;
  regionalDivergenceEntries: RegionalDivergenceEntry[];
}

export const RegionalDivergenceSection = memo(function RegionalDivergenceSection({
  regionalDivergences,
  regionalDivergenceEntries,
}: RegionalDivergenceSectionProps) {
  if (regionalDivergenceEntries.length === 0) {
    return null;
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Regional Divergence</h2>
          <p className="text-text-secondary/70 text-sm font-body mt-1">
            Largest EN vs ID sentiment gaps from the trailing 7d window. Full per-entity detail remains in Settings &gt;
            Entities.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className="px-2 py-1 rounded bg-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
            {REGIONAL_DIVERGENCE_DAYS}d window
          </span>
          <span className="px-2 py-1 rounded bg-accent/10 text-accent border border-accent/20 text-[11px] font-mono uppercase tracking-wide">
            {regionalDivergences?.length ?? regionalDivergenceEntries.length} tracked
          </span>
        </div>
      </div>

      <div className="p-4 grid gap-3 md:grid-cols-3">
        {regionalDivergenceEntries.map((entry) => {
          const engTone = regionalSentimentTone(entry.engSentiment);
          const indTone = regionalSentimentTone(entry.indSentiment);

          return (
            <div key={entry.entityId} className="rounded-lg border border-border bg-background p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-text-primary text-sm font-body leading-snug">{entry.entityName}</h3>
                  <p className="text-text-secondary/70 text-sm font-body leading-relaxed">
                    {formatRegionalDivergenceNarrative(entry)}
                  </p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${regionalDivergenceBadgeClasses(entry.divergence)}`}
                >
                  {formatRegionalDivergenceLabel(entry.divergence)}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 text-xs font-mono">
                <span
                  className={`px-2 py-1 rounded border ${regionalSentimentToneClasses(engTone)}`}
                >{`EN ${entry.engSentiment == null ? 'n/a' : formatSignedFixed(entry.engSentiment)} (${entry.engMentions})`}</span>
                <span
                  className={`px-2 py-1 rounded border ${regionalSentimentToneClasses(indTone)}`}
                >{`ID ${entry.indSentiment == null ? 'n/a' : formatSignedFixed(entry.indSentiment)} (${entry.indMentions})`}</span>
                <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                  gap {entry.divergence.toFixed(2)}
                </span>
                <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                  {`EN ${formatRegionalSentimentTone(engTone)} / ID ${formatRegionalSentimentTone(indTone)}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
