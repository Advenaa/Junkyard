import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import type { Pool } from './db/connection.js';
import type { Logger } from './logger.js';
import type { HealthMonitor } from './health.js';
import { registerOAuthRoutes } from './auth/discord-oauth.js';
import { requireAuth, requireAdmin } from './auth/middleware.js';
import { createSessionManager } from './auth/sessions.js';
import {
  getSources,
  getAllSourcesWithState,
  insertSource,
  getAppConfig,
  setAppConfig,
  getDiscordTokens,
  insertDiscordToken,
  deleteDiscordToken,
  updateDiscordTokenStatus,
  updateDiscordTokenLabel,
  updateDiscordTokenProxy,
  getEntityRelationshipGraph,
  getEntityRelationships,
  getCompetitors,
  upsertEntityRelationship,
  deleteEntityRelationship,
  type EntityRelationshipSource,
  type EntityRelationshipRow,
  type EntityRelationshipType,
  getSummaryById,
  getSummaryEventsWithChainContext,
  getRecentReportChainDrilldowns,
  type ReportRow,
  type SummaryRow,
  type SummaryEventWithChainRow,
  type ReportChainDrilldownRow,
  type SourceRow,
  type ItemRow,
  getEntityDivergence,
  getTopDivergentEntities,
  getMacroRegimeHistoryByReport,
  getLatestPriceSnapshot,
  getPriceHistory,
  type PriceSnapshotRow,
  updateSourceTier,
  getAlphaPropagationSummary,
  getAlphaPropagationByEntity,
  getTopAuthorsByEntity,
  getAuthorById,
  getAuthorCalls,
  resolveAuthorCall,
} from './db/queries.js';
import { fetchValidated, validateUrl } from './url-validator.js';
import { createDiscordRest } from './ingest/discord-rest.js';
import { encryptSecret, decryptSecret, getEncryptionKey } from './crypto/token-encrypt.js';
import {
  createEnvDiscordTokens,
  maskDiscordToken,
  maskProxyUrl,
  normalizeProxyUrl,
  type DiscordRuntimeToken,
} from './discord-tokens.js';
import { normalizeAlias } from './knowledge/entities.js';
import { registerCalendarRoutes } from './server-calendar-routes.js';
import { registerInsightRoutes } from './server-insight-routes.js';
import { featureDisabledResponse } from './features.js';

/** Convert object keys from snake_case to camelCase. Shallow — does not recurse into nested objects. */
function toCamelCase<T>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

function parseReportBody(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseSummaryBody(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const ACCESS_REQUEST_CSRF_COOKIE = 'podders_access_request_csrf';
const ACCESS_REQUEST_CSRF_COOKIE_PATH = '/api/v1/access-requests';
const ACCESS_REQUEST_CSRF_HEADER = 'x-csrf-token';
const ACCESS_REQUEST_CSRF_TTL_MS = 10 * 60 * 1000;

function timingSafeEqualString(left: string, right: string): boolean {
  if (Buffer.byteLength(left) !== Buffer.byteLength(right)) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function extractStringArrayField(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').slice(0, limit);
}

function extractMacroRegime(value: unknown): {
  classification: 'risk-on' | 'risk-off' | 'transition' | 'unclear';
  confidence: number;
  rationale: string;
} | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const classification = record.classification;
  const confidenceRaw = record.confidence;
  const rationale = record.rationale;

  if (
    classification !== 'risk-on' &&
    classification !== 'risk-off' &&
    classification !== 'transition' &&
    classification !== 'unclear'
  ) {
    return null;
  }

  if (typeof confidenceRaw !== 'number' || !Number.isFinite(confidenceRaw)) return null;
  if (typeof rationale !== 'string' || rationale.trim().length === 0) return null;

  return {
    classification,
    confidence: Math.min(Math.max(confidenceRaw, 0), 1),
    rationale: rationale.trim(),
  };
}

function getSourceTargetFromRequest(
  request: FastifyRequest,
): { source: string; sourceId: string } | { error: 'missing' } {
  const params = request.params as { source?: string; sourceId?: string };
  const query = request.query as { sourceId?: string } | undefined;
  const source = params.source;
  const sourceId = params.sourceId ?? query?.sourceId;

  if (!source || sourceId == null) {
    return { error: 'missing' };
  }

  return { source, sourceId };
}

function getReportSearchPreview(tldr: string | null, body: string): string {
  if (typeof tldr === 'string' && tldr.trim().length > 0) {
    return tldr.trim();
  }

  const parsed = parseReportBody(body);
  if (!parsed) {
    return body;
  }

  const sections = parsed.sections;
  if (Array.isArray(sections)) {
    for (const section of sections) {
      if (
        section &&
        typeof section === 'object' &&
        'body' in section &&
        typeof (section as { body?: unknown }).body === 'string'
      ) {
        const sectionBody = (section as { body: string }).body.trim();
        if (sectionBody.length > 0) {
          return sectionBody;
        }
      }
    }
  }

  const keyEvents = extractStringArrayField(parsed.keyEvents ?? parsed.key_events, 1);
  if (keyEvents[0]) return keyEvents[0];

  const eventChains = extractStringArrayField(parsed.eventChains ?? parsed.event_chains, 1);
  if (eventChains[0]) return eventChains[0];

  return body;
}

function clampPreviewText(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`;
}

function getNarrativeSummaryPreview(body: string): string {
  const parsed = parseSummaryBody(body);
  const summaryText = parsed && typeof parsed.summary === 'string' ? parsed.summary : body;
  return clampPreviewText(summaryText, 220);
}

function parseItemRecord(row: ItemRow): Record<string, unknown> {
  const item = toCamelCase<Record<string, unknown>>(row as unknown as Record<string, unknown>);
  if (typeof item.attachments === 'string') {
    try {
      item.attachments = JSON.parse(item.attachments);
    } catch {
      item.attachments = [];
    }
  } else if (item.attachments === null || item.attachments === undefined) {
    item.attachments = [];
  }
  return item;
}

function extractSummaryEntities(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      name: typeof entry.name === 'string' ? entry.name : 'Unknown',
      aliases: Array.isArray(entry.aliases)
        ? entry.aliases.filter((alias): alias is string => typeof alias === 'string').slice(0, 10)
        : [],
      type: typeof entry.type === 'string' ? entry.type : 'project',
      mentionCount:
        typeof entry.mentionCount === 'number'
          ? entry.mentionCount
          : typeof entry.mention_count === 'number'
            ? entry.mention_count
            : 1,
      sentiment: typeof entry.sentiment === 'number' ? entry.sentiment : 0,
    }));
}

function extractReportEntityNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => (typeof entry.name === 'string' ? entry.name.trim() : ''))
        .filter((name) => name.length > 0),
    ),
  ];
}

function extractSummaryEvents(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      entityName:
        typeof entry.entityName === 'string'
          ? entry.entityName
          : typeof entry.entity_name === 'string'
            ? entry.entity_name
            : 'Unknown',
      eventType:
        typeof entry.eventType === 'string'
          ? entry.eventType
          : typeof entry.event_type === 'string'
            ? entry.event_type
            : 'custom',
      description: typeof entry.description === 'string' ? entry.description : '',
    }))
    .filter((entry) => entry.description.length > 0);
}

function serializeReportChainDrilldowns(rows: ReportChainDrilldownRow[]): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    rootId: row.chain_root_id,
    entityName: row.entity_name,
    eventCount: row.event_count,
    firstEventTime: row.first_event_time,
    latestEventTime: row.latest_event_time,
    eventTypes: row.event_types,
    latestSummaryId: row.latest_summary_id,
    latestEventType: row.latest_event_type,
    latestEventDescription: row.latest_event_description,
  }));
}

function getReportPreviewChains(rows: ReportChainDrilldownRow[]): {
  chainDrilldowns: Array<Record<string, unknown>>;
  hiddenActiveChainCount: number;
} {
  const chainDrilldowns = serializeReportChainDrilldowns(rows);
  const totalChainCount = rows[0]?.total_chain_count ?? chainDrilldowns.length;
  return {
    chainDrilldowns,
    hiddenActiveChainCount: Math.max(totalChainCount - chainDrilldowns.length, 0),
  };
}

function serializeSummaryEventRows(rows: SummaryEventWithChainRow[]): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    entityName: row.entity_name,
    eventType: row.event_type,
    description: row.description,
    eventTime: row.event_time,
    chain:
      row.chain_event_count > 1
        ? {
            rootId: row.chain_root_id,
            position: row.chain_position,
            eventCount: row.chain_event_count,
            firstEventTime: row.chain_first_event_time,
            latestEventTime: row.chain_latest_event_time,
            eventTypes: row.chain_event_types,
            previousSummary:
              row.previous_summary_id &&
              row.previous_event_type &&
              row.previous_event_description &&
              row.previous_event_time
                ? {
                    summaryId: row.previous_summary_id,
                    eventType: row.previous_event_type,
                    description: row.previous_event_description,
                    eventTime: row.previous_event_time,
                  }
                : null,
            nextSummary:
              row.next_summary_id && row.next_event_type && row.next_event_description && row.next_event_time
                ? {
                    summaryId: row.next_summary_id,
                    eventType: row.next_event_type,
                    description: row.next_event_description,
                    eventTime: row.next_event_time,
                  }
                : null,
          }
        : null,
  }));
}

const REPORT_EVENT_CHAIN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const REPORT_PREVIEW_CHAIN_DRILLDOWN_LIMIT = 2;

interface UserRow {
  discord_id: string;
  username: string;
  avatar: string | null;
  role: string;
  created_at: number;
  last_login_at: number | null;
}

interface UserAuditRow {
  id: string;
  actor_discord_id: string;
  actor_username: string;
  target_discord_id: string;
  target_username: string | null;
  action: 'invite' | 'role_change' | 'request_approved' | 'request_rejected';
  previous_role: string | null;
  new_role: string | null;
  created_at: number;
}

interface AccessRequestRow {
  id: string;
  discord_id: string;
  requested_role: 'viewer' | 'admin';
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  resolved_role: 'viewer' | 'admin' | null;
  decided_at: number | null;
  decided_by_discord_id: string | null;
  created_at: number;
}

interface ChatHandler {
  handle(
    query: string,
    conversationId: string,
    userId: string,
  ): Promise<{
    response: string;
    toolsUsed: string[];
    sources: Array<{
      type: 'report' | 'summary' | 'item';
      id: string;
      label: string;
      snippet: string;
      chainRootId?: string;
      chainLabel?: string;
    }>;
  }>;
}

interface DiscordTokenView {
  id: string;
  maskedToken: string;
  label: string | null;
  status: string;
  addedAt: number;
  lastUsedAt: number | null;
  plainToken: string | null;
  proxyConfigured: boolean;
  maskedProxy: string | null;
  plainProxyUrl: string | null;
}

interface DiscordTokenHealthState {
  index: number;
  status: 'active' | 'idle' | 'disabled';
  errorCount: number;
  lastSuccessfulPollAt: number | null;
  channelCount: number;
  source: 'env' | 'db';
  tokenId: string | null;
  label: string | null;
  maskedToken: string | null;
  proxyConfigured: boolean;
  maskedProxy: string | null;
}

interface EntitySearchSuggestionRow {
  id: string;
  name: string;
  matched_alias: string | null;
}

async function getManagedDiscordTokenViews(pool: Pool, encKey: string): Promise<DiscordTokenView[]> {
  const rows = await getDiscordTokens(pool);
  return rows.map((row) => {
    let plainToken: string | null = null;
    let maskedToken = '***';
    try {
      plainToken = decryptSecret({ ciphertext: row.encrypted_token, iv: row.iv, authTag: row.auth_tag }, encKey);
      maskedToken = maskDiscordToken(plainToken);
    } catch {
      maskedToken = '[decryption failed]';
    }

    let plainProxyUrl: string | null = null;
    let maskedProxy: string | null = null;
    const proxyConfigured =
      row.proxy_url_encrypted != null || row.proxy_url_iv != null || row.proxy_url_auth_tag != null;

    if (proxyConfigured) {
      if (!row.proxy_url_encrypted || !row.proxy_url_iv || !row.proxy_url_auth_tag) {
        maskedProxy = '[incomplete proxy data]';
      } else {
        try {
          plainProxyUrl = normalizeProxyUrl(
            decryptSecret(
              {
                ciphertext: row.proxy_url_encrypted,
                iv: row.proxy_url_iv,
                authTag: row.proxy_url_auth_tag,
              },
              encKey,
            ),
          );
          maskedProxy = maskProxyUrl(plainProxyUrl);
        } catch {
          maskedProxy = '[decryption failed]';
        }
      }
    }

    return {
      id: row.id,
      maskedToken,
      label: row.label,
      status: row.status,
      addedAt: row.added_at,
      lastUsedAt: row.last_used_at,
      plainToken,
      proxyConfigured,
      maskedProxy,
      plainProxyUrl,
    };
  });
}

async function recordUserAuditEvent(
  pool: Pool,
  event: {
    actorDiscordId: string;
    actorUsername: string;
    targetDiscordId: string;
    targetUsername: string | null;
    action: UserAuditRow['action'];
    previousRole: string | null;
    newRole: string | null;
  },
): Promise<void> {
  const { ulid } = await import('ulid');
  await pool.query(
    `INSERT INTO user_audit_log (
      id, actor_discord_id, actor_username, target_discord_id, target_username,
      action, previous_role, new_role, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      ulid(),
      event.actorDiscordId,
      event.actorUsername,
      event.targetDiscordId,
      event.targetUsername,
      event.action,
      event.previousRole,
      event.newRole,
      Date.now(),
    ],
  );
}

export async function createServer(
  config: Config,
  pool: Pool,
  log: Logger,
  healthMonitor: HealthMonitor,
  chatHandler?: ChatHandler,
  onConfigChange?: () => Promise<void>,
  onTokensChanged?: () => Promise<DiscordRuntimeToken[]>,
  getTokenHealth?: () => Promise<DiscordTokenHealthState[]>,
  initialDiscordTokens: DiscordRuntimeToken[] = createEnvDiscordTokens(config.discordTokens),
): Promise<FastifyInstance> {
  // Warn if Discord OAuth is configured without PUBLIC_URL (DB-008)
  if (config.discordClientId && config.discordClientSecret && !config.publicUrl) {
    log.warn('Discord OAuth is configured but PUBLIC_URL is not set — OAuth redirects will fail');
  }

  const sessionManager = createSessionManager(pool, log);
  const authPreHandler = requireAuth(pool, config, sessionManager);
  const discordRest = createDiscordRest(initialDiscordTokens, log);
  const app = Fastify({ logger: false, trustProxy: config.publicUrl ? 1 : false });

  // --- Plugins ---
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { max: 50, timeWindow: '1 second' });

  // --- OAuth routes (with stricter rate limit for brute-force protection) ---
  await app.register(
    async (scope) => {
      await scope.register(rateLimit, { max: 5, timeWindow: '1 minute' });
      registerOAuthRoutes(scope, pool, log, config, authPreHandler, sessionManager);
    },
    { prefix: '' },
  );

  // --- Security headers ---
  app.addHook('onSend', async (request, reply) => {
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cdn.discordapp.com",
    );
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

    // Cache-Control for dashboard assets (DB-005)
    if (request.url.startsWith('/assets/')) {
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (request.url === '/' || request.url.endsWith('.html')) {
      reply.header('Cache-Control', 'no-cache');
    }
  });

  // --- Health ---
  app.get('/api/v1/health', async (_request, reply) => {
    try {
      const { checks, healthy } = await healthMonitor.getStatus();
      reply.code(healthy ? 200 : 503);
      return { status: healthy ? 'ok' : 'degraded', checks };
    } catch (err) {
      log.error({ err }, 'Health check failed');
      reply.code(503);
      return { status: 'error', checks: {} };
    }
  });

  // --- Reports ---
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
    // Parse body JSON to extract nested fields for the frontend
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

  // --- Sources ---
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
            tier: { type: 'string', enum: ['alpha', 'influencer', 'general', 'mainstream'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { source, sourceId, label, poll_interval, tier } = request.body as {
        source?: string;
        sourceId?: string;
        label?: string;
        poll_interval?: number;
        tier?: string;
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
        if (tier != null) {
          await updateSourceTier(pool, source, sourceId, tier);
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

  // --- Config ---
  app.get('/api/v1/config', { preHandler: [authPreHandler] }, async (request) => {
    const [digestTime, timezone, webhookUrl] = await Promise.all([
      getAppConfig(pool, 'digest_time'),
      getAppConfig(pool, 'timezone'),
      getAppConfig(pool, 'webhook_url'),
    ]);
    // Only expose API key to admin users (PD-031)
    const apiKey = request.user?.role === 'admin' ? config.apiKey : undefined;
    return { digestTime, timezone, webhookUrl, apiKey };
  });

  app.patch(
    '/api/v1/config',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          properties: {
            digest_time: { type: 'string' },
            digestTime: { type: 'string' },
            timezone: { type: 'string' },
            webhook_url: { type: 'string' },
            webhookUrl: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as Record<string, string>;
      // Normalize camelCase → snake_case for DB storage (PR-010)
      if ('digestTime' in body) {
        body['digest_time'] = body['digestTime'];
        delete body['digestTime'];
      }
      if ('webhookUrl' in body) {
        body['webhook_url'] = body['webhookUrl'];
        delete body['webhookUrl'];
      }
      const allowedKeys = ['digest_time', 'timezone', 'webhook_url'];

      // CF-011 — validate digest_time format
      if ('digest_time' in body && body['digest_time']) {
        const match = body['digest_time'].match(/^(\d{1,2}):(\d{2})$/);
        if (!match) {
          return reply.code(400).send({ error: 'Invalid digest_time format, expected HH:MM' });
        }
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
          return reply.code(400).send({ error: 'digest_time out of range (hour 0-23, minute 0-59)' });
        }
      }

      // CF-011 — validate timezone
      if ('timezone' in body && body['timezone']) {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: body['timezone'] });
        } catch {
          return reply.code(400).send({ error: `Invalid timezone: ${body['timezone']}` });
        }
      }

      // Validate webhook_url if provided (SSRF protection — D-010)
      if ('webhook_url' in body && body['webhook_url']) {
        const validation = await validateUrl(body['webhook_url']);
        if (!validation.valid) {
          return reply.code(400).send({ error: `Invalid webhook URL: ${validation.reason}` });
        }
      }

      const updates: Array<Promise<void>> = [];
      for (const key of allowedKeys) {
        if (key in body) {
          updates.push(setAppConfig(pool, key, body[key]));
        }
      }
      await Promise.all(updates);

      // CF-010 — notify scheduler when cron-affecting config changes
      if (onConfigChange && ('digest_time' in body || 'timezone' in body)) {
        try {
          await onConfigChange();
        } catch (err) {
          log.error({ err }, 'config change callback failed');
        }
      }

      const [digestTime, timezone, webhookUrl] = await Promise.all([
        getAppConfig(pool, 'digest_time'),
        getAppConfig(pool, 'timezone'),
        getAppConfig(pool, 'webhook_url'),
      ]);
      return { digestTime, timezone, webhookUrl };
    },
  );

  // --- Search ---
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

      const summaryResults =
        scope === 'report'
          ? []
          : (
              await pool.query<SummaryRow>(
                `SELECT * FROM summaries WHERE body ILIKE $1 AND created_at > $2 ORDER BY created_at DESC LIMIT $3`,
                [likeQuery, cutoff, limit],
              )
            ).rows.map((row) =>
              toCamelCase<Record<string, unknown>>({
                ...row,
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

  // --- Raw feed ---
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

  app.get('/api/v1/users', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const { rows: users } = await pool.query<UserRow>(`SELECT * FROM users ORDER BY created_at DESC`);
    return { users: users.map((r) => toCamelCase(r as unknown as Record<string, unknown>)) };
  });

  app.get('/api/v1/access-requests', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const { rows } = await pool.query<AccessRequestRow>(
      `SELECT * FROM access_requests WHERE status = 'pending' ORDER BY created_at DESC LIMIT 20`,
    );
    return { requests: rows.map((row) => toCamelCase(row as unknown as Record<string, unknown>)) };
  });

  app.get(
    '/api/v1/access-requests/csrf',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (_request, reply) => {
      const csrfToken = crypto.randomBytes(32).toString('hex');
      reply.setCookie(ACCESS_REQUEST_CSRF_COOKIE, csrfToken, {
        httpOnly: true,
        signed: true,
        secure: config.publicUrl?.startsWith('https') ?? false,
        sameSite: 'strict',
        path: ACCESS_REQUEST_CSRF_COOKIE_PATH,
        maxAge: ACCESS_REQUEST_CSRF_TTL_MS / 1000,
      });
      reply.header('Cache-Control', 'no-store');
      return { csrfToken };
    },
  );

  app.get('/api/v1/users/audit', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const { rows } = await pool.query<UserAuditRow>(`SELECT * FROM user_audit_log ORDER BY created_at DESC LIMIT 20`);
    return { events: rows.map((row) => toCamelCase(row as unknown as Record<string, unknown>)) };
  });

  app.post(
    '/api/v1/access-requests',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['discordId', 'requestedRole'],
          properties: {
            discordId: { type: 'string', pattern: '^\\d{17,20}$' },
            requestedRole: { type: 'string', enum: ['viewer', 'admin'] },
            note: { type: 'string', maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const csrfHeader = request.headers[ACCESS_REQUEST_CSRF_HEADER];
      const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      const csrfCookie = request.unsignCookie((request.cookies?.[ACCESS_REQUEST_CSRF_COOKIE] as string) ?? '');
      if (!csrfToken || !csrfCookie.valid || !csrfCookie.value || !timingSafeEqualString(csrfToken, csrfCookie.value)) {
        reply.clearCookie(ACCESS_REQUEST_CSRF_COOKIE, { path: ACCESS_REQUEST_CSRF_COOKIE_PATH });
        return reply.code(403).send({ error: 'Invalid CSRF token' });
      }
      reply.clearCookie(ACCESS_REQUEST_CSRF_COOKIE, { path: ACCESS_REQUEST_CSRF_COOKIE_PATH });

      const { discordId, requestedRole, note } = request.body as {
        discordId: string;
        requestedRole: 'viewer' | 'admin';
        note?: string;
      };
      const trimmedNote = note?.trim() ? note.trim() : null;
      const now = Date.now();
      const existing = await pool.query<AccessRequestRow>(
        `SELECT * FROM access_requests WHERE discord_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
        [discordId],
      );
      if (existing.rows.length > 0) {
        const { rows } = await pool.query<AccessRequestRow>(
          `UPDATE access_requests
             SET requested_role = $2, note = $3, created_at = $4
           WHERE id = $1
           RETURNING *`,
          [existing.rows[0].id, requestedRole, trimmedNote, now],
        );
        return toCamelCase<AccessRequestRow>(rows[0] as unknown as Record<string, unknown>);
      }

      const { ulid } = await import('ulid');
      const id = ulid();
      const { rows } = await pool.query<AccessRequestRow>(
        `INSERT INTO access_requests (
          id, discord_id, requested_role, note, status, resolved_role, decided_at, decided_by_discord_id, created_at
        ) VALUES ($1, $2, $3, $4, 'pending', NULL, NULL, NULL, $5)
        RETURNING *`,
        [id, discordId, requestedRole, trimmedNote, now],
      );
      reply.code(201);
      return toCamelCase<AccessRequestRow>(rows[0] as unknown as Record<string, unknown>);
    },
  );

  // --- POST /users/invite (AC-001) ---
  app.post(
    '/api/v1/users/invite',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['discordId', 'role'],
          properties: {
            discordId: { type: 'string', pattern: '^\\d{17,20}$' },
            role: { type: 'string', enum: ['admin', 'viewer', 'blocked'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { discordId, role } = request.body as { discordId: string; role: string };
      const now = Date.now();
      const existing = await pool.query<Pick<UserRow, 'role' | 'username'>>(
        `SELECT role, username FROM users WHERE discord_id = $1`,
        [discordId],
      );
      const { rows } = await pool.query<UserRow>(
        `INSERT INTO users (discord_id, username, avatar, role, created_at, last_login_at)
         VALUES ($1, $2, NULL, $3, $4, NULL)
         ON CONFLICT (discord_id) DO UPDATE SET role = EXCLUDED.role
         RETURNING *`,
        [discordId, 'Pending invite', role, now],
      );
      await recordUserAuditEvent(pool, {
        actorDiscordId: request.user!.discordId,
        actorUsername: request.user!.username,
        targetDiscordId: discordId,
        targetUsername: rows[0]?.username ?? null,
        action: 'invite',
        previousRole: existing.rows[0]?.role ?? null,
        newRole: role,
      });
      return toCamelCase<UserRow>(rows[0] as unknown as Record<string, unknown>);
    },
  );

  app.patch(
    '/api/v1/access-requests/:requestId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['requestId'],
          properties: {
            requestId: { type: 'string', minLength: 1 },
          },
        },
        body: {
          type: 'object',
          required: ['decision'],
          properties: {
            decision: { type: 'string', enum: ['approved', 'rejected'] },
            role: { type: 'string', enum: ['viewer', 'admin'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { requestId } = request.params as { requestId: string };
      const { decision, role } = request.body as { decision: 'approved' | 'rejected'; role?: 'viewer' | 'admin' };
      const existingRequest = await pool.query<AccessRequestRow>(`SELECT * FROM access_requests WHERE id = $1`, [
        requestId,
      ]);
      if (existingRequest.rows.length === 0) {
        return reply.code(404).send({ error: 'Access request not found' });
      }
      const accessRequest = existingRequest.rows[0];
      if (accessRequest.status !== 'pending') {
        return reply.code(409).send({ error: 'Access request already decided' });
      }

      const existingUser = await pool.query<Pick<UserRow, 'role' | 'username'>>(
        `SELECT role, username FROM users WHERE discord_id = $1`,
        [accessRequest.discord_id],
      );
      const previousRole = existingUser.rows[0]?.role ?? null;
      const now = Date.now();

      if (decision === 'approved') {
        const resolvedRole = role ?? accessRequest.requested_role;
        const { rows: userRows } = await pool.query<UserRow>(
          `INSERT INTO users (discord_id, username, avatar, role, created_at, last_login_at)
           VALUES ($1, $2, NULL, $3, $4, NULL)
           ON CONFLICT (discord_id) DO UPDATE SET role = EXCLUDED.role
           RETURNING *`,
          [accessRequest.discord_id, existingUser.rows[0]?.username ?? 'Pending invite', resolvedRole, now],
        );
        const { rows } = await pool.query<AccessRequestRow>(
          `UPDATE access_requests
             SET status = 'approved', resolved_role = $2, decided_at = $3, decided_by_discord_id = $4
           WHERE id = $1
           RETURNING *`,
          [requestId, resolvedRole, now, request.user!.discordId],
        );
        await recordUserAuditEvent(pool, {
          actorDiscordId: request.user!.discordId,
          actorUsername: request.user!.username,
          targetDiscordId: accessRequest.discord_id,
          targetUsername: userRows[0]?.username ?? existingUser.rows[0]?.username ?? null,
          action: 'request_approved',
          previousRole,
          newRole: resolvedRole,
        });
        return {
          request: toCamelCase<AccessRequestRow>(rows[0] as unknown as Record<string, unknown>),
          user: toCamelCase<UserRow>(userRows[0] as unknown as Record<string, unknown>),
        };
      }

      const { rows } = await pool.query<AccessRequestRow>(
        `UPDATE access_requests
           SET status = 'rejected', resolved_role = NULL, decided_at = $2, decided_by_discord_id = $3
         WHERE id = $1
         RETURNING *`,
        [requestId, now, request.user!.discordId],
      );
      await recordUserAuditEvent(pool, {
        actorDiscordId: request.user!.discordId,
        actorUsername: request.user!.username,
        targetDiscordId: accessRequest.discord_id,
        targetUsername: existingUser.rows[0]?.username ?? null,
        action: 'request_rejected',
        previousRole,
        newRole: null,
      });
      return { request: toCamelCase<AccessRequestRow>(rows[0] as unknown as Record<string, unknown>) };
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

  // --- PATCH /sources/:source/:sourceId (CD-002) ---
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

  // --- DELETE /sources/:source/:sourceId (PD-003) ---
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

  // --- Discord server/channel discovery ---
  app.get('/api/v1/discord/guilds', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const guilds = await discordRest.getGuilds();
    return { guilds: guilds.map((g) => toCamelCase(g as unknown as Record<string, unknown>)) };
  });

  app.get<{ Params: { guildId: string } }>(
    '/api/v1/discord/guilds/:guildId/channels',
    { preHandler: [authPreHandler, requireAdmin] },
    async (request) => {
      const { guildId } = request.params;
      const channels = await discordRest.getChannels(guildId);
      return { channels: channels.map((c) => toCamelCase(c as unknown as Record<string, unknown>)) };
    },
  );

  // --- Discord token management ---
  app.get('/api/v1/discord/tokens', { preHandler: [authPreHandler, requireAdmin] }, async (_request, reply) => {
    const encKey = getEncryptionKey();
    if (!encKey) {
      return reply
        .code(503)
        .send({ error: 'Token encryption not configured — set TOKEN_ENCRYPTION_KEY or SESSION_SECRET' });
    }
    const tokens = (await getManagedDiscordTokenViews(pool, encKey)).map((token) => ({
      id: token.id,
      maskedToken: token.maskedToken,
      label: token.label,
      status: token.status,
      addedAt: token.addedAt,
      lastUsedAt: token.lastUsedAt,
      proxyConfigured: token.proxyConfigured,
      maskedProxy: token.maskedProxy,
    }));
    return { tokens };
  });

  app.post(
    '/api/v1/discord/tokens',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string', minLength: 1, maxLength: 500 },
            label: { type: 'string', maxLength: 100 },
            proxyUrl: { type: 'string', minLength: 1, maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const encKey = getEncryptionKey();
      if (!encKey) {
        return reply
          .code(503)
          .send({ error: 'Token encryption not configured — set TOKEN_ENCRYPTION_KEY or SESSION_SECRET' });
      }
      const { token, label, proxyUrl } = request.body as { token: string; label?: string; proxyUrl?: string };
      const { ulid } = await import('ulid');
      const id = ulid();
      const encryptedToken = encryptSecret(token, encKey);

      let encryptedProxy: { ciphertext: string; iv: string; authTag: string } | null = null;
      if (proxyUrl) {
        try {
          encryptedProxy = encryptSecret(normalizeProxyUrl(proxyUrl), encKey);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Invalid proxy URL';
          return reply.code(400).send({ error: message });
        }
      }

      await insertDiscordToken(
        pool,
        id,
        encryptedToken.ciphertext,
        encryptedToken.iv,
        encryptedToken.authTag,
        label ?? null,
        Date.now(),
        encryptedProxy,
      );
      if (onTokensChanged)
        onTokensChanged()
          .then((t) => discordRest.updateTokens(t))
          .catch((err: unknown) => log.error({ err }, 'token reload failed'));
      reply.code(201);
      return {
        id,
        label: label ?? null,
        status: 'active',
        addedAt: Date.now(),
        proxyConfigured: encryptedProxy != null,
        maskedProxy: proxyUrl ? maskProxyUrl(normalizeProxyUrl(proxyUrl)) : null,
      };
    },
  );

  app.delete<{ Params: { tokenId: string } }>(
    '/api/v1/discord/tokens/:tokenId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['tokenId'],
          properties: {
            tokenId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { tokenId } = request.params;
      const deleted = await deleteDiscordToken(pool, tokenId);
      if (!deleted) {
        return reply.code(404).send({ error: 'Token not found' });
      }
      if (onTokensChanged)
        onTokensChanged()
          .then((t) => discordRest.updateTokens(t))
          .catch((err: unknown) => log.error({ err }, 'token reload failed'));
      reply.code(204).send();
    },
  );

  app.patch<{ Params: { tokenId: string } }>(
    '/api/v1/discord/tokens/:tokenId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          properties: {
            label: { type: 'string', maxLength: 100 },
            status: { type: 'string', enum: ['active', 'disabled'] },
            proxyUrl: {
              anyOf: [{ type: 'string', minLength: 1, maxLength: 500 }, { type: 'null' }],
            },
          },
          additionalProperties: false,
        },
        params: {
          type: 'object',
          required: ['tokenId'],
          properties: {
            tokenId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { tokenId } = request.params;
      const body = request.body as { label?: string; status?: string; proxyUrl?: string | null };
      if (body.label != null) {
        const updated = await updateDiscordTokenLabel(pool, tokenId, body.label);
        if (!updated) return reply.code(404).send({ error: 'Token not found' });
      }
      if (body.status != null) {
        const updated = await updateDiscordTokenStatus(pool, tokenId, body.status);
        if (!updated) return reply.code(404).send({ error: 'Token not found' });
      }
      if (Object.prototype.hasOwnProperty.call(body, 'proxyUrl')) {
        const encKey = getEncryptionKey();
        if (!encKey) {
          return reply
            .code(503)
            .send({ error: 'Token encryption not configured — set TOKEN_ENCRYPTION_KEY or SESSION_SECRET' });
        }

        let encryptedProxy: { ciphertext: string; iv: string; authTag: string } | null = null;
        if (body.proxyUrl != null) {
          try {
            encryptedProxy = encryptSecret(normalizeProxyUrl(body.proxyUrl), encKey);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Invalid proxy URL';
            return reply.code(400).send({ error: message });
          }
        }

        const updated = await updateDiscordTokenProxy(pool, tokenId, encryptedProxy);
        if (!updated) return reply.code(404).send({ error: 'Token not found' });
      }
      if ((body.status != null || Object.prototype.hasOwnProperty.call(body, 'proxyUrl')) && onTokensChanged) {
        onTokensChanged()
          .then((t) => discordRest.updateTokens(t))
          .catch((err: unknown) => log.error({ err }, 'token reload failed'));
      }
      return { ok: true };
    },
  );

  // --- Discord token health (REST polling activity) ---
  app.get('/api/v1/discord/tokens/health', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const encKey = getEncryptionKey();
    const managedTokens = encKey ? await getManagedDiscordTokenViews(pool, encKey) : [];
    const managedById = new Map(managedTokens.map((token) => [token.id, token]));
    const runtimeStates = getTokenHealth ? await getTokenHealth() : [];

    const states: DiscordTokenHealthState[] = runtimeStates.map((state) => {
      const managedMeta = state.tokenId ? managedById.get(state.tokenId) : null;
      return {
        ...state,
        lastSuccessfulPollAt: state.lastSuccessfulPollAt ?? managedMeta?.lastUsedAt ?? null,
        label: managedMeta?.label ?? state.label ?? null,
        maskedToken: managedMeta?.maskedToken ?? state.maskedToken ?? null,
        proxyConfigured: managedMeta?.proxyConfigured ?? state.proxyConfigured ?? false,
        maskedProxy: managedMeta?.maskedProxy ?? state.maskedProxy ?? null,
      };
    });

    for (const managedToken of managedTokens) {
      if (states.some((state) => state.tokenId === managedToken.id)) {
        continue;
      }

      states.push({
        index: states.length,
        status: managedToken.status === 'active' ? 'idle' : 'disabled',
        errorCount: 0,
        lastSuccessfulPollAt: managedToken.lastUsedAt,
        channelCount: 0,
        source: 'db',
        tokenId: managedToken.id,
        label: managedToken.label,
        maskedToken: managedToken.maskedToken,
        proxyConfigured: managedToken.proxyConfigured,
        maskedProxy: managedToken.maskedProxy,
      });
    }

    return { states };
  });

  // --- PATCH /users/:discordId (CD-003) ---
  app.patch(
    '/api/v1/users/:discordId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['role'],
          properties: {
            role: { type: 'string', enum: ['admin', 'viewer', 'blocked'] },
          },
          additionalProperties: false,
        },
        params: {
          type: 'object',
          required: ['discordId'],
          properties: {
            discordId: { type: 'string', pattern: '^\\d{17,20}$' },
          },
        },
      },
    },
    async (request, reply) => {
      const { discordId } = request.params as { discordId: string };
      const { role } = request.body as { role: string };
      const existing = await pool.query<Pick<UserRow, 'role' | 'username'>>(
        `SELECT role, username FROM users WHERE discord_id = $1`,
        [discordId],
      );
      if (existing.rows.length === 0) {
        return reply.code(404).send({ error: 'User not found' });
      }
      const { rows } = await pool.query<UserRow>(`UPDATE users SET role = $2 WHERE discord_id = $1 RETURNING *`, [
        discordId,
        role,
      ]);
      // AU-035: purge all active sessions when a user is blocked
      if (role === 'blocked') {
        await sessionManager.deleteAllForUser(discordId);
      }
      if (existing.rows[0].role !== role) {
        await recordUserAuditEvent(pool, {
          actorDiscordId: request.user!.discordId,
          actorUsername: request.user!.username,
          targetDiscordId: discordId,
          targetUsername: rows[0]?.username ?? existing.rows[0].username ?? null,
          action: 'role_change',
          previousRole: existing.rows[0].role,
          newRole: role,
        });
      }
      return toCamelCase<UserRow>(rows[0] as unknown as Record<string, unknown>);
    },
  );

  // --- GET /api/v1/status (CD-004) ---
  app.get('/api/v1/status', { preHandler: [authPreHandler] }, async () => {
    const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';
    const { rows } = await pool.query<{
      items_ready: string;
      items_processing: string;
      summaries_today: string;
      cost_today: string;
    }>(
      `SELECT
        (SELECT count(*) FROM items WHERE status = 'ready') AS items_ready,
        (SELECT count(*) FROM items WHERE status = 'processing') AS items_processing,
        (SELECT count(*) FROM summaries WHERE created_at > EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000) AS summaries_today,
        (SELECT COALESCE(SUM(cost_usd), 0) FROM llm_usage WHERE created_at > EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000) AS cost_today`,
      [timezone],
    );
    const row = rows[0];
    const disabledFeatures = (Object.keys(config.disabledFeatures) as Array<keyof typeof config.disabledFeatures>)
      .filter((key) => config.disabledFeatures[key].disabled)
      .map((key) => ({
        feature: key,
        missingEnv: config.disabledFeatures[key].missingEnv,
        disables: config.disabledFeatures[key].disables,
      }));
    return {
      itemsReady: parseInt(row.items_ready, 10),
      itemsProcessing: parseInt(row.items_processing, 10),
      summariesToday: parseInt(row.summaries_today, 10),
      costToday: parseFloat(row.cost_today),
      twitterApiKeyConfigured: !!config.twitterApiKey,
      disabledFeatures,
    };
  });

  // --- Diagnostic endpoints (admin-only, read-only) ---
  // Surface production signals a local source audit cannot see: stuck
  // items, backpressure, halted sources, recent error/critical health
  // events. Consumed by /scout runtime to file findings from live data
  // without needing SSH or direct DB access.

  const STUCK_THRESHOLD_MS = 30 * 60 * 1000;

  app.get('/api/v1/diag/stuck-items', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const nowMs = Date.now();
    const { rows: aggRows } = await pool.query<{
      stuck_count: string;
      oldest_age_ms: string | null;
    }>(
      `SELECT
        count(*) AS stuck_count,
        ($1::bigint - MIN(created_at))::text AS oldest_age_ms
      FROM items
      WHERE status = 'processing' AND created_at < $1::bigint - $2::bigint`,
      [nowMs, STUCK_THRESHOLD_MS],
    );
    const { rows: sampleRows } = await pool.query<{
      id: string;
      source: string;
      source_id: string;
      created_at: string;
    }>(
      `SELECT id, source, source_id, created_at::text
       FROM items
       WHERE status = 'processing' AND created_at < $1::bigint - $2::bigint
       ORDER BY created_at ASC
       LIMIT 10`,
      [nowMs, STUCK_THRESHOLD_MS],
    );
    const agg = aggRows[0];
    return {
      thresholdMs: STUCK_THRESHOLD_MS,
      stuckCount: parseInt(agg.stuck_count, 10),
      oldestAgeMs: agg.oldest_age_ms === null ? 0 : parseInt(agg.oldest_age_ms, 10),
      sample: sampleRows.map((r) => toCamelCase(r as unknown as Record<string, unknown>)),
    };
  });

  app.get('/api/v1/diag/backpressure', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const nowMs = Date.now();
    const { rows } = await pool.query<{
      ready_count: string;
      processing_count: string;
      oldest_ready_age_ms: string | null;
    }>(
      `SELECT
        (SELECT count(*) FROM items WHERE status = 'ready') AS ready_count,
        (SELECT count(*) FROM items WHERE status = 'processing') AS processing_count,
        (SELECT ($1::bigint - MIN(created_at))::text FROM items WHERE status = 'ready') AS oldest_ready_age_ms`,
      [nowMs],
    );
    const row = rows[0];
    return {
      readyCount: parseInt(row.ready_count, 10),
      processingCount: parseInt(row.processing_count, 10),
      oldestReadyAgeMs: row.oldest_ready_age_ms === null ? 0 : parseInt(row.oldest_ready_age_ms, 10),
    };
  });

  app.get('/api/v1/diag/halted-sources', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const { rows } = await pool.query<{
      source: string;
      source_id: string;
      status: string;
      error_count: number | null;
      last_error: string | null;
      last_fetched_at: string | null;
    }>(
      `SELECT s.source, s.source_id, ss.status, ss.error_count, ss.last_error, ss.last_fetched_at::text
       FROM sources s
       INNER JOIN source_state ss ON ss.source = s.source AND ss.source_id = s.source_id
       WHERE ss.status = 'halted'
       ORDER BY ss.error_count DESC NULLS LAST`,
    );
    return {
      haltedSources: rows.map((r) => toCamelCase(r as unknown as Record<string, unknown>)),
    };
  });

  app.get<{ Querystring: { sinceMs?: number; limit?: number } }>(
    '/api/v1/diag/health-events',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            sinceMs: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? 50;
      const sinceMs = request.query.sinceMs ?? Date.now() - 24 * 60 * 60 * 1000;
      const { rows } = await pool.query<{
        id: string;
        category: string;
        severity: string;
        message: string;
        metadata: unknown;
        acknowledged: boolean;
        created_at: string;
      }>(
        `SELECT id, category, severity, message, metadata, acknowledged, created_at::text
         FROM health_events
         WHERE severity IN ('error', 'critical') AND created_at >= $1::bigint
         ORDER BY created_at DESC
         LIMIT $2::int`,
        [sinceMs, limit],
      );
      return {
        sinceMs,
        limit,
        events: rows.map((r) => toCamelCase(r as unknown as Record<string, unknown>)),
      };
    },
  );

  registerInsightRoutes({
    app,
    authPreHandler,
    config,
    pool,
    getNarrativeSummaryPreview,
  });

  registerCalendarRoutes({
    app,
    authPreHandler,
    requireAdmin,
    pool,
    toCamelCase,
  });

  app.get<{ Querystring: { q: string; limit?: number } }>(
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

      const { rows } = await pool.query<EntitySearchSuggestionRow>(
        `SELECT id, name, matched_alias
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
                    END AS rank
               FROM entities e
               LEFT JOIN entity_aliases ea ON ea.entity_id = e.id
              WHERE LOWER(e.name) LIKE $1
                 OR ea.alias LIKE $2
              ORDER BY e.id,
                       rank ASC,
                       LENGTH(e.name) ASC,
                       e.name ASC
           ) ranked
          ORDER BY rank ASC, LENGTH(name) ASC, name ASC
          LIMIT $5`,
        [rawPrefix, aliasPrefix, rawQuery.toLowerCase(), normalizedQuery, limit],
      );

      return {
        entities: rows.map((row) => ({
          id: row.id,
          name: row.name,
          matchedAlias: row.matched_alias,
        })),
      };
    },
  );

  // --- Entity Relationships (2.4 Competitor Mapping) ---
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

  // --- Regional Divergence (2.7) ---
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

  // Price data for entity
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

  // Alpha propagation data for entity
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

  // Top authors for entity
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

  // Author profile with recent calls
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

  app.patch<{
    Params: { callId: string };
    Body: { outcome: 'correct' | 'incorrect' | 'unresolved' };
  }>(
    '/api/v1/author-calls/:callId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['callId'],
          properties: {
            callId: { type: 'string', minLength: 1 },
          },
        },
        body: {
          type: 'object',
          required: ['outcome'],
          properties: {
            outcome: {
              type: 'string',
              enum: ['correct', 'incorrect', 'unresolved'],
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const didResolve = await resolveAuthorCall(pool, request.params.callId, request.body.outcome);
      if (!didResolve) {
        return reply.code(404).send({ error: 'Author call not found or already resolved' });
      }

      return reply.code(204).send();
    },
  );

  // --- POST /api/v1/config/test-webhook (CD-005) ---
  app.post(
    '/api/v1/config/test-webhook',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', minLength: 1, maxLength: 2048 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { url } = request.body as { url: string };
      const validation = await validateUrl(url);
      if (!validation.valid || !validation.resolvedIp) {
        return reply.code(400).send({ error: `Invalid webhook URL: ${validation.reason ?? 'DNS resolution failed'}` });
      }
      try {
        const payload = JSON.stringify({
          embeds: [
            {
              title: 'Podders Test Webhook',
              description: 'If you can see this, your webhook is configured correctly.',
              color: 0x5b8def,
              timestamp: new Date().toISOString(),
              footer: { text: 'podders — test delivery' },
            },
          ],
          allowed_mentions: { parse: [] },
        });
        const { response } = await fetchValidated(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            signal: AbortSignal.timeout(15_000),
          },
          validation,
        );
        if (!response) {
          return reply
            .code(400)
            .send({ error: `Invalid webhook URL: ${validation.reason ?? 'DNS resolution failed'}` });
        }
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return reply.code(400).send({ error: `Webhook returned ${response.status}`, detail: text.slice(0, 200) });
        }
        await response.text().catch(() => '');
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.code(400).send({ error: `Webhook delivery failed: ${message}` });
      }
    },
  );

  // --- Static files (dashboard SPA) ---
  const dashboardRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'dist');
  await app.register(fastifyStatic, {
    root: dashboardRoot,
    prefix: '/',
  });

  // --- Global error handler ---
  app.setErrorHandler(async (error, request, reply) => {
    log.error({ err: error, url: request.url, method: request.method }, 'Unhandled route error');
    reply.code(500).send({ error: 'Internal server error' });
  });

  // SPA catch-all for client-side routing
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404);
      return { error: 'Not found' };
    }
    // Return 404 for missing static assets instead of index.html (DB-003)
    if (/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf|eot|map|json)$/i.test(request.url)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  return app;
}

export async function startServer(app: FastifyInstance, port: number, log: Logger): Promise<void> {
  try {
    await app.listen({ port, host: '0.0.0.0' });
    log.info(`Server listening on port ${port}`);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      log.fatal({ port }, `Port ${port} is already in use — is another instance running?`);
      process.exit(1);
    }
    throw err;
  }
}
