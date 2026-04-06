import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALENDAR_RECURRENCE_RULES,
  createCalendarTracker,
  getNextCalendarOccurrence,
  getPreviousCalendarOccurrence,
  isCalendarRecurrenceRule,
} from '../../src/knowledge/calendar.js';

describe('calendar recurrence helpers', () => {
  it('accepts known recurrence rules', () => {
    for (const rule of CALENDAR_RECURRENCE_RULES) {
      assert.equal(isCalendarRecurrenceRule(rule), true);
    }
    assert.equal(isCalendarRecurrenceRule('yearly'), false);
    assert.equal(isCalendarRecurrenceRule(null), false);
  });

  it('returns one-time occurrences unchanged', () => {
    const scheduledFor = Date.UTC(2030, 0, 2, 10, 30);
    assert.equal(getNextCalendarOccurrence(scheduledFor, null, scheduledFor + 60_000), scheduledFor);
  });

  it('advances daily recurring events until they are in the future', () => {
    const scheduledFor = Date.UTC(2030, 0, 1, 10, 30);
    const fromTime = Date.UTC(2030, 0, 3, 9, 0);
    assert.equal(getNextCalendarOccurrence(scheduledFor, 'daily', fromTime), Date.UTC(2030, 0, 3, 10, 30));
  });

  it('advances weekly recurring events by whole weeks', () => {
    const scheduledFor = Date.UTC(2030, 0, 1, 10, 30);
    const fromTime = Date.UTC(2030, 0, 20, 12, 0);
    assert.equal(getNextCalendarOccurrence(scheduledFor, 'weekly', fromTime), Date.UTC(2030, 0, 22, 10, 30));
  });

  it('advances monthly recurring events by calendar month', () => {
    const scheduledFor = Date.UTC(2030, 0, 31, 10, 30);
    const fromTime = Date.UTC(2030, 2, 1, 9, 0);
    assert.equal(getNextCalendarOccurrence(scheduledFor, 'monthly', fromTime), Date.UTC(2030, 2, 3, 10, 30));
  });

  it('advances quarterly recurring events by three months', () => {
    const scheduledFor = Date.UTC(2030, 0, 15, 10, 30);
    const fromTime = Date.UTC(2030, 6, 1, 0, 0);
    assert.equal(getNextCalendarOccurrence(scheduledFor, 'quarterly', fromTime), Date.UTC(2030, 6, 15, 10, 30));
  });

  it('derives the previous occurrence for recurring events', () => {
    const nextOccurrence = Date.UTC(2030, 0, 22, 10, 30);
    assert.equal(getPreviousCalendarOccurrence(nextOccurrence, 'weekly'), Date.UTC(2030, 0, 15, 10, 30));
  });

  it('refreshes overdue recurring events and prunes stale one-time events', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: (params ?? []) as unknown[] });
        if (sql.includes('ce.recurrence_rule IS NOT NULL') && sql.includes('ce.next_occurrence <')) {
          return {
            rows: [
              {
                id: 'cal-1',
                name: 'Weekly unlock',
                category: 'unlock',
                description: null,
                recurrence_rule: 'weekly',
                entity_id: null,
                entity_name: null,
                next_occurrence: Date.UTC(2030, 0, 1, 10, 30),
                created_at: Date.UTC(2029, 11, 1, 0, 0),
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('UPDATE calendar_events SET next_occurrence')) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('DELETE FROM calendar_events') && sql.includes('recurrence_rule IS NULL')) {
          return { rows: [], rowCount: 2 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    const log = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => log,
    } as never;
    const tracker = createCalendarTracker(pool as never, log);

    const result = await tracker.refreshLifecycle(Date.UTC(2030, 0, 20, 0, 0));

    assert.deepEqual(result, { advanced: 1, pruned: 2 });
    const updateCall = calls.find((call) => call.sql.includes('UPDATE calendar_events SET next_occurrence'));
    assert.ok(updateCall, 'expected recurring event occurrence update');
    assert.equal(updateCall!.params[0], 'cal-1');
  });
});
