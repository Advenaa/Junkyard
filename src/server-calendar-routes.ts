import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from './db/connection.js';
import {
  deleteCalendarEvent,
  getCalendarEventById,
  getCalendarEvents,
  insertCalendarEvent,
  type CalendarEventRow,
  updateCalendarEvent,
} from './db/queries.js';
import { getNextCalendarOccurrence, isCalendarRecurrenceRule } from './knowledge/calendar.js';
import { normalizeAlias } from './knowledge/entities.js';

type RoutePreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
type ToCamelCase = <T>(obj: Record<string, unknown>) => T;

interface CalendarEntityLookupRow {
  id: string;
  name: string;
}

interface CalendarRouteDeps {
  app: FastifyInstance;
  authPreHandler: RoutePreHandler;
  requireAdmin: RoutePreHandler;
  pool: Pool;
  toCamelCase: ToCamelCase;
}

async function resolveCalendarEntity(
  pool: Pool,
  rawEntityName: string | null | undefined,
): Promise<CalendarEntityLookupRow | null> {
  const trimmed = rawEntityName?.trim();
  if (!trimmed) return null;
  const normalized = normalizeAlias(trimmed);
  const { rows } = await pool.query<CalendarEntityLookupRow>(
    `SELECT DISTINCT e.id, e.name
       FROM entities e
       LEFT JOIN entity_aliases ea ON ea.entity_id = e.id
      WHERE LOWER(e.name) = LOWER($1)
         OR ea.alias = $2
      ORDER BY e.name ASC
      LIMIT 1`,
    [trimmed, normalized],
  );
  return rows[0] ?? null;
}

export function registerCalendarRoutes({
  app,
  authPreHandler,
  requireAdmin,
  pool,
  toCamelCase,
}: CalendarRouteDeps): void {
  app.get('/api/v1/calendar-events', { preHandler: [authPreHandler] }, async () => {
    const events = await getCalendarEvents(pool, Date.now(), 25);
    return { events: events.map((row) => toCamelCase<CalendarEventRow>(row as unknown as Record<string, unknown>)) };
  });

  app.post(
    '/api/v1/calendar-events',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['name', 'category', 'scheduledFor'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            category: {
              type: 'string',
              enum: ['macro', 'unlock', 'expiry', 'governance', 'launch', 'legal', 'custom'],
            },
            entityName: {
              anyOf: [{ type: 'string', minLength: 1, maxLength: 120 }, { type: 'null' }],
            },
            description: {
              anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }],
            },
            scheduledFor: { type: 'integer', minimum: 0 },
            recurrenceRule: {
              anyOf: [{ type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly'] }, { type: 'null' }],
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { name, category, entityName, description, scheduledFor, recurrenceRule } = request.body as {
        name: string;
        category: CalendarEventRow['category'];
        entityName?: string | null;
        description?: string;
        scheduledFor: number;
        recurrenceRule?: CalendarEventRow['recurrence_rule'];
      };
      const trimmedName = name.trim();
      const trimmedDescription = description?.trim() ? description.trim() : null;
      if (!trimmedName) {
        return reply.code(400).send({ error: 'Event name is required' });
      }
      if (recurrenceRule != null && !isCalendarRecurrenceRule(recurrenceRule)) {
        return reply.code(400).send({ error: 'Invalid recurrence rule' });
      }
      if (scheduledFor < Date.now() - 60_000 && recurrenceRule == null) {
        return reply.code(400).send({ error: 'Calendar events must be scheduled in the future' });
      }
      const entity = await resolveCalendarEntity(pool, entityName);
      if (entityName?.trim() && !entity) {
        return reply.code(400).send({ error: 'Linked entity not found' });
      }

      const { ulid } = await import('ulid');
      const row = await insertCalendarEvent(pool, {
        id: ulid(),
        name: trimmedName,
        category,
        description: trimmedDescription,
        recurrenceRule: recurrenceRule ?? null,
        entityId: entity?.id ?? null,
        nextOccurrence: getNextCalendarOccurrence(scheduledFor, recurrenceRule ?? null),
        createdAt: Date.now(),
      });
      reply.code(201);
      return { event: toCamelCase<CalendarEventRow>(row as unknown as Record<string, unknown>) };
    },
  );

  app.patch<{ Params: { eventId: string } }>(
    '/api/v1/calendar-events/:eventId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['eventId'],
          properties: {
            eventId: { type: 'string', minLength: 1 },
          },
        },
        body: {
          type: 'object',
          required: ['name', 'category', 'scheduledFor'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            category: {
              type: 'string',
              enum: ['macro', 'unlock', 'expiry', 'governance', 'launch', 'legal', 'custom'],
            },
            entityName: {
              anyOf: [{ type: 'string', minLength: 1, maxLength: 120 }, { type: 'null' }],
            },
            description: {
              anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }],
            },
            scheduledFor: { type: 'integer', minimum: 0 },
            recurrenceRule: {
              anyOf: [{ type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly'] }, { type: 'null' }],
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const existing = await getCalendarEventById(pool, request.params.eventId);
      if (!existing) {
        return reply.code(404).send({ error: 'Calendar event not found' });
      }

      const { name, category, entityName, description, scheduledFor, recurrenceRule } = request.body as {
        name: string;
        category: CalendarEventRow['category'];
        entityName?: string | null;
        description?: string | null;
        scheduledFor: number;
        recurrenceRule?: CalendarEventRow['recurrence_rule'];
      };

      const trimmedName = name.trim();
      const trimmedDescription = description?.trim() ? description.trim() : null;
      if (!trimmedName) {
        return reply.code(400).send({ error: 'Event name is required' });
      }
      if (recurrenceRule != null && !isCalendarRecurrenceRule(recurrenceRule)) {
        return reply.code(400).send({ error: 'Invalid recurrence rule' });
      }
      if (scheduledFor < Date.now() - 60_000 && recurrenceRule == null) {
        return reply.code(400).send({ error: 'Calendar events must be scheduled in the future' });
      }
      const entity = await resolveCalendarEntity(pool, entityName);
      if (entityName?.trim() && !entity) {
        return reply.code(400).send({ error: 'Linked entity not found' });
      }

      const row = await updateCalendarEvent(pool, {
        id: existing.id,
        name: trimmedName,
        category,
        description: trimmedDescription,
        recurrenceRule: recurrenceRule ?? null,
        entityId: entity?.id ?? null,
        nextOccurrence: getNextCalendarOccurrence(scheduledFor, recurrenceRule ?? null),
      });
      if (!row) {
        return reply.code(404).send({ error: 'Calendar event not found' });
      }
      return { event: toCamelCase<CalendarEventRow>(row as unknown as Record<string, unknown>) };
    },
  );

  app.delete<{ Params: { eventId: string } }>(
    '/api/v1/calendar-events/:eventId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['eventId'],
          properties: {
            eventId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const deleted = await deleteCalendarEvent(pool, request.params.eventId);
      if (!deleted) {
        return reply.code(404).send({ error: 'Calendar event not found' });
      }
      reply.code(204).send();
    },
  );
}
