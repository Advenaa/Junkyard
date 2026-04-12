import pg from 'pg';

import type { CalendarEventRow } from './types.js';

type Pool = pg.Pool;

const CALENDAR_EVENT_SELECT = `SELECT
       ce.id,
       ce.name,
       ce.category,
       ce.description,
       ce.recurrence_rule,
       ce.entity_id,
       e.name AS entity_name,
       ce.next_occurrence,
       ce.created_at
     FROM calendar_events ce
     LEFT JOIN entities e ON e.id = ce.entity_id`;

export async function getCalendarEvents(pool: Pool, fromTime: number, limit = 25): Promise<CalendarEventRow[]> {
  const { rows } = await pool.query<CalendarEventRow>(
    `${CALENDAR_EVENT_SELECT}
      WHERE ce.next_occurrence >= $1
      ORDER BY next_occurrence ASC
      LIMIT $2`,
    [fromTime, limit],
  );
  return rows;
}

export async function getUpcomingCalendarEvents(
  pool: Pool,
  startTime: number,
  endTime: number,
  limit = 8,
): Promise<CalendarEventRow[]> {
  const { rows } = await pool.query<CalendarEventRow>(
    `${CALENDAR_EVENT_SELECT}
      WHERE ce.next_occurrence >= $1
        AND ce.next_occurrence <= $2
      ORDER BY ce.next_occurrence ASC
      LIMIT $3`,
    [startTime, endTime, limit],
  );
  return rows;
}

export async function getCalendarEventsInRange(
  pool: Pool,
  startTime: number,
  endTime: number,
  limit = 25,
): Promise<CalendarEventRow[]> {
  const { rows } = await pool.query<CalendarEventRow>(
    `${CALENDAR_EVENT_SELECT}
      WHERE ce.next_occurrence >= $1
        AND ce.next_occurrence <= $2
      ORDER BY ce.next_occurrence DESC
      LIMIT $3`,
    [startTime, endTime, limit],
  );
  return rows;
}

export async function getOverdueRecurringCalendarEvents(pool: Pool, beforeTime: number): Promise<CalendarEventRow[]> {
  const { rows } = await pool.query<CalendarEventRow>(
    `${CALENDAR_EVENT_SELECT}
      WHERE ce.recurrence_rule IS NOT NULL
        AND ce.next_occurrence < $1
      ORDER BY ce.next_occurrence ASC`,
    [beforeTime],
  );
  return rows;
}

export async function insertCalendarEvent(
  pool: Pool,
  event: {
    id: string;
    name: string;
    category: CalendarEventRow['category'];
    description: string | null;
    recurrenceRule: string | null;
    entityId: string | null;
    nextOccurrence: number;
    createdAt: number;
  },
): Promise<CalendarEventRow> {
  const { rows } = await pool.query<CalendarEventRow>(
    `INSERT INTO calendar_events (id, name, category, description, recurrence_rule, entity_id, next_occurrence, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING
       id,
       name,
       category,
       description,
       recurrence_rule,
       entity_id,
       (SELECT entities.name FROM entities WHERE entities.id = calendar_events.entity_id) AS entity_name,
       next_occurrence,
       created_at`,
    [
      event.id,
      event.name,
      event.category,
      event.description,
      event.recurrenceRule,
      event.entityId,
      event.nextOccurrence,
      event.createdAt,
    ],
  );
  return rows[0]!;
}

export async function getCalendarEventById(pool: Pool, id: string): Promise<CalendarEventRow | null> {
  const { rows } = await pool.query<CalendarEventRow>(
    `${CALENDAR_EVENT_SELECT}
      WHERE ce.id = $1
      LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function updateCalendarEvent(
  pool: Pool,
  event: {
    id: string;
    name: string;
    category: CalendarEventRow['category'];
    description: string | null;
    recurrenceRule: CalendarEventRow['recurrence_rule'];
    entityId: string | null;
    nextOccurrence: number;
  },
): Promise<CalendarEventRow | null> {
  const { rows } = await pool.query<CalendarEventRow>(
    `UPDATE calendar_events
        SET name = $2,
            category = $3,
            description = $4,
            recurrence_rule = $5,
            entity_id = $6,
            next_occurrence = $7
      WHERE id = $1
      RETURNING
        id,
        name,
        category,
        description,
        recurrence_rule,
        entity_id,
        (SELECT entities.name FROM entities WHERE entities.id = calendar_events.entity_id) AS entity_name,
        next_occurrence,
        created_at`,
    [
      event.id,
      event.name,
      event.category,
      event.description,
      event.recurrenceRule,
      event.entityId,
      event.nextOccurrence,
    ],
  );
  return rows[0] ?? null;
}

export async function updateCalendarEventOccurrence(pool: Pool, id: string, nextOccurrence: number): Promise<boolean> {
  const { rowCount } = await pool.query(`UPDATE calendar_events SET next_occurrence = $2 WHERE id = $1`, [
    id,
    nextOccurrence,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function deleteExpiredOneTimeCalendarEvents(pool: Pool, beforeTime: number): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM calendar_events
      WHERE recurrence_rule IS NULL
        AND next_occurrence < $1`,
    [beforeTime],
  );
  return rowCount ?? 0;
}

export async function deleteCalendarEvent(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM calendar_events WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
