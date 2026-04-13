import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

import type { CalendarEventRow } from '../../src/db/queries.js';
import { registerCalendarRoutes } from '../../src/server-calendar-routes.js';
import { toCamelCase } from '../../src/server-route-helpers.js';
import { fakeRequest, makeMockLogger, makeMockPool } from '../helpers/factories.js';

interface RouteUser {
  discordId: string;
  username: string;
  role: string;
}

const ADMIN_USER = fakeRequest({
  user: {
    discordId: '123456789012345678',
    username: 'calendar-admin',
    role: 'admin',
  },
}).user as RouteUser;

const VIEWER_USER = fakeRequest({
  user: {
    discordId: '123456789012345678',
    username: 'calendar-viewer',
    role: 'viewer',
  },
}).user as RouteUser;

function createLogger() {
  return Object.assign(makeMockLogger(), {
    trace: (..._args: unknown[]) => {},
  });
}

function authedPreHandler(user: RouteUser = ADMIN_USER) {
  return async (request: FastifyRequest) => {
    request.user = { ...user };
  };
}

async function noAuthPreHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.code(401).send({ error: 'Unauthorized' });
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.user?.role !== 'admin') {
    return reply.code(403).send({ error: 'Admin required' });
  }
}

function createEvent(overrides: Partial<CalendarEventRow> = {}): CalendarEventRow {
  const nextOccurrence = Date.UTC(2026, 3, 15, 8, 0, 0);

  return {
    id: 'event-1',
    name: 'Token Unlock',
    category: 'unlock',
    description: 'Large unlock scheduled',
    recurrence_rule: null,
    entity_id: 'ent-sol',
    entity_name: 'Solana',
    next_occurrence: nextOccurrence,
    created_at: nextOccurrence - 3_600_000,
    ...overrides,
  };
}

function buildApp(
  options: {
    authPreHandler?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
    requireAdminHandler?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
    pool?: ReturnType<typeof makeMockPool>;
  } = {},
) {
  const pool = options.pool ?? makeMockPool();
  const app = fastify({ loggerInstance: createLogger() as never });
  app.decorateRequest('user', null);

  registerCalendarRoutes({
    app,
    authPreHandler: options.authPreHandler ?? authedPreHandler(),
    requireAdmin: options.requireAdminHandler ?? requireAdmin,
    pool: pool as never,
    toCamelCase,
  });

  return { app, pool };
}

describe('registerCalendarRoutes', () => {
  it('rejects unauthenticated requests', async () => {
    const { app, pool } = buildApp({ authPreHandler: noAuthPreHandler });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar-events',
      });

      assert.equal(response.statusCode, 401);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Unauthorized' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('lists calendar events with camelCase response keys', async () => {
    const event = createEvent();
    const pool = makeMockPool((sql) => {
      if (sql.includes('FROM calendar_events ce') && sql.includes('WHERE ce.next_occurrence >= $1')) {
        return { rows: [event] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar-events',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        events: [
          {
            id: 'event-1',
            name: 'Token Unlock',
            category: 'unlock',
            description: 'Large unlock scheduled',
            recurrenceRule: null,
            entityId: 'ent-sol',
            entityName: 'Solana',
            nextOccurrence: event.next_occurrence,
            createdAt: event.created_at,
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('requires admin access to create calendar events', async () => {
    const { app, pool } = buildApp({ authPreHandler: authedPreHandler(VIEWER_USER) });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar-events',
        payload: {
          name: 'Token Unlock',
          category: 'unlock',
          scheduledFor: Date.now() + 3_600_000,
        },
      });

      assert.equal(response.statusCode, 403);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Admin required' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('validates calendar event request bodies', async () => {
    const { app, pool } = buildApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar-events',
        payload: {
          name: 'Token Unlock',
          category: 'invalid-category',
          scheduledFor: Date.now() + 3_600_000,
        },
      });

      assert.equal(response.statusCode, 400);
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('rejects one-time events scheduled in the past', async () => {
    const { app, pool } = buildApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar-events',
        payload: {
          name: 'Old Event',
          category: 'custom',
          scheduledFor: Date.now() - 120_000,
        },
      });

      assert.equal(response.statusCode, 400);
      assert.deepStrictEqual(JSON.parse(response.body), {
        error: 'Calendar events must be scheduled in the future',
      });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('rejects calendar events that reference a missing entity', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT DISTINCT e.id, e.name')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar-events',
        payload: {
          name: 'Token Unlock',
          category: 'unlock',
          entityName: 'Missing',
          scheduledFor: Date.now() + 3_600_000,
        },
      });

      assert.equal(response.statusCode, 400);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Linked entity not found' });
    } finally {
      await app.close();
    }
  });

  it('creates calendar events for valid requests', async () => {
    const scheduledFor = Date.UTC(2026, 3, 16, 12, 0, 0);
    const pool = makeMockPool((sql, params = []) => {
      if (sql.includes('SELECT DISTINCT e.id, e.name')) {
        return {
          rows: [{ id: 'ent-sol', name: 'Solana' }],
        };
      }

      if (sql.includes('INSERT INTO calendar_events')) {
        const [id, name, category, description, recurrenceRule, entityId, nextOccurrence, createdAt] = params;
        return {
          rows: [
            {
              id,
              name,
              category,
              description,
              recurrence_rule: recurrenceRule,
              entity_id: entityId,
              entity_name: 'Solana',
              next_occurrence: nextOccurrence,
              created_at: createdAt,
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/calendar-events',
        payload: {
          name: '  Token Unlock  ',
          category: 'unlock',
          entityName: 'Solana',
          description: '  Large unlock scheduled  ',
          scheduledFor,
        },
      });

      assert.equal(response.statusCode, 201);
      const body = JSON.parse(response.body) as { event: Record<string, unknown> };
      assert.deepStrictEqual(body.event, {
        id: body.event.id,
        name: 'Token Unlock',
        category: 'unlock',
        description: 'Large unlock scheduled',
        recurrenceRule: null,
        entityId: 'ent-sol',
        entityName: 'Solana',
        nextOccurrence: scheduledFor,
        createdAt: body.event.createdAt,
      });
    } finally {
      await app.close();
    }
  });

  it('returns 404 when updating a missing calendar event', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('FROM calendar_events ce') && sql.includes('WHERE ce.id = $1')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/calendar-events/event-missing',
        payload: {
          name: 'Updated Event',
          category: 'custom',
          scheduledFor: Date.now() + 3_600_000,
        },
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Calendar event not found' });
    } finally {
      await app.close();
    }
  });

  it('updates existing calendar events', async () => {
    const existing = createEvent({ id: 'event-2', entity_id: null, entity_name: null });
    const scheduledFor = Date.UTC(2026, 3, 18, 12, 0, 0);
    const pool = makeMockPool((sql, params = []) => {
      if (sql.includes('FROM calendar_events ce') && sql.includes('WHERE ce.id = $1')) {
        return { rows: [existing] };
      }

      if (sql.includes('UPDATE calendar_events')) {
        const [id, name, category, description, recurrenceRule, entityId, nextOccurrence] = params;
        return {
          rows: [
            {
              id,
              name,
              category,
              description,
              recurrence_rule: recurrenceRule,
              entity_id: entityId,
              entity_name: null,
              next_occurrence: nextOccurrence,
              created_at: existing.created_at,
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/calendar-events/event-2',
        payload: {
          name: '  Updated Event ',
          category: 'custom',
          description: '  Refined details  ',
          entityName: null,
          scheduledFor,
        },
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        event: {
          id: 'event-2',
          name: 'Updated Event',
          category: 'custom',
          description: 'Refined details',
          recurrenceRule: null,
          entityId: null,
          entityName: null,
          nextOccurrence: scheduledFor,
          createdAt: existing.created_at,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns 404 when deleting a missing calendar event', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('DELETE FROM calendar_events WHERE id = $1')) {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/calendar-events/event-missing',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Calendar event not found' });
    } finally {
      await app.close();
    }
  });

  it('deletes existing calendar events', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('DELETE FROM calendar_events WHERE id = $1')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/calendar-events/event-1',
      });

      assert.equal(response.statusCode, 204);
      assert.equal(response.body, '');
    } finally {
      await app.close();
    }
  });
});
