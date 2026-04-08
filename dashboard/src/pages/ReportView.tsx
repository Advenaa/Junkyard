import { useState, useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { apiFetch } from '../lib/api';
import type { MacroRegime, MacroRegimeHistory, Report, ReportChainDrilldown } from '../lib/types';
import { formatMacroRegimeLabel, macroRegimeToneClasses } from '../lib/macroRegime';
import { buildFocusedReportHref, buildSummaryChainHref } from '../lib/reportChains';
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

type NarrativeSignalStrength = 'new' | 'emerging' | 'strong' | 'stable' | 'fading';
type MacroBias = 'risk-on' | 'risk-off' | 'mixed';
type MacroSignal = 'risk-on' | 'risk-off' | 'neutral';
type MacroIndicator = 'vix' | 'dxy' | 'us10y' | 'spx' | 'gold';
type PriceContrarianSignal = 'price-up-sentiment-down' | 'price-down-sentiment-up';
type SourceTier = 'alpha' | 'influencer' | 'general' | 'mainstream';
type CalendarEventCategory = 'macro' | 'unlock' | 'expiry' | 'governance' | 'launch' | 'legal' | 'custom';
type CalendarEventRecurrence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | null;
type RegionalSentimentTone = 'bullish' | 'bearish' | 'neutral' | 'insufficient';

interface MacroOverviewEntry {
  indicator: MacroIndicator;
  label: string;
  value: number;
  change1d: number | null;
  change7d: number | null;
  date: string;
  signal: MacroSignal;
  narrative: string;
}

interface MacroOverview {
  overallBias: MacroBias;
  latestDate: string | null;
  entries: MacroOverviewEntry[];
}

interface PriceWatchEntry {
  entityId: string;
  entityName: string;
  timestamp: number;
  priceUsd: number;
  priceChange24h: number | null;
  priceChange7d: number | null;
  volume24h: number | null;
  marketCap: number | null;
  avgSentiment: number | null;
  momentum: number | null;
  contrarianSignal: PriceContrarianSignal | null;
}

interface PriceWatchOverview {
  latestTimestamp: number | null;
  entries: PriceWatchEntry[];
}

interface NarrativeWatchlistEntry {
  id: string;
  name: string;
  date: string;
  memberCount: number;
  avgSentiment: number | null;
  signalStrength: NarrativeSignalStrength;
}

interface NarrativeWatchlistOverview {
  latestDate: string | null;
  entries: NarrativeWatchlistEntry[];
}

interface UnusualActivityEntry {
  entityId: string;
  entityName: string;
  date: string;
  mentionCount: number;
  baselineMentionCount: number | null;
  baselinePeakMentionCount: number | null;
  baselineDays: number;
  avgSentiment: number | null;
  momentum: number | null;
  spikeRatio: number | null;
  relevanceScore: number | null;
  lowRelevance: boolean;
  duplicateClusterSize: number | null;
  duplicateAuthorCount: number | null;
  duplicateSourceCount: number | null;
}

interface UnusualActivityOverview {
  latestDate: string | null;
  entries: UnusualActivityEntry[];
}

interface FirstMoverWatchlistEntry {
  entityId: string;
  entityName: string;
  authorId: string;
  platform: string;
  handle: string;
  displayName: string | null;
  claimType: string;
  claimText: string;
  sourceItemId: string | null;
  timestamp: number;
  nextTrackedCallTime: number | null;
  leadWindowMs: number | null;
  credibilityScore: number | null;
  totalCalls: number;
  correctCalls: number;
}

interface FirstMoverWatchlistOverview {
  latestTimestamp: number | null;
  entries: FirstMoverWatchlistEntry[];
}

interface AlphaWatchEntry {
  entityId: string;
  entityName: string;
  firstSignalTier: SourceTier;
  firstSignalTime: number;
  latestTier: SourceTier;
  latestMentionTime: number;
  propagationLagMs: number | null;
  tierCount: number;
  sourceCount: number;
}

interface AlphaWatchOverview {
  latestTimestamp: number | null;
  entries: AlphaWatchEntry[];
}

interface CalendarEventSnapshotEntry {
  id: string;
  name: string;
  category: CalendarEventCategory;
  description: string | null;
  recurrenceRule: CalendarEventRecurrence;
  entityId: string | null;
  entityName: string | null;
  nextOccurrence: number;
  createdAt: number;
}

interface RegionalDivergenceEntry {
  entityId: string;
  entityName: string;
  engSentiment: number | null;
  engMentions: number;
  indSentiment: number | null;
  indMentions: number;
  divergence: number;
}

interface FullReport extends Report {
  body: string | null;
  keyEvents: string[];
  marketCatalysts: string[];
  regionalDivergence: string[];
  narrativeShifts: string[];
  eventChains: string[];
  firstMovers: string[];
  alphaSignals: string[];
  priceAlerts: string[];
  unusualActivity: string[];
  macroAlerts: string[];
  macroRegime: MacroRegime | null;
  macroRegimeHistory?: MacroRegimeHistory | null;
  chainDrilldowns?: ReportChainDrilldown[];
  entitySentiment: EntitySentiment[];
  sections: Section[];
}

const NARRATIVE_PREVIEW_LIMIT = 3;
const MACRO_PREVIEW_LIMIT = 3;
const PRICE_WATCH_PREVIEW_LIMIT = 3;
const UNUSUAL_ACTIVITY_PREVIEW_LIMIT = 3;
const FIRST_MOVER_PREVIEW_LIMIT = 3;
const ALPHA_WATCH_PREVIEW_LIMIT = 3;
const CALENDAR_PREVIEW_LIMIT = 3;
const REGIONAL_DIVERGENCE_PREVIEW_LIMIT = 3;
const REGIONAL_DIVERGENCE_DAYS = 7;

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

function formatNarrativeSignalLabel(signalStrength: NarrativeSignalStrength): string {
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

function narrativeSignalClasses(signalStrength: NarrativeSignalStrength): string {
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

function formatNarrativeSentiment(sentiment: number | null): string {
  if (sentiment == null) {
    return 'sentiment n/a';
  }
  return `sentiment ${sentiment > 0 ? '+' : ''}${sentiment.toFixed(2)}`;
}

function macroToneClasses(tone: MacroBias | MacroSignal): string {
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

function formatMacroValue(entry: MacroOverviewEntry): string {
  if (entry.indicator === 'spx') {
    return entry.value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return entry.value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMacroChange(value: number | null, indicator: MacroIndicator): string {
  if (value == null) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString('en-US', {
    minimumFractionDigits: indicator === 'spx' ? 0 : 2,
    maximumFractionDigits: indicator === 'spx' ? 0 : 2,
  })}`;
}

function formatCompactNumber(num: number): string {
  if (!Number.isFinite(num)) {
    return 'n/a';
  }
  if (Math.abs(num) >= 1_000_000_000_000) return `${(num / 1_000_000_000_000).toFixed(2)}T`;
  if (Math.abs(num) >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

function formatPriceValue(priceUsd: number): string {
  return priceUsd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: priceUsd < 1 ? 6 : 2,
  });
}

function formatPriceChange(value: number | null, label: '24h' | '7d'): string {
  if (value == null) return `${label} n/a`;
  const sign = value > 0 ? '+' : '';
  return `${label} ${sign}${value.toFixed(1)}%`;
}

function priceChangeToneClasses(value: number | null): string {
  if (value == null) {
    return 'bg-background text-text-secondary border border-border';
  }
  return value >= 0
    ? 'bg-accent-green/15 text-accent-green border border-accent-green/25'
    : 'bg-accent-red/15 text-accent-red border border-accent-red/25';
}

function priceContrarianClasses(signal: PriceContrarianSignal): string {
  return signal === 'price-up-sentiment-down'
    ? 'bg-accent/10 text-accent border border-accent/20'
    : 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25';
}

function formatPriceContrarianNarrative(entry: PriceWatchEntry): string {
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

function formatUnusualActivityRatio(ratio: number | null): string {
  if (ratio == null) return 'New breakout';
  return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}x baseline`;
}

function formatUnusualActivityRelevance(score: number | null): string {
  if (score == null) return 'n/a';
  return score >= 10 ? score.toFixed(0) : score.toFixed(1);
}

function unusualActivityBadgeClasses(entry: UnusualActivityEntry): string {
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

function formatSignedFixed(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

function formatUnusualActivityNarrative(entry: UnusualActivityEntry): string {
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

function formatCompactDuration(durationMs: number): string {
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

function formatFirstMoverAuthor(entry: FirstMoverWatchlistEntry): string {
  if (entry.displayName && entry.handle && entry.displayName.toLowerCase() !== entry.handle.toLowerCase()) {
    return `${entry.displayName} (${entry.handle})`;
  }
  return entry.displayName ?? entry.handle;
}

function formatFirstMoverClaimType(claimType: string): string {
  return claimType.replace(/[_-]+/g, ' ');
}

function formatFirstMoverLeadWindow(entry: FirstMoverWatchlistEntry): string {
  if (entry.leadWindowMs == null) {
    return 'solo tracked call';
  }
  return `lead ${formatCompactDuration(entry.leadWindowMs)}`;
}

function formatFirstMoverReviewHistory(entry: Pick<FirstMoverWatchlistEntry, 'correctCalls' | 'totalCalls'>): string {
  if (entry.totalCalls <= 0) {
    return 'no reviewed calls';
  }
  return `${entry.correctCalls}/${entry.totalCalls} reviewed correct`;
}

function formatSourceTierLabel(tier: SourceTier): string {
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

function alphaTierToneClasses(tier: SourceTier): string {
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

function formatAlphaWatchNarrative(entry: AlphaWatchEntry): string {
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

function formatCalendarCategoryLabel(category: CalendarEventCategory): string {
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

function formatCalendarRecurrenceLabel(recurrenceRule: CalendarEventRecurrence): string {
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

function regionalSentimentTone(value: number | null): RegionalSentimentTone {
  if (value == null) return 'insufficient';
  if (value >= 0.55) return 'bullish';
  if (value <= 0.45) return 'bearish';
  return 'neutral';
}

function regionalSentimentToneClasses(tone: RegionalSentimentTone): string {
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

function formatRegionalSentimentTone(tone: RegionalSentimentTone): string {
  if (tone === 'insufficient') return 'Insufficient';
  return tone;
}

function regionalDivergenceBadgeClasses(divergence: number): string {
  if (divergence < 0.15) {
    return 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400';
  }
  if (divergence <= 0.3) {
    return 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400';
  }
  return 'bg-red-500/10 border border-red-500/20 text-red-400';
}

function formatRegionalDivergenceLabel(divergence: number): string {
  if (divergence < 0.15) return 'Aligned';
  if (divergence <= 0.3) return 'Moderate';
  return 'Divergent';
}

function formatRegionalDivergenceNarrative(entry: RegionalDivergenceEntry): string {
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

function SentimentBar({ entity }: { entity: EntitySentiment }) {
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
  const [searchParams] = useSearchParams();
  const requestKey = id ?? '__latest__';
  const [report, setReport] = useState<FullReport | null>(null);
  const [macroOverview, setMacroOverview] = useState<MacroOverview | null>(null);
  const [priceWatch, setPriceWatch] = useState<PriceWatchOverview | null>(null);
  const [narratives, setNarratives] = useState<NarrativeWatchlistOverview | null>(null);
  const [unusualActivity, setUnusualActivity] = useState<UnusualActivityOverview | null>(null);
  const [regionalDivergences, setRegionalDivergences] = useState<RegionalDivergenceEntry[] | null>(null);
  const [firstMoverWatchlist, setFirstMoverWatchlist] = useState<FirstMoverWatchlistOverview | null>(null);
  const [alphaWatch, setAlphaWatch] = useState<AlphaWatchOverview | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventSnapshotEntry[] | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

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
          setError(null);
          setLoadedKey(requestKey);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setReport(null);
          setError(err.message);
          setLoadedKey(requestKey);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, requestKey]);

  useEffect(() => {
    let cancelled = false;

    apiFetch<MacroOverview>('/macro')
      .then((overview) => {
        if (!cancelled) {
          setMacroOverview(overview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMacroOverview(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiFetch<PriceWatchOverview>('/price-watch')
      .then((overview) => {
        if (!cancelled) {
          setPriceWatch(overview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPriceWatch(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiFetch<{ divergences: RegionalDivergenceEntry[] }>(
      `/divergence?days=${REGIONAL_DIVERGENCE_DAYS}&limit=${REGIONAL_DIVERGENCE_PREVIEW_LIMIT}`,
    )
      .then((overview) => {
        if (!cancelled) {
          setRegionalDivergences(overview.divergences);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRegionalDivergences(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiFetch<NarrativeWatchlistOverview>('/narratives')
      .then((overview) => {
        if (!cancelled) {
          setNarratives(overview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNarratives(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiFetch<UnusualActivityOverview>('/unusual-activity')
      .then((overview) => {
        if (!cancelled) {
          setUnusualActivity(overview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnusualActivity(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiFetch<FirstMoverWatchlistOverview>('/first-movers')
      .then((overview) => {
        if (!cancelled) {
          setFirstMoverWatchlist(overview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFirstMoverWatchlist(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiFetch<AlphaWatchOverview>('/alpha-watch')
      .then((overview) => {
        if (!cancelled) {
          setAlphaWatch(overview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAlphaWatch(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiFetch<{ events: CalendarEventSnapshotEntry[] }>('/calendar-events')
      .then((overview) => {
        if (!cancelled) {
          setCalendarEvents(overview.events);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCalendarEvents(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loading = loadedKey !== requestKey;

  if (loading) {
    return <div className="p-6 text-text-secondary font-body">Loading...</div>;
  }

  if (error) {
    return <div className="p-6 text-accent-red font-body">Error: {error}</div>;
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

  const focusedChainId = searchParams.get('chain');
  const allChains = report.chainDrilldowns ?? [];
  const focusedChain = focusedChainId ? (allChains.find((chain) => chain.rootId === focusedChainId) ?? null) : null;
  const focusedChainIndex = focusedChain ? allChains.findIndex((chain) => chain.rootId === focusedChain.rootId) : -1;
  const focusedChainSummary =
    focusedChainIndex >= 0 && report.eventChains[focusedChainIndex] ? report.eventChains[focusedChainIndex] : null;
  const orderedEventChains = focusedChainSummary
    ? [focusedChainSummary, ...report.eventChains.filter((_, index) => index !== focusedChainIndex)]
    : report.eventChains;
  const orderedChains = focusedChain
    ? [focusedChain, ...allChains.filter((chain) => chain.rootId !== focusedChain.rootId)]
    : allChains;
  const macroEntries = macroOverview?.entries.slice(0, MACRO_PREVIEW_LIMIT) ?? [];
  const priceEntries = priceWatch?.entries.slice(0, PRICE_WATCH_PREVIEW_LIMIT) ?? [];
  const narrativeEntries = narratives?.entries.slice(0, NARRATIVE_PREVIEW_LIMIT) ?? [];
  const unusualEntries = unusualActivity?.entries.slice(0, UNUSUAL_ACTIVITY_PREVIEW_LIMIT) ?? [];
  const regionalDivergenceEntries = regionalDivergences?.slice(0, REGIONAL_DIVERGENCE_PREVIEW_LIMIT) ?? [];
  const firstMoverEntries = firstMoverWatchlist?.entries.slice(0, FIRST_MOVER_PREVIEW_LIMIT) ?? [];
  const alphaWatchEntries = alphaWatch?.entries.slice(0, ALPHA_WATCH_PREVIEW_LIMIT) ?? [];
  const calendarEntries = calendarEvents?.slice(0, CALENDAR_PREVIEW_LIMIT) ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TypeBadge type={report.type} />
          <span className="font-mono text-xs text-text-secondary uppercase tracking-wider">Report</span>
        </div>
        <span className="font-mono text-xs text-text-secondary">{formatDate(report.date)}</span>
      </div>

      {/* TL;DR Hero */}
      <blockquote className="font-heading text-xl leading-relaxed text-text-primary border-l-2 border-accent pl-6 py-2">
        {report.tldr}
      </blockquote>

      {macroEntries.length > 0 && (
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

      {priceEntries.length > 0 && (
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

      {narrativeEntries.length > 0 && (
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

      {unusualEntries.length > 0 && (
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
      )}

      {regionalDivergenceEntries.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
            <div>
              <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Regional Divergence</h2>
              <p className="text-text-secondary/70 text-sm font-body mt-1">
                Largest EN vs ID sentiment gaps from the trailing 7d window. Full per-entity detail remains in Settings
                &gt; Entities.
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
      )}

      {firstMoverEntries.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
            <div>
              <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">First Mover Watch</h2>
              <p className="text-text-secondary/70 text-sm font-body mt-1">
                Recent tracked first calls from monitored authors. Detailed author timing and review history remain in
                Settings &gt; Entities.
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
            {firstMoverEntries.map((entry) => (
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
                  {entry.totalCalls > 0 && (
                    <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                      {formatFirstMoverReviewHistory(entry)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {alphaWatchEntries.length > 0 && (
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
            {alphaWatchEntries.map((entry) => (
              <div key={entry.entityId} className="rounded-lg border border-border bg-background p-3 space-y-3">
                <div className="space-y-1">
                  <h3 className="text-text-primary text-sm font-body leading-snug">{entry.entityName}</h3>
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
        </div>
      )}

      {calendarEntries.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
            <div>
              <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Catalyst Watch</h2>
              <p className="text-text-secondary/70 text-sm font-body mt-1">
                Next scheduled catalysts from the shared market calendar. Detailed curation remains in Settings &gt;
                Pipeline.
              </p>
            </div>
            <span className="px-2 py-1 rounded bg-accent/10 text-accent border border-accent/20 text-[11px] font-mono uppercase tracking-wide">
              {calendarEvents?.length ?? calendarEntries.length} scheduled
            </span>
          </div>

          <div className="p-4 grid gap-3 md:grid-cols-3">
            {calendarEntries.map((event) => (
              <div key={event.id} className="rounded-lg border border-border bg-background p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-text-primary text-sm font-body leading-snug">{event.name}</h3>
                    <p className="text-text-secondary/70 text-sm font-body leading-relaxed">
                      {formatDateTime(event.nextOccurrence)}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-surface border border-border text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                    {formatCalendarCategoryLabel(event.category)}
                  </span>
                </div>

                {event.description && (
                  <p className="text-text-secondary/80 text-sm font-body leading-relaxed">{event.description}</p>
                )}

                <div className="flex flex-wrap gap-2 text-xs font-mono">
                  <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                    {formatCalendarRecurrenceLabel(event.recurrenceRule)}
                  </span>
                  {event.entityName && (
                    <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                      {event.entityName}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.macroRegime && (
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-2">
              <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Macro Regime</h2>
              <p className="text-text-primary text-sm font-body leading-relaxed">{report.macroRegime.rationale}</p>
              {report.macroRegimeHistory && report.macroRegimeHistory.streakDays > 0 && (
                <p className="text-text-secondary text-xs font-mono uppercase tracking-wide">
                  Day {report.macroRegimeHistory.streakDays} of current daily regime | since{' '}
                  {formatDate(report.macroRegimeHistory.regimeStartedAt)}
                  {report.macroRegimeHistory.previousClassification
                    ? ` | previous ${formatMacroRegimeLabel(report.macroRegimeHistory.previousClassification)}`
                    : ''}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <span
                className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wide ${macroRegimeToneClasses(report.macroRegime.classification)}`}
              >
                {formatMacroRegimeLabel(report.macroRegime.classification)}
              </span>
              <span className="text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                {Math.round(report.macroRegime.confidence * 100)}% confidence
              </span>
            </div>
          </div>
        </div>
      )}

      {report.marketCatalysts && report.marketCatalysts.length > 0 && (
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Market Catalysts</h2>
          <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
            {report.marketCatalysts.map((catalyst, i) => (
              <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                {catalyst}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.regionalDivergence && report.regionalDivergence.length > 0 && (
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">
            Cross-Language Signals
          </h2>
          <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
            {report.regionalDivergence.map((entry, i) => (
              <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                {entry}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.narrativeShifts && report.narrativeShifts.length > 0 && (
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Narrative Shifts</h2>
          <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
            {report.narrativeShifts.map((entry, i) => (
              <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                {entry}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.firstMovers && report.firstMovers.length > 0 && (
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">First Movers</h2>
          <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
            {report.firstMovers.map((entry, i) => (
              <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                {entry}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.alphaSignals && report.alphaSignals.length > 0 && (
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Alpha Signals</h2>
          <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
            {report.alphaSignals.map((signal, i) => (
              <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                {signal}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.priceAlerts && report.priceAlerts.length > 0 && (
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Price Alerts</h2>
          <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
            {report.priceAlerts.map((alert, i) => (
              <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                {alert}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.unusualActivity && report.unusualActivity.length > 0 && (
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Unusual Activity</h2>
          <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
            {report.unusualActivity.map((alert, i) => (
              <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                {alert}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.macroAlerts && report.macroAlerts.length > 0 && (
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Macro Alerts</h2>
          <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
            {report.macroAlerts.map((alert, i) => (
              <div key={i} className="px-4 py-3 text-sm font-body text-text-primary leading-relaxed">
                {alert}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.eventChains && report.eventChains.length > 0 && (
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Event Chains</h2>
          <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
            {orderedEventChains.map((chain, i) => {
              const isFocusedSummary = focusedChainSummary !== null && i === 0;

              return (
                <div
                  key={`${i}:${chain}`}
                  className={`px-4 py-3 space-y-1 text-sm font-body leading-relaxed ${
                    isFocusedSummary ? 'bg-accent/5 text-text-primary' : 'text-text-primary'
                  }`}
                >
                  {isFocusedSummary && (
                    <div className="font-mono text-[10px] uppercase tracking-wider text-accent">
                      Focused chain summary
                    </div>
                  )}
                  <div>{chain}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {allChains.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Chain Drilldowns</h2>
            {focusedChain && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
                  Focused chain | {focusedChain.entityName} | {focusedChain.latestEventType}
                </span>
                <Link
                  to={`/reports/${report.id}`}
                  className="text-[10px] font-mono uppercase tracking-wider text-text-secondary hover:text-accent hover:underline"
                >
                  Show all chains
                </Link>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {orderedChains.map((chain) => {
              const isFocused = focusedChain?.rootId === chain.rootId;

              return (
                <div
                  key={chain.rootId}
                  className={`bg-surface border rounded-lg p-4 space-y-2 ${
                    isFocused ? 'border-accent/60 bg-accent/5' : 'border-border'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-body text-text-primary">{chain.entityName}</div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary">
                        {chain.eventCount} linked event{chain.eventCount !== 1 ? 's' : ''} |{' '}
                        {chain.eventTypes.join(' -> ')}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {isFocused ? (
                        <span className="text-[10px] font-mono uppercase tracking-wider text-accent">
                          Focused chain
                        </span>
                      ) : allChains.length > 1 ? (
                        <Link
                          to={buildFocusedReportHref(report.id, chain.rootId)}
                          className="text-[10px] font-mono uppercase tracking-wider text-text-secondary hover:text-accent hover:underline"
                        >
                          Focus chain
                        </Link>
                      ) : null}
                      <Link
                        to={buildSummaryChainHref(chain.latestSummaryId, chain.rootId)}
                        className="text-xs font-mono uppercase tracking-wider text-accent hover:underline"
                      >
                        Open latest linked summary
                      </Link>
                    </div>
                  </div>
                  <div className="text-xs font-body text-text-secondary leading-relaxed">
                    {formatRange(chain.firstEventTime, chain.latestEventTime)}
                  </div>
                  <div className="text-xs font-mono uppercase tracking-wider text-text-secondary">
                    Latest event | {chain.latestEventType} | {formatDateTime(chain.latestEventTime)}
                  </div>
                  <div className="text-sm font-body text-text-primary leading-relaxed">
                    {chain.latestEventDescription}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Key Events */}
      {report.keyEvents && report.keyEvents.length > 0 && (
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Key Events</h2>
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
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Entity Sentiment</h2>
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
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-4">Sections</h2>
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
