import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Pool } from './db/connection.js';
import {
  getDiscordTokens,
  type ItemRow,
  type ReportChainDrilldownRow,
  type SummaryEventWithChainRow,
} from './db/queries.js';
import { decryptSecret } from './crypto/token-encrypt.js';
import { maskDiscordToken, maskProxyUrl, normalizeProxyUrl } from './discord-tokens.js';

export type ToCamelCase = <T>(obj: Record<string, unknown>) => T;

/** Convert object keys from snake_case to camelCase. Shallow — does not recurse into nested objects. */
export function toCamelCase<T>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

export function parseReportBody(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseSummaryBody(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function timingSafeEqualString(left: string, right: string): boolean {
  if (Buffer.byteLength(left) !== Buffer.byteLength(right)) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function extractStringArrayField(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').slice(0, limit);
}

export function extractMacroRegime(value: unknown): {
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

export function getSourceTargetFromRequest(
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

export function getReportSearchPreview(tldr: string | null, body: string): string {
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

export function getNarrativeSummaryPreview(body: string): string {
  const parsed = parseSummaryBody(body);
  const summaryText = parsed && typeof parsed.summary === 'string' ? parsed.summary : body;
  return clampPreviewText(summaryText, 220);
}

export function parseItemRecord(row: ItemRow): Record<string, unknown> {
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

export function extractSummaryEntities(value: unknown): Array<Record<string, unknown>> {
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

export function extractReportEntityNames(value: unknown): string[] {
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

export function extractSummaryEvents(value: unknown): Array<Record<string, unknown>> {
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

export function serializeReportChainDrilldowns(rows: ReportChainDrilldownRow[]): Array<Record<string, unknown>> {
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

export function getReportPreviewChains(rows: ReportChainDrilldownRow[]): {
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

export function serializeSummaryEventRows(rows: SummaryEventWithChainRow[]): Array<Record<string, unknown>> {
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

export const REPORT_EVENT_CHAIN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
export const REPORT_PREVIEW_CHAIN_DRILLDOWN_LIMIT = 2;

export interface UserRow {
  discord_id: string;
  username: string;
  avatar: string | null;
  role: string;
  created_at: number;
  last_login_at: number | null;
}

export interface UserAuditRow {
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

export interface AccessRequestRow {
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

export interface ChatHandler {
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

export interface DiscordTokenView {
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

export interface DiscordTokenHealthState {
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

export interface EntitySearchSuggestionRow {
  id: string;
  name: string;
  matched_alias: string | null;
}

export async function getManagedDiscordTokenViews(pool: Pool, encKey: string): Promise<DiscordTokenView[]> {
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

export async function recordUserAuditEvent(
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
