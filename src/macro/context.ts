import type { MacroIndicator, MacroSnapshotRow } from '../db/queries.js';

export interface CryptoSentimentSample {
  type: string;
  sentiment: number;
  mentionCount: number;
}

export interface CryptoSentimentAggregate {
  average: number;
  tone: 'bullish' | 'bearish' | 'neutral';
  mentionCount: number;
}

export interface MacroContextEntry {
  indicator: MacroIndicator;
  label: string;
  value: number;
  change1d: number | null;
  change7d: number | null;
  date: string;
  signal: 'risk-on' | 'risk-off' | 'neutral';
  narrative: string;
}

export interface MacroContextSummary {
  entries: MacroContextEntry[];
  overallBias: 'risk-on' | 'risk-off' | 'mixed';
}

const INDICATOR_ORDER: MacroIndicator[] = ['vix', 'dxy', 'us10y', 'spx', 'gold'];

function getIndicatorLabel(indicator: MacroIndicator): string {
  switch (indicator) {
    case 'vix':
      return 'VIX';
    case 'dxy':
      return 'DXY proxy';
    case 'us10y':
      return 'US 10Y';
    case 'spx':
      return 'S&P 500';
    case 'gold':
      return 'Gold';
  }
}

function getSignal(indicator: MacroIndicator, change: number | null): 'risk-on' | 'risk-off' | 'neutral' {
  if (change === null || Math.abs(change) < 0.01) return 'neutral';

  switch (indicator) {
    case 'spx':
      return change > 0 ? 'risk-on' : 'risk-off';
    case 'vix':
    case 'dxy':
    case 'us10y':
    case 'gold':
      return change > 0 ? 'risk-off' : 'risk-on';
  }
}

function describeIndicator(indicator: MacroIndicator, change: number | null): string {
  if (change === null || Math.abs(change) < 0.01) {
    return 'flat';
  }

  switch (indicator) {
    case 'vix':
      return change > 0 ? 'volatility rising' : 'volatility easing';
    case 'dxy':
      return change > 0 ? 'dollar strengthening' : 'dollar easing';
    case 'us10y':
      return change > 0 ? 'yields pushing higher' : 'yields easing';
    case 'spx':
      return change > 0 ? 'equities firming' : 'equities fading';
    case 'gold':
      return change > 0 ? 'gold firming' : 'gold easing';
  }
}

function formatSigned(value: number | null): string {
  if (value === null) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

function formatLevel(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function summarizeCryptoSentiment(samples: CryptoSentimentSample[]): CryptoSentimentAggregate | null {
  const cryptoSamples = samples.filter((sample) => sample.type === 'token');
  if (cryptoSamples.length === 0) return null;

  let weightedTotal = 0;
  let totalMentions = 0;

  for (const sample of cryptoSamples) {
    const weight = sample.mentionCount > 0 ? sample.mentionCount : 1;
    weightedTotal += sample.sentiment * weight;
    totalMentions += weight;
  }

  if (totalMentions === 0) return null;

  const average = Math.round((weightedTotal / totalMentions) * 100) / 100;
  const tone = average > 0.2 ? 'bullish' : average < -0.2 ? 'bearish' : 'neutral';

  return {
    average,
    tone,
    mentionCount: totalMentions,
  };
}

export function buildMacroContext(snapshots: MacroSnapshotRow[]): MacroContextSummary {
  const entries = [...snapshots]
    .filter(
      (snapshot) =>
        INDICATOR_ORDER.includes(snapshot.indicator) &&
        typeof snapshot.value === 'number' &&
        Number.isFinite(snapshot.value),
    )
    .sort((a, b) => INDICATOR_ORDER.indexOf(a.indicator) - INDICATOR_ORDER.indexOf(b.indicator))
    .map((snapshot) => ({
      indicator: snapshot.indicator,
      label: getIndicatorLabel(snapshot.indicator),
      value: snapshot.value,
      change1d: snapshot.change1d,
      change7d: snapshot.change7d,
      date: snapshot.date,
      signal: getSignal(snapshot.indicator, snapshot.change1d ?? snapshot.change7d),
      narrative: describeIndicator(snapshot.indicator, snapshot.change1d ?? snapshot.change7d),
    }));

  const riskOn = entries.filter((entry) => entry.signal === 'risk-on').length;
  const riskOff = entries.filter((entry) => entry.signal === 'risk-off').length;

  let overallBias: MacroContextSummary['overallBias'] = 'mixed';
  if (riskOff > riskOn) {
    overallBias = 'risk-off';
  } else if (riskOn > riskOff) {
    overallBias = 'risk-on';
  }

  return { entries, overallBias };
}

export function formatMacroContextLines(
  context: MacroContextSummary,
  cryptoAggregate: CryptoSentimentAggregate | null,
): string[] {
  const lines: string[] = [];

  if (cryptoAggregate) {
    const sign = cryptoAggregate.average > 0 ? '+' : '';
    lines.push(
      `crypto sentiment: ${cryptoAggregate.tone} avg=${sign}${cryptoAggregate.average.toFixed(2)} across ${cryptoAggregate.mentionCount} token mentions`,
    );
  }

  lines.push(`macro bias: ${context.overallBias}`);

  for (const entry of context.entries) {
    lines.push(
      `${entry.label}: ${formatLevel(entry.value)} (1d: ${formatSigned(entry.change1d)}, 7d: ${formatSigned(entry.change7d)}) on ${entry.date} — ${entry.narrative} (${entry.signal})`,
    );
  }

  return lines;
}
