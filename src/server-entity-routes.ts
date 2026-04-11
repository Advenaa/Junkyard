import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Pool } from './db/connection.js';
import {
  deleteEntityRelationship,
  getAlphaPropagationByEntity,
  getAlphaPropagationSummary,
  getAuthorById,
  getAuthorCalls,
  getCompetitors,
  getEntityDivergence,
  getEntityRelationshipGraph,
  getEntityRelationships,
  getLatestPriceSnapshot,
  getPriceHistory,
  getTopAuthorsByEntity,
  getTopDivergentEntities,
  upsertEntityRelationship,
  type EntityRelationshipSource,
  type EntityRelationshipType,
} from './db/queries.js';
import { featureDisabledResponse } from './features.js';
import { normalizeAlias } from './knowledge/entities.js';
import { type EntitySearchSuggestionRow, toCamelCase } from './server-route-helpers.js';

type RoutePreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

interface EntityRouteDeps {
  app: FastifyInstance;
  authPreHandler: RoutePreHandler;
  config: Config;
  pool: Pool;
  requireAdmin: RoutePreHandler;
}

export function registerEntityRoutes({ app, authPreHandler, config, pool, requireAdmin }: EntityRouteDeps): void {
  app.get<{ Querystring: { q: string; limit?: number; status?: 'active' | 'archived' } }>(
    '/api/v1/entities/search',
    {
      preHandler: [authPreHandler],
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 2, maxLength: 100 },
            limit: { type: 'integer', minimum: 1, maximum: 10 },
            status: { type: 'string', enum: ['active', 'archived'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const rawQuery = request.query.q.trim();
      const normalizedQuery = normalizeAlias(rawQuery);
      if (!rawQuery || !normalizedQuery) {
        return { entities: [] };
      }

      const rawPrefix = `${rawQuery.toLowerCase()}%`;
      const aliasPrefix = `${normalizedQuery}%`;
      const limit = Math.min(Math.max(request.query.limit ?? 6, 1), 10);
      const params: Array<string | number> = [rawPrefix, aliasPrefix, rawQuery.toLowerCase(), normalizedQuery];
      const statusFilter = request.query.status;
      const statusClause =
        statusFilter == null
          ? ''
          : (() => {
              params.push(statusFilter);
              return ` AND e.status = $${params.length}`;
            })();

      params.push(limit);
      const limitPlaceholder = `$${params.length}`;

      const { rows } = await pool.query<EntitySearchSuggestionRow>(
        `SELECT id, name, matched_alias, status, relevance, last_seen
           FROM (
             SELECT DISTINCT ON (e.id)
                    e.id,
                    e.name,
                    CASE
                      WHEN ea.alias IS NOT NULL AND ea.alias LIKE $2 AND ea.alias <> LOWER(e.name) THEN ea.alias
                      ELSE NULL
                    END AS matched_alias,
                    CASE
                      WHEN LOWER(e.name) = $3 THEN 0
                      WHEN ea.alias = $4 THEN 1
                      WHEN LOWER(e.name) LIKE $1 THEN 2
                      ELSE 3
                    END AS rank,
                    e.status,
                    e.relevance,
                    e.last_seen
               FROM entities e
               LEFT JOIN entity_aliases ea ON ea.entity_id = e.id
              WHERE (LOWER(e.name) LIKE $1
                 OR ea.alias LIKE $2)
                ${statusClause}
              ORDER BY e.id,
                       rank ASC,
                       LENGTH(e.name) ASC,
                       e.name ASC
           ) ranked
          ORDER BY rank ASC, LENGTH(name) ASC, name ASC
          LIMIT ${limitPlaceholder}`,
        params,
      );

      return {
        entities: rows.map((row) => ({
          id: row.id,
          name: row.name,
          matchedAlias: row.matched_alias,
          status: row.status,
          relevance: row.relevance,
          lastSeen: row.last_seen,
        })),
      };
    },
  );

  app.get<{ Params: { entityId: string } }>(
    '/api/v1/entities/:entityId/relationships',
    {
      preHandler: [authPreHandler],
      schema: {
        params: {
          type: 'object',
          required: ['entityId'],
          properties: {
            entityId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      const rows = await getEntityRelationships(pool, request.params.entityId);
      return { relationships: rows };
    },
  );

  app.get<{
    Params: { entityId: string };
    Querystring: { depth?: number; limit?: number };
  }>(
    '/api/v1/entities/:entityId/graph',
    {
      preHandler: [authPreHandler],
      schema: {
        params: {
          type: 'object',
          required: ['entityId'],
          properties: {
            entityId: { type: 'string', minLength: 1 },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            depth: { type: 'integer', minimum: 1, maximum: 2 },
            limit: { type: 'integer', minimum: 1, maximum: 24 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const graph = await getEntityRelationshipGraph(
        pool,
        request.params.entityId,
        request.query.depth ?? 2,
        request.query.limit ?? 18,
      );
      if (!graph) {
        return reply.code(404).send({ error: 'Entity not found' });
      }
      return graph;
    },
  );

  app.get<{ Params: { entityId: string } }>(
    '/api/v1/entities/:entityId/competitors',
    {
      preHandler: [authPreHandler],
      schema: {
        params: {
          type: 'object',
          required: ['entityId'],
          properties: {
            entityId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      const rows = await getCompetitors(pool, request.params.entityId);
      return { competitors: rows };
    },
  );

  app.post<{
    Body: {
      entityIdA: string;
      entityIdB: string;
      relationshipType: EntityRelationshipType;
      confidence?: number;
      source?: EntityRelationshipSource;
      sinceAt?: number;
      untilAt?: number;
    };
  }>(
    '/api/v1/entities/relationships',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['entityIdA', 'entityIdB', 'relationshipType'],
          properties: {
            entityIdA: { type: 'string', minLength: 1 },
            entityIdB: { type: 'string', minLength: 1 },
            relationshipType: {
              type: 'string',
              enum: [
                'competes_with',
                'built_on',
                'invested_in',
                'forked_from',
                'acquired',
                'founded',
                'advises',
                'partnered_with',
                'regulated_by',
              ],
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            source: {
              type: 'string',
              enum: ['llm_inferred', 'manual', 'coingecko'],
            },
            sinceAt: { type: 'number' },
            untilAt: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { entityIdA, entityIdB, relationshipType, confidence, source, sinceAt, untilAt } = request.body;
      if (entityIdA === entityIdB) {
        return reply.code(400).send({ error: 'entityIdA and entityIdB must be different' });
      }
      if (sinceAt != null && untilAt != null && untilAt < sinceAt) {
        return reply.code(400).send({ error: 'untilAt must be greater than or equal to sinceAt' });
      }
      await upsertEntityRelationship(
        pool,
        entityIdA,
        entityIdB,
        relationshipType,
        confidence ?? 0.7,
        source ?? 'manual',
        null,
        sinceAt ?? null,
        untilAt ?? null,
      );
      reply.code(201).send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/entities/relationships/:id',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const deleted = await deleteEntityRelationship(pool, request.params.id);
      if (!deleted) {
        return reply.code(404).send({ error: 'Relationship not found' });
      }
      reply.code(204).send();
    },
  );

  app.get<{ Querystring: { days?: number; limit?: number } }>(
    '/api/v1/divergence',
    {
      preHandler: [authPreHandler],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'integer', minimum: 1, maximum: 90 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const days = request.query.days ?? 7;
      const limit = request.query.limit ?? 20;
      const endTime = Date.now();
      const startTime = endTime - days * 24 * 60 * 60 * 1000;
      const rows = await getTopDivergentEntities(pool, startTime, endTime, limit);
      return {
        divergences: rows.map((r) => toCamelCase<Record<string, unknown>>(r as unknown as Record<string, unknown>)),
      };
    },
  );

  app.get<{ Params: { entityId: string }; Querystring: { days?: number } }>(
    '/api/v1/entities/:entityId/divergence',
    {
      preHandler: [authPreHandler],
      schema: {
        params: {
          type: 'object',
          required: ['entityId'],
          properties: {
            entityId: { type: 'string', minLength: 1 },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'integer', minimum: 1, maximum: 90 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const days = request.query.days ?? 7;
      const endTime = Date.now();
      const startTime = endTime - days * 24 * 60 * 60 * 1000;
      const row = await getEntityDivergence(pool, request.params.entityId, startTime, endTime);
      if (row.engMentions === 0 && row.indMentions === 0) {
        return reply.code(404).send({ error: 'No divergence data for this entity' });
      }
      return {
        divergence: toCamelCase<Record<string, unknown>>(row as unknown as Record<string, unknown>),
      };
    },
  );

  app.get<{
    Params: { entityId: string };
    Querystring: { days?: number; limit?: number };
  }>(
    '/api/v1/entities/:entityId/price',
    {
      preHandler: [authPreHandler],
      schema: {
        params: {
          type: 'object',
          required: ['entityId'],
          properties: { entityId: { type: 'string', minLength: 1 } },
        },
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'integer', minimum: 1, maximum: 365 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (config.disabledFeatures.prices.disabled) {
        return reply.code(503).send(featureDisabledResponse(config.disabledFeatures, 'prices'));
      }

      const { entityId } = request.params;
      const days = request.query.days ?? 7;
      const queryLimit = request.query.limit ?? 30;
      const endTime = Date.now();
      const startTime = endTime - days * 24 * 60 * 60 * 1000;

      const latest = await getLatestPriceSnapshot(pool, entityId);
      const history = await getPriceHistory(pool, entityId, startTime, endTime, queryLimit);

      if (!latest && history.length === 0) {
        return reply.code(404).send({ error: 'No price data for this entity' });
      }

      return {
        latest: latest ? toCamelCase<Record<string, unknown>>(latest as unknown as Record<string, unknown>) : null,
        history: history.map((row) => toCamelCase<Record<string, unknown>>(row as unknown as Record<string, unknown>)),
      };
    },
  );

  app.get<{
    Params: { entityId: string };
    Querystring: { days?: number };
  }>(
    '/api/v1/entities/:entityId/alpha',
    {
      preHandler: [authPreHandler],
      schema: {
        params: {
          type: 'object',
          required: ['entityId'],
          properties: { entityId: { type: 'string', minLength: 1 } },
        },
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'integer', minimum: 1, maximum: 30 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { entityId } = request.params;
      const days = request.query.days ?? 7;
      const sinceTime = Date.now() - days * 24 * 60 * 60 * 1000;

      const summary = await getAlphaPropagationSummary(pool, entityId, sinceTime);
      const records = await getAlphaPropagationByEntity(pool, entityId, sinceTime);

      if (summary.length === 0 && records.length === 0) {
        return reply.code(404).send({ error: 'No alpha propagation data for this entity' });
      }

      return {
        summary: summary.map((s) => ({
          tier: s.tier,
          firstMentionTime: s.firstMentionTime,
          source: s.source,
          sourceId: s.sourceId,
        })),
        records: records.map((r) => toCamelCase<Record<string, unknown>>(r as unknown as Record<string, unknown>)),
      };
    },
  );

  app.get<{
    Params: { entityId: string };
    Querystring: { limit?: number };
  }>(
    '/api/v1/entities/:entityId/authors',
    {
      preHandler: [authPreHandler],
      schema: {
        params: {
          type: 'object',
          required: ['entityId'],
          properties: { entityId: { type: 'string', minLength: 1 } },
        },
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 50 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { entityId } = request.params;
      const queryLimit = request.query.limit ?? 10;
      const authors = await getTopAuthorsByEntity(pool, entityId, queryLimit);
      return {
        authors: authors.map((a) => ({
          ...toCamelCase<Record<string, unknown>>(a as unknown as Record<string, unknown>),
          entityMentionCount: a.entityMentionCount,
        })),
      };
    },
  );

  app.get<{
    Params: { authorId: string };
    Querystring: { callLimit?: number };
  }>(
    '/api/v1/authors/:authorId',
    {
      preHandler: [authPreHandler],
      schema: {
        params: {
          type: 'object',
          required: ['authorId'],
          properties: { authorId: { type: 'string', minLength: 1 } },
        },
        querystring: {
          type: 'object',
          properties: {
            callLimit: { type: 'integer', minimum: 1, maximum: 50 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { authorId } = request.params;
      const callLimit = request.query.callLimit ?? 20;
      const author = await getAuthorById(pool, authorId);
      if (!author) {
        return reply.code(404).send({ error: 'Author not found' });
      }
      const calls = await getAuthorCalls(pool, authorId, callLimit);
      return {
        author: toCamelCase<Record<string, unknown>>(author as unknown as Record<string, unknown>),
        calls: calls.map((c) => toCamelCase<Record<string, unknown>>(c as unknown as Record<string, unknown>)),
      };
    },
  );
}
