import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from './db/connection.js';
import { getFeedbackList, insertFeedback, updateFeedbackStatus } from './db/queries.js';
import { toCamelCase } from './server-route-helpers.js';

type RoutePreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

interface FeedbackRouteDeps {
  app: FastifyInstance;
  authPreHandler: RoutePreHandler;
  requireAdmin: RoutePreHandler;
  pool: Pool;
}

const VALID_TARGET_TYPES = ['summary', 'entity_mention'] as const;
const VALID_CATEGORIES = ['wrong_entity', 'wrong_sentiment', 'wrong_event_type', 'spam', 'other'] as const;
const VALID_STATUSES = ['pending', 'dismissed', 'acknowledged'] as const;

export function registerFeedbackRoutes({ app, authPreHandler, requireAdmin, pool }: FeedbackRouteDeps): void {
  app.post<{ Body: { targetType: string; targetId: string; category: string; note?: string | null } }>(
    '/api/v1/feedback',
    {
      preHandler: [authPreHandler],
      schema: {
        body: {
          type: 'object',
          required: ['targetType', 'targetId', 'category'],
          properties: {
            targetType: { type: 'string', enum: [...VALID_TARGET_TYPES] },
            targetId: { type: 'string', minLength: 1, maxLength: 255 },
            category: { type: 'string', enum: [...VALID_CATEGORIES] },
            note: {
              anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }],
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (request.user?.discordId === 'api-key') {
        return reply.code(400).send({ error: 'Feedback requires a dashboard user session' });
      }

      const { targetType, targetId, category, note } = request.body;
      const id = await insertFeedback(pool, request.user!.discordId, targetType, targetId, category, note ?? null);
      return reply.code(201).send({ id });
    },
  );

  app.get<{ Querystring: { status?: string; limit?: number; offset?: number } }>(
    '/api/v1/feedback',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', minLength: 1, maxLength: 32 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            offset: { type: 'integer', minimum: 0 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { status, limit: rawLimit, offset: rawOffset } = request.query;
      const limit = Math.min(Math.max(rawLimit ?? 50, 1), 200);
      const offset = Math.max(rawOffset ?? 0, 0);

      if (status && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
        return { feedback: [], total: 0 };
      }

      const { rows, total } = await getFeedbackList(pool, { status, limit, offset });
      return {
        feedback: rows.map((row) => toCamelCase<Record<string, unknown>>(row as unknown as Record<string, unknown>)),
        total,
      };
    },
  );

  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/api/v1/feedback/:id',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 255 },
          },
        },
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: [...VALID_STATUSES] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const updated = await updateFeedbackStatus(pool, request.params.id, request.body.status);
      if (!updated) {
        return reply.code(404).send({ error: 'Feedback not found' });
      }
      return { ok: true };
    },
  );
}
