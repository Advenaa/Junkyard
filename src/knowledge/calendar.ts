import {
  getUpcomingCalendarEvents,
  getCalendarEvents,
  getCalendarEventsInRange,
  getOverdueRecurringCalendarEvents,
  updateCalendarEventOccurrence,
  deleteExpiredOneTimeCalendarEvents,
} from '../db/queries.js';
import type { CalendarEventRow } from '../db/queries.js';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';

export type CalendarEventCategory = CalendarEventRow['category'];
export const CALENDAR_RECURRENCE_RULES = ['daily', 'weekly', 'monthly', 'quarterly'] as const;
export type CalendarRecurrenceRule = (typeof CALENDAR_RECURRENCE_RULES)[number];

export interface CalendarEventEntry {
  id: string;
  name: string;
  category: CalendarEventCategory;
  description: string | null;
  recurrenceRule: CalendarRecurrenceRule | null;
  entityId: string | null;
  entityName: string | null;
  nextOccurrence: number;
}

export function isCalendarRecurrenceRule(value: string | null | undefined): value is CalendarRecurrenceRule {
  return value != null && CALENDAR_RECURRENCE_RULES.includes(value as CalendarRecurrenceRule);
}

export function getNextCalendarOccurrence(
  scheduledFor: number,
  recurrenceRule: CalendarRecurrenceRule | null,
  fromTime = Date.now(),
): number {
  if (recurrenceRule == null) {
    return scheduledFor;
  }

  const next = new Date(scheduledFor);
  let guard = 0;

  while (next.getTime() < fromTime && guard < 512) {
    if (recurrenceRule === 'daily') {
      next.setUTCDate(next.getUTCDate() + 1);
    } else if (recurrenceRule === 'weekly') {
      next.setUTCDate(next.getUTCDate() + 7);
    } else if (recurrenceRule === 'monthly') {
      next.setUTCMonth(next.getUTCMonth() + 1);
    } else {
      next.setUTCMonth(next.getUTCMonth() + 3);
    }
    guard += 1;
  }

  if (guard >= 512) {
    throw new Error('Could not compute the next recurring calendar event occurrence');
  }

  return next.getTime();
}

export function getPreviousCalendarOccurrence(
  scheduledFor: number,
  recurrenceRule: CalendarRecurrenceRule,
): number {
  const previous = new Date(scheduledFor);
  if (recurrenceRule === 'daily') {
    previous.setUTCDate(previous.getUTCDate() - 1);
  } else if (recurrenceRule === 'weekly') {
    previous.setUTCDate(previous.getUTCDate() - 7);
  } else if (recurrenceRule === 'monthly') {
    previous.setUTCMonth(previous.getUTCMonth() - 1);
  } else {
    previous.setUTCMonth(previous.getUTCMonth() - 3);
  }
  return previous.getTime();
}

export function createCalendarTracker(pool: Pool, log: Logger) {
  async function refreshLifecycle(now = Date.now()): Promise<{ advanced: number; pruned: number }> {
    const overdue = await getOverdueRecurringCalendarEvents(pool, now);
    let advanced = 0;

    for (const row of overdue) {
      if (!isCalendarRecurrenceRule(row.recurrence_rule)) continue;
      const nextOccurrence = getNextCalendarOccurrence(row.next_occurrence, row.recurrence_rule, now);
      if (nextOccurrence === row.next_occurrence) continue;
      const updated = await updateCalendarEventOccurrence(pool, row.id, nextOccurrence);
      if (updated) advanced += 1;
    }

    const pruneBefore = now - 7 * 24 * 60 * 60 * 1000;
    const pruned = await deleteExpiredOneTimeCalendarEvents(pool, pruneBefore);

    log.info({ advanced, pruned }, 'Refreshed calendar lifecycle');
    return { advanced, pruned };
  }

  async function getUpcomingEvents(startTime: number, endTime: number, limit = 8): Promise<CalendarEventEntry[]> {
    const rows = await getUpcomingCalendarEvents(pool, startTime, endTime, limit);
    const entries: CalendarEventEntry[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      recurrenceRule: isCalendarRecurrenceRule(row.recurrence_rule) ? row.recurrence_rule : null,
      entityId: row.entity_id,
      entityName: row.entity_name,
      nextOccurrence: row.next_occurrence,
    }));

    log.info({ startTime, endTime, count: entries.length }, 'Loaded upcoming calendar events');
    return entries;
  }

  async function getRecentEvents(startTime: number, endTime: number, limit = 6): Promise<CalendarEventEntry[]> {
    const recentRows = await getCalendarEventsInRange(pool, startTime, endTime, limit);
    const futureRecurring = await getCalendarEvents(pool, endTime, 200);

    const oneTimeEntries: CalendarEventEntry[] = recentRows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      recurrenceRule: isCalendarRecurrenceRule(row.recurrence_rule) ? row.recurrence_rule : null,
      entityId: row.entity_id,
      entityName: row.entity_name,
      nextOccurrence: row.next_occurrence,
    }));

    const recurringEntries: CalendarEventEntry[] = [];
    for (const row of futureRecurring) {
      if (!isCalendarRecurrenceRule(row.recurrence_rule)) continue;
      const nextOccurrence = getPreviousCalendarOccurrence(row.next_occurrence, row.recurrence_rule);
      if (nextOccurrence < startTime || nextOccurrence > endTime) continue;
      recurringEntries.push({
        id: row.id,
        name: row.name,
        category: row.category,
        description: row.description,
        recurrenceRule: row.recurrence_rule,
        entityId: row.entity_id,
        entityName: row.entity_name,
        nextOccurrence,
      });
    }

    const deduped = new Map<string, CalendarEventEntry>();
    for (const entry of [...oneTimeEntries, ...recurringEntries]) {
      const existing = deduped.get(entry.id);
      if (!existing || entry.nextOccurrence > existing.nextOccurrence) {
        deduped.set(entry.id, entry);
      }
    }

    const entries = [...deduped.values()].sort((a, b) => b.nextOccurrence - a.nextOccurrence).slice(0, limit);
    log.info({ startTime, endTime, count: entries.length }, 'Loaded recent calendar events');
    return entries;
  }

  return { refreshLifecycle, getUpcomingEvents, getRecentEvents };
}
