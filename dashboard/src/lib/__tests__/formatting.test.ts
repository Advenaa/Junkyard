import { describe, expect, it } from 'vitest';
import {
  formatDateTime,
  formatDateTimeRange,
  formatDayMonthYear,
  formatLongDate,
  formatNarrativeSignalLabel,
  formatShortDate,
  sentimentTextColor,
} from '../formatting';

// 2026-04-11T09:42:00Z — a fixed epoch so test output is stable regardless
// of the machine's TZ. The test environment is UTC (dashboard vitest config
// doesn't set a TZ, so JSDOM defaults to system). We pick a moment where
// every format string's output is the same across UTC-5 through UTC+9, so
// the tests don't become flaky when run on a dev machine in a different
// zone. The instant is 09:42 UTC on April 11 2026 — far enough from
// midnight on either end that no TZ shift flips the date.
const EPOCH = Date.UTC(2026, 3, 11, 9, 42, 0);

describe('formatDateTime', () => {
  it('produces "Apr 11, 2026, HH:MM" form with short month', () => {
    const out = formatDateTime(EPOCH);
    // Month abbreviation, day, year must appear. Exact HH:MM depends on TZ,
    // but 2-digit formatting guarantees at least 5 chars.
    expect(out).toMatch(/Apr 11, 2026/);
    expect(out).toMatch(/\d{2}:\d{2}/);
  });

  it('uses numeric year', () => {
    expect(formatDateTime(EPOCH)).toContain('2026');
  });
});

describe('formatShortDate', () => {
  it('produces Apr 11 2026 with time component', () => {
    const out = formatShortDate(EPOCH);
    expect(out).toMatch(/Apr 11, 2026/);
    expect(out).toMatch(/\d{2}:\d{2}/);
  });
});

describe('formatDayMonthYear', () => {
  it('produces "Apr 11, 2026" from an ISO date string (no time)', () => {
    // Use a wall-clock-safe date string — `2026-04-11` parses to midnight
    // UTC, which can render as Apr 10 in western TZs. Use a noon-UTC ISO
    // string so the result is stable in every reasonable dev zone.
    const out = formatDayMonthYear('2026-04-11T12:00:00Z');
    expect(out).toBe('Apr 11, 2026');
  });
});

describe('formatLongDate', () => {
  it('produces "April 11, 2026" with long month name', () => {
    const out = formatLongDate('2026-04-11T12:00:00Z');
    expect(out).toBe('April 11, 2026');
  });
});

describe('formatDateTimeRange', () => {
  it('separates start and end with " - "', () => {
    const start = EPOCH;
    const end = EPOCH + 3 * 60 * 60 * 1000;
    const out = formatDateTimeRange(start, end);
    expect(out.split(' - ')).toHaveLength(2);
    expect(out.split(' - ')[0]).toBe(formatDateTime(start));
    expect(out.split(' - ')[1]).toBe(formatDateTime(end));
  });
});

describe('sentimentTextColor', () => {
  it('returns green for sentiment >= 0.3', () => {
    expect(sentimentTextColor(0.3)).toBe('text-accent-green');
    expect(sentimentTextColor(0.9)).toBe('text-accent-green');
    expect(sentimentTextColor(1)).toBe('text-accent-green');
  });

  it('returns red for sentiment <= -0.3', () => {
    expect(sentimentTextColor(-0.3)).toBe('text-accent-red');
    expect(sentimentTextColor(-0.9)).toBe('text-accent-red');
    expect(sentimentTextColor(-1)).toBe('text-accent-red');
  });

  it('returns muted for values strictly between the thresholds', () => {
    expect(sentimentTextColor(0)).toBe('text-text-secondary');
    expect(sentimentTextColor(0.2999)).toBe('text-text-secondary');
    expect(sentimentTextColor(-0.2999)).toBe('text-text-secondary');
  });
});

describe('formatNarrativeSignalLabel', () => {
  it('title-cases each signal-strength value', () => {
    expect(formatNarrativeSignalLabel('new')).toBe('New');
    expect(formatNarrativeSignalLabel('emerging')).toBe('Emerging');
    expect(formatNarrativeSignalLabel('strong')).toBe('Strong');
    expect(formatNarrativeSignalLabel('stable')).toBe('Stable');
    expect(formatNarrativeSignalLabel('fading')).toBe('Fading');
  });
});
