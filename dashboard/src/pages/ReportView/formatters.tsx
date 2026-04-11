import { useState } from 'react';
import type {
  AlphaWatchEntry,
  CalendarEventCategory,
  CalendarEventRecurrence,
  EntitySentiment,
  FirstMoverWatchlistEntry,
  MacroBias,
  MacroIndicator,
  MacroOverviewEntry,
  MacroSignal,
  NarrativeSignalStrength,
  PriceContrarianSignal,
  PriceWatchEntry,
  RegionalDivergenceEntry,
  RegionalSentimentTone,
  Section,
  SourceTier,
  UnusualActivityEntry,
} from './types';
import { REGIONAL_DIVERGENCE_DAYS } from './types';

export function sentimentColor(val: number): string {
  if (val >= 0.3) return 'bg-accent-green';
  if (val <= -0.3) return 'bg-accent-red';
  return 'bg-[#888899]';
}

export function sentimentTextColor(val: number): string {
  if (val >= 0.3) return 'text-accent-green';
  if (val <= -0.3) return 'text-accent-red';
  return 'text-[#888899]';
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRange(start: number, end: number): string {
  return `${formatDateTime(start)} - ${formatDateTime(end)}`;
}

export function formatNarrativeSignalLabel(signalStrength: NarrativeSignalStrength): string {
  switch (signalStrength) {
    case 'new':
      return 'New';
    case 'emerging':
      return 'Emerging';
    case 'strong':
      return 'Strong';
    case 'stable':
      return 'Stable';
    case 'fading':
      return 'Fading';
  }
}

export function narrativeSignalClasses(signalStrength: NarrativeSignalStrength): string {
  switch (signalStrength) {
    case 'new':
      return 'bg-accent/15 text-accent border border-accent/20';
    case 'emerging':
      return 'bg-accent-green/15 text-accent-green border border-accent-green/20';
    case 'strong':
      return 'bg-accent-orange/15 text-accent-orange border border-accent-orange/20';
    case 'stable':
      return 'bg-border text-text-secondary border border-border';
    case 'fading':
      return 'bg-accent-red/15 text-accent-red border border-accent-red/20';
  }
}

export function formatNarrativeSentiment(sentiment: number | null): string {
  if (sentiment == null) {
    return 'sentiment n/a';
  }
  return `sentiment ${sentiment > 0 ? '+' : ''}${sentiment.toFixed(2)}`;
}

export function macroToneClasses(tone: MacroBias | MacroSignal): string {
  switch (tone) {
    case 'risk-on':
      return 'bg-accent-green/15 text-accent-green border border-accent-green/25';
    case 'risk-off':
      return 'bg-accent-red/15 text-accent-red border border-accent-red/25';
    case 'neutral':
    case 'mixed':
    default:
      return 'bg-background text-text-secondary border border-border';
  }
}

export function formatMacroValue(entry: MacroOverviewEntry): string {
  if (entry.indicator === 'spx') {
    return entry.value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return entry.value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatMacroChange(value: number | null, indicator: MacroIndicator): string {
  if (value == null) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString('en-US', {
    minimumFractionDigits: indicator === 'spx' ? 0 : 2,
    maximumFractionDigits: indicator === 'spx' ? 0 : 2,
  })}`;
}

export function formatCompactNumber(num: number): string {
  if (!Number.isFinite(num)) {
    return 'n/a';
  }
  if (Math.abs(num) >= 1_000_000_000_000) return `${(num / 1_000_000_000_000).toFixed(2)}T`;
  if (Math.abs(num) >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

export function formatPriceValue(priceUsd: number): string {
  return priceUsd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: priceUsd < 1 ? 6 : 2,
  });
}

export function formatPriceChange(value: number | null, label: '24h' | '7d'): string {
  if (value == null) return `${label} n/a`;
  const sign = value > 0 ? '+' : '';
  return `${label} ${sign}${value.toFixed(1)}%`;
}

export function priceChangeToneClasses(value: number | null): string {
  if (value == null) {
    return 'bg-background text-text-secondary border border-border';
  }
  return value >= 0
    ? 'bg-accent-green/15 text-accent-green border border-accent-green/25'
    : 'bg-accent-red/15 text-accent-red border border-accent-red/25';
}

export function priceContrarianClasses(signal: PriceContrarianSignal): string {
  return signal === 'price-up-sentiment-down'
    ? 'bg-accent/10 text-accent border border-accent/20'
    : 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25';
}

export function formatPriceContrarianNarrative(entry: PriceWatchEntry): string {
  if (entry.contrarianSignal === 'price-up-sentiment-down') {
    return 'Price is pushing higher while tracked sentiment still leans bearish.';
  }
  if (entry.contrarianSignal === 'price-down-sentiment-up') {
    return 'Price is fading even though tracked sentiment still leans bullish.';
  }
  if (entry.momentum != null) {
    const sign = entry.momentum > 0 ? '+' : '';
    return `Sentiment momentum ${sign}${entry.momentum.toFixed(2)} on the latest daily rollup.`;
  }
  if (entry.avgSentiment != null) {
    const sign = entry.avgSentiment > 0 ? '+' : '';
    return `Latest tracked sentiment sits at ${sign}${entry.avgSentiment.toFixed(2)}.`;
  }
  return 'Latest tracked move from the CoinGecko watch set.';
}

export function formatUnusualActivityRatio(ratio: number | null): string {
  if (ratio == null) return 'New breakout';
  return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}x baseline`;
}

export function formatUnusualActivityRelevance(score: number | null): string {
  if (score == null) return 'n/a';
  return score >= 10 ? score.toFixed(0) : score.toFixed(1);
}

export function unusualActivityBadgeClasses(entry: UnusualActivityEntry): string {
  if (entry.duplicateClusterSize != null && entry.duplicateClusterSize >= 4) {
    return 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25';
  }
  if (entry.lowRelevance) {
    return 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25';
  }
  if (entry.spikeRatio == null) {
    return 'bg-accent/10 text-accent border border-accent/20';
  }
  if (entry.spikeRatio >= 5) {
    return 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25';
  }
  return 'bg-accent/10 text-accent border border-accent/20';
}

export function formatSignedFixed(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

export function formatUnusualActivityNarrative(entry: UnusualActivityEntry): string {
  const relevanceNarrative = entry.lowRelevance
    ? ` Podders still scores this entity as lower relevance${
        entry.relevanceScore == null ? '' : ` (${formatUnusualActivityRelevance(entry.relevanceScore)})`
      }, so sudden attention here deserves manual verification.`
    : '';
  const duplicateNarrative =
    entry.duplicateClusterSize == null || entry.duplicateAuthorCount == null
      ? ''
      : ` A near-duplicate cluster tied together ${entry.duplicateClusterSize} posts from ${entry.duplicateAuthorCount} authors${
          entry.duplicateSourceCount != null ? ` across ${entry.duplicateSourceCount} source streams` : ''
        }.`;

  if (entry.baselineMentionCount == null || entry.baselineDays === 0) {
    return `${entry.mentionCount} mentions on the latest daily rollup without enough prior history to set a baseline yet.${relevanceNarrative}${duplicateNarrative}`;
  }

  return `${entry.mentionCount} mentions versus ${entry.baselineMentionCount.toFixed(1)}/day across ${entry.baselineDays} prior day${
    entry.baselineDays === 1 ? '' : 's'
  }.${relevanceNarrative}${duplicateNarrative}`;
}

export function formatCompactDuration(durationMs: number): string {
  const safeDurationMs = Math.max(0, durationMs);
  const mins = Math.round(safeDurationMs / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;

  const hours = safeDurationMs / 3_600_000;
  if (hours < 24) {
    const roundedHours = Math.round(hours * 10) / 10;
    return `${Number.isInteger(roundedHours) ? roundedHours.toFixed(0) : roundedHours.toFixed(1)}h`;
  }

  const days = safeDurationMs / 86_400_000;
  const roundedDays = Math.round(days * 10) / 10;
  return `${Number.isInteger(roundedDays) ? roundedDays.toFixed(0) : roundedDays.toFixed(1)}d`;
}

export function formatFirstMoverAuthor(entry: FirstMoverWatchlistEntry): string {
  if (entry.displayName && entry.handle && entry.displayName.toLowerCase() !== entry.handle.toLowerCase()) {
    return `${entry.displayName} (${entry.handle})`;
  }
  return entry.displayName ?? entry.handle;
}

export function formatFirstMoverClaimType(claimType: string): string {
  return claimType.replace(/[_-]+/g, ' ');
}

export function formatFirstMoverLeadWindow(entry: FirstMoverWatchlistEntry): string {
  if (entry.leadWindowMs == null) {
    return 'solo tracked call';
  }
  return `lead ${formatCompactDuration(entry.leadWindowMs)}`;
}

export function formatSourceTierLabel(tier: SourceTier): string {
  switch (tier) {
    case 'alpha':
      return 'Alpha';
    case 'influencer':
      return 'Influencer';
    case 'general':
      return 'General';
    case 'mainstream':
      return 'Mainstream';
  }
}

export function alphaTierToneClasses(tier: SourceTier): string {
  switch (tier) {
    case 'alpha':
      return 'bg-purple-500/15 border-purple-500/20 text-purple-300';
    case 'influencer':
      return 'bg-blue-500/15 border-blue-500/20 text-blue-300';
    case 'mainstream':
      return 'bg-emerald-500/15 border-emerald-500/20 text-emerald-300';
    case 'general':
      return 'bg-surface border-border text-text-secondary';
  }
}

export function formatAlphaWatchNarrative(entry: AlphaWatchEntry): string {
  const firstTier = formatSourceTierLabel(entry.firstSignalTier).toLowerCase();
  const latestTier = formatSourceTierLabel(entry.latestTier).toLowerCase();

  if (entry.tierCount <= 1) {
    return `Only tracked in ${firstTier} sources so far.`;
  }

  if (entry.latestTier === entry.firstSignalTier || entry.propagationLagMs == null) {
    return `Spread across ${entry.tierCount} tracked tiers after the first ${firstTier} mention.`;
  }

  return `Moved from ${firstTier} to ${latestTier} in ${formatCompactDuration(entry.propagationLagMs)}.`;
}

export function formatCalendarCategoryLabel(category: CalendarEventCategory): string {
  switch (category) {
    case 'macro':
      return 'Macro';
    case 'unlock':
      return 'Unlock';
    case 'expiry':
      return 'Expiry';
    case 'governance':
      return 'Governance';
    case 'launch':
      return 'Launch';
    case 'legal':
      return 'Legal';
    case 'custom':
      return 'Custom';
  }
}

export function formatCalendarRecurrenceLabel(recurrenceRule: CalendarEventRecurrence): string {
  switch (recurrenceRule) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'quarterly':
      return 'Quarterly';
    default:
      return 'One-time';
  }
}

export function regionalSentimentTone(value: number | null): RegionalSentimentTone {
  if (value == null) return 'insufficient';
  if (value >= 0.55) return 'bullish';
  if (value <= 0.45) return 'bearish';
  return 'neutral';
}

export function regionalSentimentToneClasses(tone: RegionalSentimentTone): string {
  switch (tone) {
    case 'bullish':
      return 'bg-accent-green/15 text-accent-green border border-accent-green/25';
    case 'bearish':
      return 'bg-accent-red/15 text-accent-red border border-accent-red/25';
    case 'neutral':
      return 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25';
    case 'insufficient':
    default:
      return 'bg-background text-text-secondary border border-border';
  }
}

export function formatRegionalSentimentTone(tone: RegionalSentimentTone): string {
  if (tone === 'insufficient') return 'Insufficient';
  return tone;
}

export function regionalDivergenceBadgeClasses(divergence: number): string {
  if (divergence < 0.15) {
    return 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400';
  }
  if (divergence <= 0.3) {
    return 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400';
  }
  return 'bg-red-500/10 border border-red-500/20 text-red-400';
}

export function formatRegionalDivergenceLabel(divergence: number): string {
  if (divergence < 0.15) return 'Aligned';
  if (divergence <= 0.3) return 'Moderate';
  return 'Divergent';
}

export function formatRegionalDivergenceNarrative(entry: RegionalDivergenceEntry): string {
  const engTone = regionalSentimentTone(entry.engSentiment);
  const indTone = regionalSentimentTone(entry.indSentiment);
  if (engTone === 'insufficient' || indTone === 'insufficient') {
    return 'Insufficient cross-language data for a reliable comparison.';
  }
  if (engTone === indTone) {
    return `Both regions stayed ${engTone}, but the spread still widened enough to keep this name on watch.`;
  }
  return `EN sources stayed ${engTone} while ID sources leaned ${indTone} over the trailing ${REGIONAL_DIVERGENCE_DAYS}d window.`;
}

export function SentimentBar({ entity }: { entity: EntitySentiment }) {
  const pct = Math.abs(entity.sentiment) * 50;
  const isPositive = entity.sentiment >= 0;

  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-28 text-sm text-text-primary font-body truncate">{entity.name}</span>
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
        {entity.sentiment > 0 ? '+' : ''}
        {entity.sentiment.toFixed(2)}
      </span>
    </div>
  );
}

export function CollapsibleSection({ section }: { section: Section }) {
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
