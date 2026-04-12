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
            const sourceFamilies = extractStringArrayField(parsed?.sourceFamilies ?? parsed?.source_families, 10);
            if (sourceFamilies.length > 0) {
              report.sourceFamilies = sourceFamilies;
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
        report.sourceFamilies = (parsed.sourceFamilies ?? parsed.source_families ?? []) as unknown[];
        report.newProjects = (parsed.newProjects ?? parsed.new_projects ?? []) as unknown[];
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

  app.get('/api/v1/reports/:id/export', { preHandler: [authPreHandler] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { format } = request.query as { format?: string };
    if (format !== 'md' && format !== 'json') {
      return reply.code(400).send({ error: 'format must be "md" or "json"' });
    }

    const { rows } = await pool.query<ReportRow>(`SELECT * FROM reports WHERE id = $1`, [id]);
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Report not found' });
    }

    const row = rows[0];

    if (format === 'json') {
      const report = toCamelCase<Record<string, unknown>>(row as unknown as Record<string, unknown>);
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
          report.sourceFamilies = (parsed.sourceFamilies ?? parsed.source_families ?? []) as unknown[];
          report.newProjects = (parsed.newProjects ?? parsed.new_projects ?? []) as unknown[];
          const macroRegime = extractMacroRegime(parsed.macroRegime ?? parsed.macro_regime);
          if (macroRegime) {
            report.macroRegime = macroRegime;
            const macroRegimeHistory = await getMacroRegimeHistoryByReport(pool, row.id);
            if (macroRegimeHistory) {
              report.macroRegimeHistory = macroRegimeHistory;
            }
          }
          const reportEntityNames = extractReportEntityNames(parsed.entitySentiment ?? parsed.entity_sentiment);
          const reportChainDrilldowns = serializeReportChainDrilldowns(
            await getRecentReportChainDrilldowns(
              pool,
              reportEntityNames,
              row.created_at,
              row.created_at - REPORT_EVENT_CHAIN_LOOKBACK_MS,
            ),
          );
          if (reportChainDrilldowns.length > 0) {
            report.chainDrilldowns = reportChainDrilldowns;
          }
        }
      }

      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="report-${id}.json"`);
      return reply.send({ report });
    }

    const parsed = typeof row.body === 'string' ? parseReportBody(row.body) : null;
    const title = `${(row.type ?? 'daily').charAt(0).toUpperCase()}${(row.type ?? 'daily').slice(1)} Report — ${row.date ?? 'Unknown date'}`;
    const lines: string[] = [`# ${title}`, ''];

    if (row.tldr) {
      lines.push(`> ${row.tldr}`, '');
    }

    if (parsed) {
      if (parsed.macroRegime ?? parsed.macro_regime) {
        const macroRegime = extractMacroRegime(parsed.macroRegime ?? parsed.macro_regime);
        if (macroRegime) {
          lines.push('## Macro Regime', '');
          lines.push(`- Classification: ${macroRegime.classification}`);
          lines.push(`- Confidence: ${Math.round(macroRegime.confidence * 100)}%`);
          lines.push(`- Rationale: ${macroRegime.rationale}`, '');
        }
      }

      const listSections: Array<{ label: string; items: string[] }> = [
        { label: 'Key Events', items: extractStringArrayField(parsed.keyEvents ?? parsed.key_events, 1) },
        {
          label: 'Market Catalysts',
          items: extractStringArrayField(parsed.marketCatalysts ?? parsed.market_catalysts, 1),
        },
        {
          label: 'Cross-Language Signals',
          items: extractStringArrayField(parsed.regionalDivergence ?? parsed.regional_divergence, 1),
        },
        {
          label: 'Narrative Shifts',
          items: extractStringArrayField(parsed.narrativeShifts ?? parsed.narrative_shifts, 1),
        },
        { label: 'First Movers', items: extractStringArrayField(parsed.firstMovers ?? parsed.first_movers, 1) },
        { label: 'Alpha Signals', items: extractStringArrayField(parsed.alphaSignals ?? parsed.alpha_signals, 1) },
        { label: 'Price Alerts', items: extractStringArrayField(parsed.priceAlerts ?? parsed.price_alerts, 1) },
        {
          label: 'Unusual Activity',
          items: extractStringArrayField(parsed.unusualActivity ?? parsed.unusual_activity, 1),
        },
        { label: 'Macro Alerts', items: extractStringArrayField(parsed.macroAlerts ?? parsed.macro_alerts, 1) },
      ];

      for (const { label, items } of listSections) {
        if (items.length > 0) {
          lines.push(`## ${label}`, '');
          for (const item of items) {
            lines.push(`- ${item}`);
          }
          lines.push('');
        }
      }

      const entitySentiment = (parsed.entitySentiment ?? parsed.entity_sentiment ?? []) as Array<{
        entity?: string;
        name?: string;
        sentiment?: number;
        summary?: string;
      }>;
      if (Array.isArray(entitySentiment) && entitySentiment.length > 0) {
        lines.push('## Entity Sentiment', '');
        for (const entity of entitySentiment) {
          const entityName = entity?.entity ?? entity?.name;
          if (entity && typeof entity === 'object' && entityName) {
            const sentimentLabel =
              typeof entity.sentiment === 'number'
                ? ` (${entity.sentiment > 0 ? '+' : ''}${entity.sentiment.toFixed(1)})`
                : '';
            lines.push(`- **${entityName}**${sentimentLabel}${entity.summary ? `: ${entity.summary}` : ''}`);
          }
        }
        lines.push('');
      }

      const newProjects = (parsed.newProjects ?? parsed.new_projects ?? []) as Array<{
        name?: string;
        description?: string;
      }>;
      if (Array.isArray(newProjects) && newProjects.length > 0) {
        lines.push('## New Projects', '');
        for (const project of newProjects) {
          if (project && typeof project === 'object' && project.name) {
            lines.push(`- **${project.name}**${project.description ? `: ${project.description}` : ''}`);
          }
        }
        lines.push('');
      }

      const eventChains = (parsed.eventChains ?? parsed.event_chains ?? []) as Array<
        | string
        | {
            title?: string;
            summary?: string;
          }
      >;
      if (Array.isArray(eventChains) && eventChains.length > 0) {
        lines.push('## Event Chains', '');
        for (const chain of eventChains) {
          if (typeof chain === 'string') {
            lines.push(`- ${chain}`);
            continue;
          }
          if (chain && typeof chain === 'object' && chain.title) {
            lines.push(`### ${chain.title}`);
            if (chain.summary) {
              lines.push('', chain.summary);
            }
            lines.push('');
          }
        }
      }

      const customSections = (parsed.sections ?? []) as Array<{
        heading?: string;
        title?: string;
        body?: string;
        content?: string;
      }>;
      if (Array.isArray(customSections) && customSections.length > 0) {
        for (const section of customSections) {
          const heading = section?.heading ?? section?.title;
          const body = section?.body ?? section?.content;
          if (section && typeof section === 'object' && heading) {
            lines.push(`## ${heading}`, '');
            if (body) {
              lines.push(body, '');
            }
          }
        }
      }
    } else if (typeof row.body === 'string' && row.body.trim().length > 0) {
      lines.push(row.body.trim(), '');
    }

    const markdown = lines.join('\n');
    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="report-${id}.md"`);
    return reply.send(markdown);
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
