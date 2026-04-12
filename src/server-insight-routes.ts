import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Pool } from './db/connection.js';
import {
  getAppConfig,
  getLatestMacroSnapshots,
  getNarrativeDrilldownById,
  getNarrativeWatchlist,
  getPriceWatchOverview,
  getRecentAlphaWatchlist,
  getRecentFirstMoverWatchlist,
  getUnusualActivityOverview,
} from './db/queries.js';
import { featureDisabledResponse } from './features.js';
import { buildMacroContext } from './macro/context.js';

type AuthPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface InsightRouteDeps {
  app: FastifyInstance;
  authPreHandler: AuthPreHandler;
  config: Config;
  pool: Pool;
  getNarrativeSummaryPreview: (body: string) => string;
}

const watchlistQuerystringSchema = {
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 20 },
    days: { type: 'integer', minimum: 1, maximum: 30 },
  },
  additionalProperties: false,
} as const;

function getRecentWindow(query: { limit?: number; days?: number }): { limit: number; sinceTime: number } {
  const limit = query.limit ?? 8;
  const days = query.days ?? 7;
  return {
    limit,
    sinceTime: Date.now() - days * 24 * 60 * 60 * 1000,
  };
}

export function registerInsightRoutes({
  app,
  authPreHandler,
  config,
  pool,
  getNarrativeSummaryPreview,
}: InsightRouteDeps): void {
  app.get('/api/v1/macro', { preHandler: [authPreHandler] }, async (_request, reply) => {
    if (config.disabledFeatures.macro.disabled) {
      return reply.code(503).send(featureDisabledResponse(config.disabledFeatures, 'macro'));
    }

    const snapshots = await getLatestMacroSnapshots(pool);
    const macroContext = buildMacroContext(snapshots);

    if (macroContext.entries.length === 0) {
      return reply.code(404).send({ error: 'No macro data available yet' });
    }

    const latestDate = macroContext.entries.reduce(
      (latest, entry) => (!latest || entry.date > latest ? entry.date : latest),
      macroContext.entries[0]?.date ?? null,
    );

    return {
      overallBias: macroContext.overallBias,
      latestDate,
      entries: macroContext.entries,
    };
  });

  app.get('/api/v1/unusual-activity', { preHandler: [authPreHandler] }, async (_request, reply) => {
    try {
      const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';
      return await getUnusualActivityOverview(pool, 8, timezone);
    } catch (err: unknown) {
      app.log.error({ err }, 'unusual-activity: query failed');
      return reply.code(200).send({ latestDate: null, entries: [] });
    }
  });

  app.get('/api/v1/price-watch', { preHandler: [authPreHandler] }, async (_request, reply) => {
    if (config.disabledFeatures.prices.disabled) {
      return reply.code(503).send(featureDisabledResponse(config.disabledFeatures, 'prices'));
    }
    return getPriceWatchOverview(pool, 8);
  });

  app.get<{
    Querystring: { limit?: number; days?: number };
  }>(
    '/api/v1/alpha-watch',
    {
      preHandler: [authPreHandler],
      schema: {
        querystring: watchlistQuerystringSchema,
      },
    },
    async (request) => {
      const { limit, sinceTime } = getRecentWindow(request.query);
      return getRecentAlphaWatchlist(pool, sinceTime, limit);
    },
  );

  app.get<{
    Querystring: { limit?: number; days?: number };
  }>(
    '/api/v1/first-movers',
    {
      preHandler: [authPreHandler],
      schema: {
        querystring: watchlistQuerystringSchema,
      },
    },
    async (request) => {
      const { limit, sinceTime } = getRecentWindow(request.query);
      return getRecentFirstMoverWatchlist(pool, sinceTime, limit);
    },
  );

  app.get('/api/v1/narratives', { preHandler: [authPreHandler] }, async (_request, reply) => {
    if (config.disabledFeatures.embeddings.disabled) {
      return reply.code(503).send(featureDisabledResponse(config.disabledFeatures, 'embeddings'));
    }
    return getNarrativeWatchlist(pool, 8);
  });

  app.get('/api/v1/narratives/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    if (config.disabledFeatures.embeddings.disabled) {
      return reply.code(503).send(featureDisabledResponse(config.disabledFeatures, 'embeddings'));
    }
    const { id } = request.params as { id: string };
    const narrative = await getNarrativeDrilldownById(pool, id, 4);

    if (!narrative) {
      return reply.code(404).send({ error: 'Narrative not found' });
    }

    return {
      narrative: {
        id: narrative.id,
        name: narrative.name,
        date: narrative.date,
        memberCount: narrative.memberCount,
        avgSentiment: narrative.avgSentiment,
        signalStrength: narrative.signalStrength,
        summaries: narrative.summaries.map((summary) => ({
          id: summary.id,
          source: summary.source,
          sourceId: summary.sourceId,
          sentiment: summary.sentiment,
          urgency: summary.urgency,
          itemCount: summary.itemCount,
          createdAt: summary.createdAt,
          text: getNarrativeSummaryPreview(summary.body),
        })),
      },
    };
  });
}
