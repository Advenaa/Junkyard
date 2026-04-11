import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from './db/connection.js';
import {
  getMacroRegimeHistoryByReport,
  getRecentReportChainDrilldowns,
  getSummaryById,
  getSummaryEventsWithChainContext,
  type ReportRow,
} from './db/queries.js';
import {
  extractMacroRegime,
  extractReportEntityNames,
  extractStringArrayField,
  extractSummaryEntities,
  extractSummaryEvents,
  getReportPreviewChains,
  parseReportBody,
  parseSummaryBody,
  REPORT_EVENT_CHAIN_LOOKBACK_MS,
  REPORT_PREVIEW_CHAIN_DRILLDOWN_LIMIT,
  serializeReportChainDrilldowns,
  serializeSummaryEventRows,
  toCamelCase,
} from './server-route-helpers.js';

type RoutePreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

interface ReportRouteDeps {
  app: FastifyInstance;
  authPreHandler: RoutePreHandler;
  pool: Pool;
}

export function registerReportRoutes({ app, authPreHandler, pool }: ReportRouteDeps): void {
  app.get('/api/v1/reports', { preHandler: [authPreHandler] }, async (request) => {
    const {
      limit: rawLimit,
      offset: rawOffset,
      type,
    } = request.query as { limit?: string; offset?: string; type?: string };
    const limit = Math.min(Math.max(parseInt(rawLimit ?? '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(rawOffset ?? '0', 10) || 0, 0);
    const params: unknown[] = [limit, offset];
    let whereClause = '';
    if (type) {
      params.push(type);
      whereClause = `WHERE type = $${params.length}`;
    }
    const { rows: reports } = await pool.query<ReportRow>(
      `SELECT id, date, type, tldr, sentiment, delivery_status, created_at, body FROM reports ${whereClause} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    const countParams: unknown[] = [];
    let countWhere = '';
    if (type) {
      countParams.push(type);
      countWhere = `WHERE type = $1`;
    }
    const { rows: countRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM reports ${countWhere}`,
      countParams,
    );
    return {
      reports: await Promise.all(
        reports.map(async (r) => {
          const report = toCamelCase<Record<string, unknown>>(r as unknown as Record<string, unknown>);
          if (typeof r.body === 'string') {
            const parsed = parseReportBody(r.body);
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
              const macroRegimeHistory = await getMacroRegimeHistoryByReport(pool, r.id);
              if (macroRegimeHistory) {
                report.macroRegimeHistory = macroRegimeHistory;
              }
            }
            const eventChains = extractStringArrayField(parsed?.eventChains ?? parsed?.event_chains, 1);
            if (eventChains.length > 0) {
              report.eventChains = eventChains;
              const reportEntityNames = extractReportEntityNames(parsed?.entitySentiment ?? parsed?.entity_sentiment);
              const previewChainRows = await getRecentReportChainDrilldowns(
                pool,
                reportEntityNames,
                r.created_at,
                r.created_at - REPORT_EVENT_CHAIN_LOOKBACK_MS,
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
          }
          delete report.body;
          return report;
        }),
      ),
      total: parseInt(countRows[0].count, 10),
    };
  });

  app.get('/api/v1/reports/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await pool.query<ReportRow>(`SELECT * FROM reports WHERE id = $1`, [id]);
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Report not found' });
    }
    const report = toCamelCase<Record<string, unknown>>(rows[0] as unknown as Record<string, unknown>);
    if (typeof report.body === 'string') {
      const parsed = parseReportBody(report.body);
      if (parsed) {
        report.keyEvents = (parsed.keyEvents ?? parsed.key_events ?? []) as unknown[];
        report.marketCatalysts = (parsed.marketCatalysts ?? parsed.market_catalysts ?? []) as unknown[];
        report.regionalDivergence = (parsed.regionalDivergence ?? parsed.regional_divergence ?? []) as unknown[];
        report.narrativeShifts = (parsed.narrativeShifts ?? parsed.narrative_shifts ?? []) as unknown[];
        report.eventChains = (parsed.eventChains ?? parsed.event_chains ?? []) as unknown[];
        report.firstMovers = (parsed.firstMovers ?? parsed.first_movers ?? []) as unknown[];
        report.alphaSignals = (parsed.alphaSignals ?? parsed.alpha_signals ?? []) as unknown[];
        report.priceAlerts = (parsed.priceAlerts ?? parsed.price_alerts ?? []) as unknown[];
        report.unusualActivity = (parsed.unusualActivity ?? parsed.unusual_activity ?? []) as unknown[];
        report.macroAlerts = (parsed.macroAlerts ?? parsed.macro_alerts ?? []) as unknown[];
        report.entitySentiment = (parsed.entitySentiment ?? parsed.entity_sentiment ?? []) as unknown[];
        report.sections = (parsed.sections ?? []) as unknown[];
        const macroRegime = extractMacroRegime(parsed.macroRegime ?? parsed.macro_regime);
        if (macroRegime) {
          report.macroRegime = macroRegime;
          const macroRegimeHistory = await getMacroRegimeHistoryByReport(pool, rows[0].id);
          if (macroRegimeHistory) {
            report.macroRegimeHistory = macroRegimeHistory;
          }
        }
        const reportEntityNames = extractReportEntityNames(parsed.entitySentiment ?? parsed.entity_sentiment);
        const reportChainDrilldowns = serializeReportChainDrilldowns(
          await getRecentReportChainDrilldowns(
            pool,
            reportEntityNames,
            rows[0].created_at,
            rows[0].created_at - REPORT_EVENT_CHAIN_LOOKBACK_MS,
          ),
        );
        if (reportChainDrilldowns.length > 0) {
          report.chainDrilldowns = reportChainDrilldowns;
        }
      }
    }
    return reply.send({ report });
  });

  app.get('/api/v1/summaries/:id', { preHandler: [authPreHandler] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await getSummaryById(pool, id);
    if (!row) {
      return reply.code(404).send({ error: 'Summary not found' });
    }

    const persistedSummaryEvents = serializeSummaryEventRows(await getSummaryEventsWithChainContext(pool, id));
    const summary = toCamelCase<Record<string, unknown>>(row as unknown as Record<string, unknown>);
    if (typeof row.body === 'string') {
      const parsed = parseSummaryBody(row.body);
      if (parsed) {
        summary.text = typeof parsed.summary === 'string' ? parsed.summary : row.body;
        summary.confidence = typeof parsed.confidence === 'number' ? parsed.confidence : null;
        summary.keyEvents = extractStringArrayField(parsed.keyEvents ?? parsed.key_events, 5);
        summary.entities = extractSummaryEntities(parsed.entities);
        summary.events =
          persistedSummaryEvents.length > 0 ? persistedSummaryEvents : extractSummaryEvents(parsed.events);
      } else {
        summary.text = row.body;
        summary.confidence = null;
        summary.keyEvents = [];
        summary.entities = [];
        summary.events = persistedSummaryEvents;
      }
    }

    return reply.send({ summary });
  });
}
