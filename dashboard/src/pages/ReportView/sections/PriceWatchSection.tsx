import type { DisabledFeatureSummary } from '../../../lib/types';
import { FeatureDisabledCard } from '../../../components/FeatureDisabledCard';
import type { PriceWatchEntry, PriceWatchOverview } from '../types';
import {
  formatCompactNumber,
  formatDateTime,
  formatPriceChange,
  formatPriceContrarianNarrative,
  formatPriceValue,
  priceChangeToneClasses,
  priceContrarianClasses,
} from '../formatters';

interface PriceWatchSectionProps {
  pricesDisabled: boolean;
  disabledPrices: DisabledFeatureSummary | null;
  priceWatch: PriceWatchOverview | null;
  priceEntries: PriceWatchEntry[];
}

export function PriceWatchSection({
  pricesDisabled,
  disabledPrices,
  priceWatch,
  priceEntries,
}: PriceWatchSectionProps) {
  return (
    <>
      {pricesDisabled && disabledPrices ? (
        <FeatureDisabledCard
          feature={disabledPrices}
          title="Price Watch"
          description="Price feeds are currently disabled — token moves and contrarian signals are not available."
        />
      ) : null}

      {!pricesDisabled && priceEntries.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
            <div>
              <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Price Watch</h2>
              <p className="text-text-secondary/70 text-sm font-body mt-1">
                Latest tracked token moves with sentiment context. Detailed per-entity history remains in Settings &gt;
                Entities.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="px-2 py-1 rounded bg-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
                {priceWatch?.latestTimestamp ? formatDateTime(priceWatch.latestTimestamp) : 'latest'}
              </span>
              <span className="px-2 py-1 rounded bg-accent/10 text-accent border border-accent/20 text-[11px] font-mono uppercase tracking-wide">
                {priceWatch?.entries.length ?? priceEntries.length} tracked
              </span>
            </div>
          </div>

          <div className="p-4 grid gap-3 md:grid-cols-3">
            {priceEntries.map((entry) => (
              <div key={entry.entityId} className="rounded-lg border border-border bg-background p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-text-primary text-sm font-body leading-snug">{entry.entityName}</h3>
                    <p className="text-text-primary text-lg font-mono">${formatPriceValue(entry.priceUsd)}</p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${priceChangeToneClasses(entry.priceChange24h)}`}
                  >
                    {formatPriceChange(entry.priceChange24h, '24h')}
                  </span>
                </div>

                <p className="text-text-secondary/80 text-sm font-body leading-relaxed">
                  {formatPriceContrarianNarrative(entry)}
                </p>

                <div className="flex flex-wrap gap-2 text-xs font-mono">
                  <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                    {formatPriceChange(entry.priceChange7d, '7d')}
                  </span>
                  {entry.contrarianSignal && (
                    <span
                      className={`px-2 py-1 rounded border text-[11px] uppercase tracking-wide ${priceContrarianClasses(entry.contrarianSignal)}`}
                    >
                      Contrarian
                    </span>
                  )}
                  {entry.avgSentiment != null && (
                    <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                      sentiment {entry.avgSentiment > 0 ? '+' : ''}
                      {entry.avgSentiment.toFixed(2)}
                    </span>
                  )}
                  {entry.volume24h != null && (
                    <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                      vol ${formatCompactNumber(entry.volume24h)}
                    </span>
                  )}
                  {entry.marketCap != null && (
                    <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                      mcap ${formatCompactNumber(entry.marketCap)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
