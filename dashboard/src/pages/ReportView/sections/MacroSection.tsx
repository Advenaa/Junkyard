import type { DisabledFeatureSummary } from '../../../lib/types';
import { FeatureDisabledCard } from '../../../components/FeatureDisabledCard';
import type { MacroOverview, MacroOverviewEntry } from '../types';
import { formatMacroChange, formatMacroValue, macroToneClasses } from '../formatters';

interface MacroSectionProps {
  macroDisabled: boolean;
  disabledMacro: DisabledFeatureSummary | null;
  macroOverview: MacroOverview | null;
  macroEntries: MacroOverviewEntry[];
}

export function MacroSection({ macroDisabled, disabledMacro, macroOverview, macroEntries }: MacroSectionProps) {
  return (
    <>
      {macroDisabled && disabledMacro ? (
        <FeatureDisabledCard
          feature={disabledMacro}
          title="Macro Backdrop"
          description="Macro snapshots are currently disabled — the risk-on/risk-off backdrop surface is not available."
        />
      ) : null}

      {!macroDisabled && macroEntries.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
            <div>
              <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Macro Backdrop</h2>
              <p className="text-text-secondary/70 text-sm font-body mt-1">
                Latest FRED snapshots frame the broader tape behind this report. Full indicator detail remains in
                Settings &gt; Pipeline.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="px-2 py-1 rounded bg-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
                {macroOverview?.latestDate ?? 'latest'}
              </span>
              <span
                aria-label={`Overall macro bias ${macroOverview?.overallBias ?? 'mixed'}`}
                className={`px-2 py-1 rounded text-[11px] font-mono uppercase tracking-wide ${macroToneClasses(macroOverview?.overallBias ?? 'mixed')}`}
              >
                {macroOverview?.overallBias ?? 'mixed'}
              </span>
            </div>
          </div>

          <div className="p-4 grid gap-3 md:grid-cols-3">
            {macroEntries.map((entry) => (
              <div key={entry.indicator} className="rounded-lg border border-border bg-background p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-text-primary text-sm font-body leading-snug">{entry.label}</h3>
                    <p className="text-text-secondary/70 text-sm font-body mt-1">{entry.narrative}</p>
                  </div>
                  <span
                    aria-label={`${entry.label} macro signal ${entry.signal}`}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${macroToneClasses(entry.signal)}`}
                  >
                    {entry.signal}
                  </span>
                </div>

                <p className="text-text-primary text-xl font-mono">{formatMacroValue(entry)}</p>

                <div className="flex flex-wrap gap-2 text-xs font-mono">
                  <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                    1d {formatMacroChange(entry.change1d, entry.indicator)}
                  </span>
                  <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                    7d {formatMacroChange(entry.change7d, entry.indicator)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
