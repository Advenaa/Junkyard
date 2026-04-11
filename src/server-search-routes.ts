import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Pool } from './db/connection.js';
import {
  getMacroRegimeHistoryByReport,
  getRecentReportChainDrilldowns,
  type ItemRow,
  type ReportRow,
  type SummaryRow,
} from './db/queries.js';
import { featureDisabledResponse } from './features.js';
import {
  type ChatHandler,
  extractMacroRegime,
  extractReportEntityNames,
  extractStringArrayField,
  getReportPreviewChains,
  getReportSearchPreview,
  getSummarySearchPreview,
  parseItemRecord,
  parseReportBody,
  REPORT_EVENT_CHAIN_LOOKBACK_MS,
  REPORT_PREVIEW_CHAIN_DRILLDOWN_LIMIT,
  toCamelCase,
} from './server-route-helpers.js';

type RoutePreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

interface SearchRouteDeps {
  app: FastifyInstance;
  authPreHandler: RoutePreHandler;
  chatHandler?: ChatHandler;
  config: Config;
  pool: Pool;
}

export function registerSearchRoutes({ app, authPreHandler, chatHandler, config, pool }: SearchRouteDeps): void {
  app.get(
    '/api/v1/search',
    {
      preHandler: [authPreHandler],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', minLength: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            days: { type: 'integer', minimum: 1, maximum: 365 },
            mode: { type: 'string', enum: ['keyword', 'semantic'] },
            scope: { type: 'string', enum: ['summary', 'report', 'all'] },
          },
          required: ['q'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const {
        q,
        limit: rawLimit,
        days: rawDays,
        mode: rawMode,
        scope: rawScope,
      } = request.query as {
        q: string;
        limit?: number;
        days?: number;
        mode?: 'keyword' | 'semantic';
        scope?: 'summary' | 'report' | 'all';
      };
      const mode = rawMode ?? 'keyword';
      if (mode === 'semantic') {
        if (config.disabledFeatures.embeddings.disabled) {
          return reply.code(503).send(featureDisabledResponse(config.disabledFeatures, 'embeddings'));
        }
        return reply.code(501).send({ error: 'semantic search is only available via the chat interface' });
      }
      const limit = Math.min(Math.max(rawLimit ?? 20, 1), 100);
      const days = Math.min(Math.max(rawDays ?? 30, 1), 365);
      const scope = rawScope ?? 'summary';
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const likeQuery = `%${q}%`;
      const normalizedQuery = q.toLowerCase();
      const summaryPrefetchLimit = Math.max(limit * 3, 30);

      const summaryResults =
        scope === 'report'
          ? []
          : (
              await pool.query<SummaryRow>(
                `SELECT * FROM summaries WHERE body ILIKE $1 AND created_at > $2 ORDER BY created_at DESC LIMIT $3`,
                [likeQuery, cutoff, summaryPrefetchLimit],
              )
            ).rows
              .map((row) => ({
                row,
                bodyPreview: getSummarySearchPreview(row.body),
              }))
              .filter(({ bodyPreview }) => bodyPreview.toLowerCase().includes(normalizedQuery))
              .slice(0, limit)
              .map(({ row, bodyPreview }) =>
                toCamelCase<Record<string, unknown>>({
                  ...row,
                  body: bodyPreview,
                  result_type: 'summary',
                } as Record<string, unknown>),
              );

      const reportResults =
        scope === 'summary'
          ? []
          : await Promise.all(
              (
                await pool.query<Pick<ReportRow, 'id' | 'date' | 'type' | 'body' | 'tldr' | 'created_at'>>(
                  `SELECT id, date, type, body, tldr, created_at
                     FROM reports
                    WHERE (COALESCE(tldr, '') ILIKE $1 OR body ILIKE $1)
                      AND created_at > $2
                    ORDER BY created_at DESC
                    LIMIT $3`,
                  [likeQuery, cutoff, limit],
                )
              ).rows.map(async (row) => {
                const report = toCamelCase<Record<string, unknown>>({
                  id: row.id,
                  date: row.date,
                  report_type: row.type,
                  body: getReportSearchPreview(row.tldr, row.body),
                  created_at: row.created_at,
                  result_type: 'report',
                });
                const parsed = parseReportBody(row.body);
                const marketCatalysts = extractStringArrayField(parsed?.marketCatalysts ?? parsed?.market_catalysts, 1);
                if (marketCatalysts.length > 0) {
                  report.marketCatalysts = marketCatalysts;
                }
                const regionalDivergence = extractStringArrayField(
                  parsed?.regionalDivergence ?? parsed?.regional_divergence,
                  1,
                );
                if (regionalDivergence.length > 0) {
                  report.regionalDivergence = regionalDivergence;
                }
                const narrativeShifts = extractStringArrayField(parsed?.narrativeShifts ?? parsed?.narrative_shifts, 1);
                if (narrativeShifts.length > 0) {
                  report.narrativeShifts = narrativeShifts;
                }
                const firstMovers = extractStringArrayField(parsed?.firstMovers ?? parsed?.first_movers, 1);
                if (firstMovers.length > 0) {
                  report.firstMovers = firstMovers;
                }
                const priceAlerts = extractStringArrayField(parsed?.priceAlerts ?? parsed?.price_alerts, 1);
                if (priceAlerts.length > 0) {
                  report.priceAlerts = priceAlerts;
                }
                const alphaSignals = extractStringArrayField(parsed?.alphaSignals ?? parsed?.alpha_signals, 1);
                if (alphaSignals.length > 0) {
                  report.alphaSignals = alphaSignals;
                }
                const unusualActivity = extractStringArrayField(parsed?.unusualActivity ?? parsed?.unusual_activity, 1);
                if (unusualActivity.length > 0) {
                  report.unusualActivity = unusualActivity;
                }
                const macroAlerts = extractStringArrayField(parsed?.macroAlerts ?? parsed?.macro_alerts, 1);
                if (macroAlerts.length > 0) {
                  report.macroAlerts = macroAlerts;
                }
                const macroRegime = extractMacroRegime(parsed?.macroRegime ?? parsed?.macro_regime);
                if (macroRegime) {
                  report.macroRegime = macroRegime;
                  const macroRegimeHistory = await getMacroRegimeHistoryByReport(pool, row.id);
                  if (macroRegimeHistory) {
                    report.macroRegimeHistory = macroRegimeHistory;
                  }
                }
                const eventChains = extractStringArrayField(parsed?.eventChains ?? parsed?.event_chains, 1);
                if (eventChains.length > 0) {
                  report.eventChains = eventChains;
                  const reportEntityNames = extractReportEntityNames(
                    parsed?.entitySentiment ?? parsed?.entity_sentiment,
                  );
                  const previewChainRows = await getRecentReportChainDrilldowns(
                    pool,
                    reportEntityNames,
                    row.created_at,
                    row.created_at - REPORT_EVENT_CHAIN_LOOKBACK_MS,
                    REPORT_PREVIEW_CHAIN_DRILLDOWN_LIMIT,
                  );
                  const { chainDrilldowns, hiddenActiveChainCount } = getReportPreviewChains(previewChainRows);
                  if (hiddenActiveChainCount > 0) {
                    report.hasMoreActiveChains = true;
                    report.hiddenActiveChainCount = hiddenActiveChainCount;
                  }
                  if (chainDrilldowns.length > 0) {
                    report.chainDrilldowns = chainDrilldowns;
                  }
                }
                return report;
              }),
            );

      const results = [...summaryResults, ...reportResults]
        .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
        .slice(0, limit);

      return { results };
    },
  );

  app.get(
    '/api/v1/items/:id',
    {
      preHandler: [authPreHandler],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            context: { type: 'integer', minimum: 0, maximum: 10 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { context: rawContext } = request.query as { context?: number };
      const context = Math.min(Math.max(rawContext ?? 0, 0), 10);
      const { rows } = await pool.query<ItemRow>('SELECT * FROM items WHERE id = $1 LIMIT 1', [id]);

      if (rows.length === 0) {
        return reply.code(404).send({ error: 'Item not found' });
      }

      const itemRow = rows[0];
      const item = parseItemRecord(itemRow);

      if (context === 0) {
        return { item };
      }

      const [olderResult, newerResult] = await Promise.all([
        pool.query<ItemRow>(
          `SELECT * FROM items
             WHERE source = $1
               AND source_id = $2
               AND (
                 timestamp < $3
                 OR (timestamp = $3 AND created_at < $4)
                 OR (timestamp = $3 AND created_at = $4 AND id < $5)
               )
             ORDER BY timestamp DESC, created_at DESC, id DESC
             LIMIT $6`,
          [itemRow.source, itemRow.source_id, itemRow.timestamp, itemRow.created_at, itemRow.id, context],
        ),
        pool.query<ItemRow>(
          `SELECT * FROM items
             WHERE source = $1
               AND source_id = $2
               AND (
                 timestamp > $3
                 OR (timestamp = $3 AND created_at > $4)
                 OR (timestamp = $3 AND created_at = $4 AND id > $5)
               )
             ORDER BY timestamp ASC, created_at ASC, id ASC
             LIMIT $6`,
          [itemRow.source, itemRow.source_id, itemRow.timestamp, itemRow.created_at, itemRow.id, context],
        ),
      ]);

      return {
        item,
        context: {
          older: olderResult.rows.reverse().map((row) => parseItemRecord(row)),
          newer: newerResult.rows.map((row) => parseItemRecord(row)),
        },
      };
    },
  );

  app.get(
    '/api/v1/feed/:sourceId',
    {
      preHandler: [authPreHandler],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['discord', 'twitter', 'rss', 'news'] },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            offset: { type: 'integer', minimum: 0 },
            after: { type: 'integer', minimum: 0 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { sourceId } = request.params as { sourceId: string };
      const {
        source,
        limit: rawLimit,
        offset,
        after,
      } = request.query as {
        source?: string;
        limit?: number;
        offset?: number;
        after?: number;
      };
      const limit = Math.min(Math.max(rawLimit ?? 50, 1), 200);

      let sql = source
        ? `SELECT * FROM items WHERE source = $1 AND source_id = $2`
        : `SELECT * FROM items WHERE source_id = $1`;
      const params: (string | number)[] = source ? [source, sourceId] : [sourceId];

      if (after != null) {
        params.push(after);
        sql += ` AND timestamp > $${params.length}`;
      }

      sql += ` ORDER BY timestamp DESC`;

      params.push(limit);
      sql += ` LIMIT $${params.length}`;

      if (offset != null) {
        params.push(offset);
        sql += ` OFFSET $${params.length}`;
      }

      const { rows: items } = await pool.query<ItemRow>(sql, params);
      const parsed = items.map((r) => parseItemRecord(r));
      return { items: parsed };
    },
  );

  app.post(
    '/api/v1/chat',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 4000 },
            conversationId: { type: 'string', maxLength: 100 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (!chatHandler) {
        return reply.code(501).send({ error: 'Chat not available' });
      }
      const { query, conversationId } = request.body as { query: string; conversationId?: string };
      const userId = request.user!.discordId;
      const result = await chatHandler.handle(query, conversationId ?? userId, userId);
      return result;
    },
  );
}
