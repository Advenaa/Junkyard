import type { NarrativeSignalStrength } from './types';

// Shared dashboard formatting helpers. Every date/time string the dashboard
// renders should route through one of these helpers so that format strings
// live in exactly one place — changing "Apr 11 2026, 09:42" everywhere
// becomes a one-line edit instead of a grep-and-pray.
//
// The existing per-page `formatDateTime` / `formatDate` / `formatRange`
// duplications are being migrated onto these helpers. Behavior must stay
// byte-identical to the call sites at the time of migration — the tests in
// `__tests__/formatting.test.ts` pin every output.

/**
 * "Apr 11, 2026, 09:42" — the long date+time format used by SummaryView,
 * rawMessages, and ReportView's `formatDateTime`. Year + short month + day
 * + 2-digit hour:minute.
 */
export function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Same shape as `formatDateTime` but built via `toLocaleDateString` — the
 * variant Search.tsx used. Kept as a distinct helper because the two
 * produce subtly different output on some locales, and we don't want
 * Search's results to shift when the migration lands.
 */
export function formatShortDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * "Apr 11, 2026" — short month, day, year. Used by ReportList for narrative
 * watchlist rows and the report list date column.
 */
export function formatDayMonthYear(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * "April 11, 2026" — long month name. Used by ReportView's header date.
 * Kept separate from `formatDayMonthYear` because the two format strings
 * differ on every character after "Apr"/"April" and we don't want to
 * change either call site's on-screen output during migration.
 */
export function formatLongDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * "Apr 11, 2026, 09:42 - Apr 11, 2026, 17:09" — inclusive range. Used by
 * SummaryView and ReportView for window labels.
 */
export function formatDateTimeRange(start: number, end: number): string {
  return `${formatDateTime(start)} - ${formatDateTime(end)}`;
}

/**
 * Tailwind text-color class for a sentiment score in [-1, 1]. The thresholds
 * (±0.3) match the pipeline's own bucketing in
 * `src/process/synthesize.ts` and the dashboard's legacy per-page copies.
 */
export function sentimentTextColor(sentiment: number): string {
  if (sentiment >= 0.3) return 'text-accent-green';
  if (sentiment <= -0.3) return 'text-accent-red';
  return 'text-text-secondary';
}

/**
 * "Emerging", "Fading", etc. Matches the signal-strength vocabulary used by
 * `src/process/narratives.ts` on the backend.
 */
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
