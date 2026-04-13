import { escapeXml, formatCalendarEventTime, formatEventChainLine } from './synthesis-shared.js';
import type { DriftFlag } from './pulse-sentiment.js';
import type { EventChainRow, EntityFirstMoverRow, UnusualActivityOverview } from '../db/queries.js';
import type { MomentumEntry } from '../knowledge/sentiment.js';
import type { DivergenceEntry } from '../knowledge/divergence.js';
import type { CalendarEventEntry } from '../knowledge/calendar.js';
import { formatMacroContextLines, type CryptoSentimentAggregate, type MacroContextSummary } from '../macro/context.js';

export interface PriceContextEntry {
  entityName: string;
  priceUsd: number;
  priceChange24h: number | null;
  priceChange7d: number | null;
  sentiment: number | null;
  contrarian: string | null;
}

export interface AlphaPropagationContext {
  entityName: string;
  tiers: Array<{ tier: string; firstMentionTime: number; source: string; sourceId: string }>;
  propagationSpeed: string | null;
}

export interface NarrativeContext {
  name: string;
  growthRate: string;
  summaryCount: number;
  createdAt: number;
}

export function formatUnusualActivityContext(overview: UnusualActivityOverview): string[] {
  return overview.entries.map((entry) => {
    const baseline =
      entry.baselineMentionCount == null || entry.baselineDays === 0
        ? 'baseline=new/no-history'
        : `baseline=${entry.baselineMentionCount.toFixed(1)}/day over ${entry.baselineDays}d`;
    const priorPeak =
      entry.baselinePeakMentionCount == null ? 'prior_peak=n/a' : `prior_peak=${entry.baselinePeakMentionCount}`;
    const ratio = entry.spikeRatio == null ? 'ratio=new-breakout' : `ratio=${entry.spikeRatio.toFixed(1)}x`;
    const sentiment = entry.avgSentiment == null ? 'sentiment=n/a' : `sentiment=${entry.avgSentiment.toFixed(2)}`;
    const momentum =
      entry.momentum == null ? 'momentum=n/a' : `momentum=${entry.momentum > 0 ? '+' : ''}${entry.momentum.toFixed(2)}`;
    const relevance =
      entry.relevanceScore == null
        ? 'relevance=n/a, low_relevance=unknown'
        : `relevance=${entry.relevanceScore.toFixed(2)}, low_relevance=${entry.lowRelevance ? 'yes' : 'no'}`;
    const duplicateCluster =
      entry.duplicateClusterSize == null || entry.duplicateAuthorCount == null
        ? null
        : `dup_cluster=${entry.duplicateClusterSize} posts/${entry.duplicateAuthorCount} authors/${entry.duplicateSourceCount ?? 1} streams`;
    return `${escapeXml(entry.entityName)}: mentions=${entry.mentionCount}, ${baseline}, ${priorPeak}, ${ratio}, ${relevance}, ${sentiment}, ${momentum}${duplicateCluster ? `, ${duplicateCluster}` : ''}`;
  });
}

export function formatFirstMoverLeadWindow(leadWindowMs: number | null): string {
  if (leadWindowMs == null || leadWindowMs <= 0) {
    return 'no later tracked call in the current lookback';
  }

  const hours = leadWindowMs / (1000 * 60 * 60);
  if (hours < 1) {
    return `${Math.max(1, Math.round(leadWindowMs / 60000))}m before the next tracked call`;
  }
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h before the next tracked call`;
}

export function formatFirstMoverTimestamp(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).format(timestamp);
}

export function formatFirstMoverContext(rows: EntityFirstMoverRow[], timezone: string): string[] {
  return rows.map((row) => {
    const displayName = row.displayName?.trim() || row.handle;
    const authorLabel =
      row.platform === 'twitter' && !row.handle.startsWith('@')
        ? `${displayName} (@${row.handle})`
        : `${displayName} (${row.handle})`;
    return `${escapeXml(row.entityName)}: first tracked by ${escapeXml(authorLabel)} on ${row.platform} at ${formatFirstMoverTimestamp(row.timestamp, timezone)} ${timezone}; claim_type=${row.claimType}; lead_window=${formatFirstMoverLeadWindow(row.leadWindowMs)}; claim=${escapeXml(row.claimText)}`;
  });
}

export interface RecentEventAnalysisEntry {
  event: CalendarEventEntry;
  preAvgSentiment: number | null;
  preMentionCount: number;
  postAvgSentiment: number | null;
  postMentionCount: number;
  sentimentDelta: number | null;
}

export function buildUserMessage(
  summaries: { summary: string; source: string; entities: string; urgency: string }[],
  driftFlags: DriftFlag[],
  priorTldr: string | null,
  momentum: MomentumEntry[],
  divergence: DivergenceEntry[],
  priceContext: PriceContextEntry[],
  firstMovers: EntityFirstMoverRow[],
  unusualActivity: UnusualActivityOverview,
  macroContext: MacroContextSummary,
  cryptoAggregate: CryptoSentimentAggregate | null,
  alphaPropagation: AlphaPropagationContext[],
  narratives: NarrativeContext[],
  recentCalendarEvents: CalendarEventEntry[],
  recentEventAnalysis: RecentEventAnalysisEntry[],
  recentEventChains: EventChainRow[],
  calendarEvents: CalendarEventEntry[],
  timezone: string,
): string {
  const parts: string[] = [];

  if (priorTldr) {
    parts.push(`<prior_pulse_tldr>${priorTldr}</prior_pulse_tldr>`);
  }

  const summaryBlocks = summaries.map(
    (summary) => `[${summary.source}] (${summary.urgency}) ${summary.summary}\nEntities: ${summary.entities}`,
  );
  parts.push(`<summaries>\n${summaryBlocks.join('\n\n')}\n</summaries>`);

  if (driftFlags.length > 0) {
    const driftLines = driftFlags.map(
      (drift) =>
        `${drift.entity}: sentiment shifted from ${drift.prior.toFixed(2)} to ${drift.current.toFixed(2)} (delta: ${drift.delta.toFixed(2)})`,
    );
    parts.push(
      `<sentiment_drift>\nThe following entities had significant sentiment changes since the last pulse:\n${driftLines.join('\n')}\n</sentiment_drift>`,
    );
  }

  if (momentum.length > 0) {
    const momentumLines = momentum.map((entry) => {
      const momentumValue = entry.momentum ?? 0;
      const sign = momentumValue > 0 ? '+' : '';
      return `${escapeXml(entry.entityName)}: avg=${entry.avgSentiment.toFixed(2)}, momentum=${sign}${momentumValue.toFixed(2)} (${entry.trend}), mentions=${entry.mentionCount}`;
    });
    parts.push(`<sentiment_momentum>\n${momentumLines.join('\n')}\n</sentiment_momentum>`);
  }

  if (divergence.length > 0) {
    const divergenceLines = divergence.map(
      (entry) =>
        `${escapeXml(entry.entityName)}: EN sentiment=${entry.engSentiment.toFixed(1)} (${entry.engMentions} mentions), ID sentiment=${entry.indSentiment.toFixed(1)} (${entry.indMentions} mentions) — divergence=${entry.divergence.toFixed(1)} (${entry.direction})`,
    );
    parts.push(`<regional_divergence>\n${divergenceLines.join('\n')}\n</regional_divergence>`);
  }

  if (priceContext.length > 0) {
    const priceLines = priceContext.map((entry) => {
      const change24h =
        entry.priceChange24h !== null
          ? `24h: ${entry.priceChange24h > 0 ? '+' : ''}${entry.priceChange24h.toFixed(1)}%`
          : '';
      const change7d =
        entry.priceChange7d !== null
          ? `7d: ${entry.priceChange7d > 0 ? '+' : ''}${entry.priceChange7d.toFixed(1)}%`
          : '';
      const changes = [change24h, change7d].filter(Boolean).join(', ');
      const contrarianTag = entry.contrarian ? ` — CONTRARIAN: ${entry.contrarian}` : ' — aligned';
      return `${escapeXml(entry.entityName)}: $${entry.priceUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} (${changes})${contrarianTag}`;
    });
    parts.push(`<price_context>\n${priceLines.join('\n')}\n</price_context>`);
  }

  if (firstMovers.length > 0) {
    parts.push(`<first_movers>\n${formatFirstMoverContext(firstMovers, timezone).join('\n')}\n</first_movers>`);
  }

  if (unusualActivity.entries.length > 0) {
    const unusualLines = formatUnusualActivityContext(unusualActivity);
    const dateNote = unusualActivity.latestDate
      ? `latest_daily_rollup=${unusualActivity.latestDate}`
      : 'latest_daily_rollup=unknown';
    parts.push(`<unusual_activity>\n${dateNote}\n${unusualLines.join('\n')}\n</unusual_activity>`);
  }

  if (macroContext.entries.length > 0) {
    const macroLines = formatMacroContextLines(macroContext, cryptoAggregate);
    parts.push(`<macro_context>\n${macroLines.join('\n')}\n</macro_context>`);
  }

  if (alphaPropagation.length > 0) {
    const alphaLines = alphaPropagation.map((entry) => {
      const tierList = entry.tiers.map((tier) => `${tier.tier} (${tier.source}/${tier.sourceId})`).join(' → ');
      const speed = entry.propagationSpeed ? ` — ${entry.propagationSpeed}` : '';
      return `${escapeXml(entry.entityName)}: ${tierList}${speed}`;
    });
    parts.push(`<alpha_propagation>\n${alphaLines.join('\n')}\n</alpha_propagation>`);
  }

  if (narratives.length > 0) {
    const narrativeLines = narratives.map(
      (entry) => `${escapeXml(entry.name)}: growth=${entry.growthRate}, summaries=${entry.summaryCount}`,
    );
    parts.push(`<narrative_context>\n${narrativeLines.join('\n')}\n</narrative_context>`);
  }

  if (recentCalendarEvents.length > 0) {
    const eventLines = recentCalendarEvents.map((event) => {
      const description = event.description ? ` — ${escapeXml(event.description)}` : '';
      const recurrence = event.recurrenceRule ? ` (recurs ${event.recurrenceRule})` : '';
      const linkedEntity = event.entityName ? ` [entity: ${escapeXml(event.entityName)}]` : '';
      return `${formatCalendarEventTime(event.nextOccurrence, timezone)} [${event.category}] ${escapeXml(event.name)}${recurrence}${linkedEntity}${description}`;
    });
    parts.push(`<recent_calendar_events>\n${eventLines.join('\n')}\n</recent_calendar_events>`);
  }

  if (recentEventAnalysis.length > 0) {
    const eventLines = recentEventAnalysis.map((entry) => {
      const event = entry.event;
      const description = event.description ? ` — ${escapeXml(event.description)}` : '';
      const preAvg = entry.preAvgSentiment === null ? 'n/a' : entry.preAvgSentiment.toFixed(2);
      const postAvg = entry.postAvgSentiment === null ? 'n/a' : entry.postAvgSentiment.toFixed(2);
      const delta =
        entry.sentimentDelta === null
          ? 'n/a'
          : `${entry.sentimentDelta > 0 ? '+' : ''}${entry.sentimentDelta.toFixed(2)}`;
      const linkedEntity = event.entityName ? ` [entity: ${escapeXml(event.entityName)}]` : '';
      return `${formatCalendarEventTime(event.nextOccurrence, timezone)} [${event.category}] ${escapeXml(event.name)}${linkedEntity}${description} | pre-48h avg=${preAvg} (${entry.preMentionCount} mentions), post-so-far avg=${postAvg} (${entry.postMentionCount} mentions), delta=${delta}`;
    });
    parts.push(`<recent_event_analysis>\n${eventLines.join('\n')}\n</recent_event_analysis>`);
  }

  if (recentEventChains.length > 0) {
    parts.push(
      `<recent_event_chains>\n${recentEventChains.map((chain) => formatEventChainLine(chain, timezone)).join('\n')}\n</recent_event_chains>`,
    );
  }

  if (calendarEvents.length > 0) {
    const eventLines = calendarEvents.map((event) => {
      const description = event.description ? ` — ${escapeXml(event.description)}` : '';
      const recurrence = event.recurrenceRule ? ` (recurs ${event.recurrenceRule})` : '';
      const linkedEntity = event.entityName ? ` [entity: ${escapeXml(event.entityName)}]` : '';
      return `${formatCalendarEventTime(event.nextOccurrence, timezone)} [${event.category}] ${escapeXml(event.name)}${recurrence}${linkedEntity}${description}`;
    });
    parts.push(`<upcoming_calendar_events>\n${eventLines.join('\n')}\n</upcoming_calendar_events>`);
  }

  return parts.join('\n\n');
}
