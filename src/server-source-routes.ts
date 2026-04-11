import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from './db/connection.js';
import { getAllSourcesWithState, insertSource, type SourceRow, updateSourceTier } from './db/queries.js';
import { getSourceTargetFromRequest, toCamelCase } from './server-route-helpers.js';
import { validateUrl } from './url-validator.js';

type RoutePreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

interface SourceRouteDeps {
  app: FastifyInstance;
  authPreHandler: RoutePreHandler;
  requireAdmin: RoutePreHandler;
  pool: Pool;
}

export function registerSourceRoutes({ app, authPreHandler, requireAdmin, pool }: SourceRouteDeps): void {
  app.get('/api/v1/sources', { preHandler: [authPreHandler] }, async () => {
    const sources = await getAllSourcesWithState(pool);
    return { sources: sources.map((r) => toCamelCase(r as unknown as Record<string, unknown>)) };
  });

  app.post(
    '/api/v1/sources',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['source', 'sourceId'],
          properties: {
            source: { type: 'string', enum: ['discord', 'twitter', 'rss', 'news'] },
            sourceId: { type: 'string', minLength: 1, maxLength: 255 },
            label: { type: 'string', maxLength: 255 },
            poll_interval: { type: 'integer', minimum: 60, maximum: 86400 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { source, sourceId, label, poll_interval } = request.body as {
        source?: string;
        sourceId?: string;
        label?: string;
        poll_interval?: number;
      };
      if (!source || !sourceId) {
        return reply.code(400).send({ error: 'source and sourceId are required' });
      }
      if (source === 'rss') {
        const validation = await validateUrl(sourceId);
        if (!validation.valid) {
          return reply.code(400).send({ error: `Invalid RSS feed URL: ${validation.reason}` });
        }
      }
      if (source === 'discord' && !/^\d{17,20}$/.test(sourceId)) {
        return reply.code(400).send({ error: 'Discord channel ID must be a 17-20 digit snowflake' });
      }
      if (source === 'twitter' && sourceId.startsWith('@') && !/^@[A-Za-z0-9_]{1,39}$/.test(sourceId)) {
        return reply.code(400).send({
          error:
            'Twitter handle must be @username (1-39 chars, letters/numbers/underscores). For search queries, omit the @.',
        });
      }
      try {
        await insertSource(pool, source, sourceId, label ?? null, 1.0, Date.now());
        if (poll_interval != null) {
          await pool.query(`UPDATE sources SET poll_interval = $1 WHERE source = $2 AND source_id = $3`, [
            poll_interval,
            source,
            sourceId,
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
          return reply.code(409).send({ error: 'Source already exists' });
        }
        throw err;
      }
      await pool.query(
        `INSERT INTO source_state (source, source_id, status, error_count)
       VALUES ($1, $2, 'active', 0)
       ON CONFLICT (source, source_id) DO NOTHING`,
        [source, sourceId],
      );
      const { rows } = await pool.query<SourceRow>(`SELECT * FROM sources WHERE source = $1 AND source_id = $2`, [
        source,
        sourceId,
      ]);
      reply.code(201);
      return toCamelCase(rows[0] as unknown as Record<string, unknown>);
    },
  );

  const sourcePatchBodySchema = {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      label: { type: 'string', maxLength: 255 },
      poll_interval: { type: 'integer', minimum: 60, maximum: 86400 },
      tier: { type: 'string', enum: ['alpha', 'influencer', 'general', 'mainstream'] },
    },
    additionalProperties: false,
  } as const;

  const sourceParamsSchema = {
    type: 'object',
    required: ['source'],
    properties: {
      source: { type: 'string', enum: ['discord', 'twitter', 'rss', 'news'] },
    },
  } as const;

  const sourceParamsWithIdSchema = {
    type: 'object',
    required: ['source', 'sourceId'],
    properties: {
      source: { type: 'string', enum: ['discord', 'twitter', 'rss', 'news'] },
      sourceId: { type: 'string' },
    },
  } as const;

  const sourceQuerySchema = {
    type: 'object',
    required: ['sourceId'],
    properties: {
      sourceId: { type: 'string' },
    },
  } as const;

  const patchSourceHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const target = getSourceTargetFromRequest(request);
    if ('error' in target) {
      return reply.code(400).send({ error: 'sourceId is required' });
    }

    const { source, sourceId } = target;
    const { enabled, label, poll_interval, tier } = request.body as {
      enabled?: boolean;
      label?: string;
      poll_interval?: number;
      tier?: string;
    };

    const { rows: stateRows } = await pool.query<{ status: string; last_error: string | null }>(
      `SELECT status, last_error FROM source_state WHERE source = $1 AND source_id = $2`,
      [source, sourceId],
    );
    if (stateRows.length === 0) {
      return reply.code(404).send({ error: 'Source not found' });
    }

    if (label != null) {
      await pool.query(`UPDATE sources SET label = $1 WHERE source = $2 AND source_id = $3`, [label, source, sourceId]);
    }

    if (poll_interval != null) {
      await pool.query(`UPDATE sources SET poll_interval = $1 WHERE source = $2 AND source_id = $3`, [
        poll_interval,
        source,
        sourceId,
      ]);
    }

    if (tier != null) {
      await updateSourceTier(pool, source, sourceId, tier);
    }

    let newStatus = stateRows[0].status;
    if (enabled != null) {
      const currentStatus = stateRows[0].status;
      if (currentStatus === 'halted' && enabled) {
        return reply.code(409).send({
          error: 'Source is halted — fix the underlying issue before re-enabling',
          lastError: stateRows[0].last_error,
        });
      }
      newStatus = enabled ? 'active' : 'disabled';
      await pool.query(`UPDATE source_state SET status = $1 WHERE source = $2 AND source_id = $3`, [
        newStatus,
        source,
        sourceId,
      ]);
    }

    return { source, sourceId, status: newStatus };
  };

  app.patch(
    '/api/v1/sources/:source/:sourceId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: sourcePatchBodySchema,
        params: {
          type: 'object',
          required: ['source', 'sourceId'],
          properties: {
            source: { type: 'string', enum: ['discord', 'twitter', 'rss', 'news'] },
            sourceId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { source, sourceId } = request.params as { source: string; sourceId: string };
      const { enabled, label, poll_interval, tier } = request.body as {
        enabled?: boolean;
        label?: string;
        poll_interval?: number;
        tier?: string;
      };

      const { rows: stateRows } = await pool.query<{ status: string; last_error: string | null }>(
        `SELECT status, last_error FROM source_state WHERE source = $1 AND source_id = $2`,
        [source, sourceId],
      );
      if (stateRows.length === 0) {
        return reply.code(404).send({ error: 'Source not found' });
      }

      if (label != null) {
        await pool.query(`UPDATE sources SET label = $1 WHERE source = $2 AND source_id = $3`, [
          label,
          source,
          sourceId,
        ]);
      }

      if (poll_interval != null) {
        await pool.query(`UPDATE sources SET poll_interval = $1 WHERE source = $2 AND source_id = $3`, [
          poll_interval,
          source,
          sourceId,
        ]);
      }

      if (tier != null) {
        await updateSourceTier(pool, source, sourceId, tier);
      }

      let newStatus = stateRows[0].status;
      if (enabled != null) {
        const currentStatus = stateRows[0].status;
        if (currentStatus === 'halted' && enabled) {
          return reply.code(409).send({
            error: 'Source is halted — fix the underlying issue before re-enabling',
            lastError: stateRows[0].last_error,
          });
        }
        newStatus = enabled ? 'active' : 'disabled';
        await pool.query(`UPDATE source_state SET status = $1 WHERE source = $2 AND source_id = $3`, [
          newStatus,
          source,
          sourceId,
        ]);
      }

      return { source, sourceId, status: newStatus };
    },
  );

  app.patch(
    '/api/v1/sources/:source',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: sourcePatchBodySchema,
        params: sourceParamsSchema,
        querystring: sourceQuerySchema,
      },
    },
    patchSourceHandler,
  );

  const deleteSourceHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const target = getSourceTargetFromRequest(request);
    if ('error' in target) {
      return reply.code(400).send({ error: 'sourceId is required' });
    }

    const { source, sourceId } = target;
    await pool.query('DELETE FROM source_state WHERE source = $1 AND source_id = $2', [source, sourceId]);
    const { rowCount } = await pool.query('DELETE FROM sources WHERE source = $1 AND source_id = $2', [
      source,
      sourceId,
    ]);
    if (!rowCount) {
      return reply.code(404).send({ error: 'Source not found' });
    }
    reply.code(204).send();
  };

  app.delete(
    '/api/v1/sources/:source/:sourceId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: sourceParamsWithIdSchema,
      },
    },
    deleteSourceHandler,
  );

  app.delete(
    '/api/v1/sources/:source',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: sourceParamsSchema,
        querystring: sourceQuerySchema,
      },
    },
    deleteSourceHandler,
  );
}
