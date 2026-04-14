import crypto from 'node:crypto';
import { TaskType } from '@google/generative-ai';
import type { Pool } from '../db/connection.js';
import {
  getRecentEventChains,
  getRecentReportChainDrilldowns,
  getSummaryEventsWithChainContext,
  type EventChainRow,
  type ReportChainDrilldownRow,
  type SummaryEventWithChainRow,
} from '../db/queries.js';
import { normalizeAlias } from '../knowledge/entities.js';
import type { Logger } from '../logger.js';
import type { VectorCache } from '../vector-cache.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface Embedder {
  embed(text: string, taskType?: TaskType): Promise<{ vector: Float32Array } | null>;
  prepareText(text: string, type: 'item' | 'summary' | 'entity' | 'report'): string;
}

export interface LLM {
  sanitizeForPrompt(content: string): string;
}

export interface ChatTool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>): Promise<string>;
  formatUsage?(args: Record<string, unknown>): string;
}

const EVENT_CHAIN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_KEYWORD_EVENT_CHAINS = 3;
const MAX_REPORT_EVENT_CHAINS = 2;
const REPORT_CHAIN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const REPORT_INTENT_PATTERNS = [
  /\btimeline\b/i,
  /\bongoing story\b/i,
  /\bchain of events\b/i,
  /\bwhat changed\b/i,
  /\bover time\b/i,
  /\bfollow-?up\b/i,
  /\bgovernance response\b/i,
];

// ── Helpers ────────────────────────────────────────────────────────────

function wrapNonce(tag: string, content: string): string {
  const nonce = crypto.randomBytes(4).toString('hex');
  return `<${tag}_${nonce}>${content}</${tag}_${nonce}>`;
}

function formatDateForTool(value: number | string): string {
  const epochMs = Number(value);
  if (Number.isFinite(epochMs) && epochMs > 1e12) {
    return new Date(epochMs).toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function formatEventChainSummary(chain: EventChainRow): string {
  const firstDate = formatDateForTool(chain.first_event_time);
  const latestDate = formatDateForTool(chain.latest_event_time);
  const timeline = chain.event_types.join(' -> ');
  const latestDescription = chain.descriptions[chain.descriptions.length - 1];
  const latestText = latestDescription ? ` | latest: ${latestDescription}` : '';
  return `  ${firstDate} -> ${latestDate} | ${chain.event_count} events | chain=${timeline}${latestText}`;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').slice(0, limit);
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

function toEpochMs(value: unknown): number | null {
  const epochMs = Number(value);
  return Number.isFinite(epochMs) && epochMs > 1e12 ? epochMs : null;
}

function formatFocusedReportChain(chain: ReportChainDrilldownRow | null): string | null {
  if (!chain) return null;
  return `Focused report chain: chainRoot=${chain.chain_root_id} | summaryId=${chain.latest_summary_id} | entity=${chain.entity_name} | eventType=${chain.latest_event_type}`;
}

function selectFocusedSummaryChain(rows: SummaryEventWithChainRow[]): SummaryEventWithChainRow | null {
  const candidates = rows.filter(
    (row) =>
      typeof row.chain_root_id === 'string' &&
      row.chain_root_id.length > 0 &&
      typeof row.chain_event_count === 'number' &&
      row.chain_event_count > 1,
  );

  if (candidates.length === 0) return null;

  return (
    candidates.sort((left, right) => {
      if (right.chain_event_count !== left.chain_event_count) {
        return right.chain_event_count - left.chain_event_count;
      }
      if (left.chain_position !== right.chain_position) {
        return left.chain_position - right.chain_position;
      }
      return left.event_time - right.event_time;
    })[0] ?? null
  );
}

function formatFocusedSummaryChain(chain: SummaryEventWithChainRow | null): string | null {
  if (!chain) return null;
  return `Focused summary chain: chainRoot=${chain.chain_root_id} | entity=${chain.entity_name} | eventType=${chain.event_type}`;
}

function formatReportSearchPreview(
  row: {
    body: string;
    tldr?: string | null;
    date?: string | null;
    type?: string | null;
  },
  focusedChain?: ReportChainDrilldownRow | null,
): string {
  const lines: string[] = [];

  if (row.type || row.date) {
    const typeLabel = row.type ? `Type: ${row.type}` : null;
    const dateLabel = row.date ? `Date: ${row.date}` : null;
    const header = [typeLabel, dateLabel].filter(Boolean).join(' | ');
    if (header) {
      lines.push(header);
    }
  }

  const focusedChainLine = formatFocusedReportChain(focusedChain ?? null);
  if (focusedChainLine) {
    lines.push(focusedChainLine);
  }

  const tldr = row.tldr?.trim();
  if (tldr) {
    lines.push(`TLDR: ${tldr}`);
  }

  const parsed = parseJsonObject(row.body);
  if (parsed) {
    const eventChains = extractStringArray(parsed.eventChains ?? parsed.event_chains, MAX_REPORT_EVENT_CHAINS);
    if (eventChains.length > 0) {
      lines.push(`Event chains: ${eventChains.join(' | ')}`);
    }
  }

  if (lines.length === 0) {
    lines.push(row.body);
  }

  return lines.join('\n');
}

function inferSemanticSearchType(query: string, requestedType?: 'summary' | 'report'): 'summary' | 'report' {
  if (requestedType) return requestedType;
  return REPORT_INTENT_PATTERNS.some((pattern) => pattern.test(query)) ? 'report' : 'summary';
}

async function getFocusedReportChain(
  pool: Pool,
  row: {
    body: string;
    created_at: string | number;
  },
): Promise<ReportChainDrilldownRow | null> {
  const parsed = parseJsonObject(row.body);
  const reportEntityNames = extractReportEntityNames(parsed?.entitySentiment ?? parsed?.entity_sentiment);
  const createdAt = toEpochMs(row.created_at);
  if (reportEntityNames.length === 0 || createdAt === null) {
    return null;
  }

  const rows = await getRecentReportChainDrilldowns(
    pool,
    reportEntityNames,
    createdAt,
    createdAt - REPORT_CHAIN_LOOKBACK_MS,
    1,
  );
  return rows[0] ?? null;
}

async function getFocusedSummaryChain(pool: Pool, summaryId: string): Promise<SummaryEventWithChainRow | null> {
  return selectFocusedSummaryChain(await getSummaryEventsWithChainContext(pool, summaryId));
}

// ── Tool Factories ────────────────────────────────────────────────────

function createSemanticSearch(pool: Pool, log: Logger, vectorCache: VectorCache, embedder: Embedder): ChatTool {
  return {
    name: 'semantic_search',
    description: 'Search summaries and reports by semantic similarity. Returns top 10 results with IDs for citation.',
    formatUsage(args: Record<string, unknown>): string {
      const query = typeof args['query'] === 'string' ? args['query'] : '';
      const type = inferSemanticSearchType(query, args['type'] as 'summary' | 'report' | undefined);
      return `semantic_search:${type}`;
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const query = args['query'] as string | undefined;
      if (!query) return 'Error: query is required';

      const type = inferSemanticSearchType(query, args['type'] as 'summary' | 'report' | undefined);

      const ALLOWED_TABLES: Record<string, string> = { summary: 'summaries', report: 'reports' };
      const table = ALLOWED_TABLES[type];
      if (!table) return 'Error: invalid search type';

      log.info({ query, type }, 'chat: semantic_search');

      const prepared = embedder.prepareText(query, type);
      const embedding = await embedder.embed(prepared, TaskType.RETRIEVAL_QUERY);
      if (!embedding) return 'Error: embedding service unavailable';

      const results = await vectorCache.search(embedding.vector, type, 10);

      if (results.length === 0) {
        return 'No results found.';
      }

      // Fetch content for each result
      const ids = results.map((r) => r.targetId);

      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
      const dbResult =
        type === 'report'
          ? await pool.query<{
              id: string;
              body: string;
              created_at: string;
              tldr: string | null;
              date: string;
              type: string;
            }>(`SELECT id, body, created_at, tldr, date, type FROM reports WHERE id IN (${placeholders})`, ids)
          : await pool.query<{
              id: string;
              body: string;
              created_at: string;
            }>(`SELECT id, body, created_at FROM ${table} WHERE id IN (${placeholders})`, ids);

      const contentMap = new Map<string, { content: string; createdAt: string }>();
      if (type === 'report') {
        const reportRows = dbResult.rows as Array<{
          id: string;
          body: string;
          created_at: string;
          tldr: string | null;
          date: string;
          type: string;
        }>;
        const focusedChains = await Promise.all(
          reportRows.map(async (row) => ({
            id: row.id,
            chain: await getFocusedReportChain(pool, row),
          })),
        );
        const focusedChainMap = new Map(focusedChains.map((entry) => [entry.id, entry.chain]));

        for (const row of reportRows) {
          contentMap.set(row.id, {
            content: formatReportSearchPreview(row, focusedChainMap.get(row.id) ?? null),
            createdAt: row.created_at,
          });
        }
      } else {
        const summaryRows = dbResult.rows as Array<{
          id: string;
          body: string;
          created_at: string;
        }>;
        const focusedChains = await Promise.all(
          summaryRows.map(async (row) => ({
            id: row.id,
            chain: await getFocusedSummaryChain(pool, row.id),
          })),
        );
        const focusedChainMap = new Map(focusedChains.map((entry) => [entry.id, entry.chain]));

        for (const row of summaryRows) {
          const focusedChainLine = formatFocusedSummaryChain(focusedChainMap.get(row.id) ?? null);
          contentMap.set(row.id, {
            content: focusedChainLine ? `${focusedChainLine}\n${row.body}` : row.body,
            createdAt: row.created_at,
          });
        }
      }

      const lines: string[] = [];
      for (const result of results) {
        const entry = contentMap.get(result.targetId);
        if (!entry) continue;

        // Truncate each result body so more results survive the handler's MAX_TOOL_RESULT_CHARS limit
        const truncatedBody = entry.content.length > 300 ? entry.content.slice(0, 300) + '...' : entry.content;

        // Display created_at as YYYY-MM-DD instead of raw epoch-ms
        const epochMs = Number(entry.createdAt);
        const dateStr =
          Number.isFinite(epochMs) && epochMs > 1e12
            ? new Date(epochMs).toISOString().slice(0, 10)
            : String(entry.createdAt).slice(0, 10);

        // Already pipeline-processed content — wrap but don't re-sanitize
        const wrapped = wrapNonce('search_result', truncatedBody);
        lines.push(`[${result.targetId}] (score: ${result.score.toFixed(3)}, date: ${dateStr})\n${wrapped}`);
      }

      return lines.join('\n\n');
    },
  };
}

function createKeywordSearch(pool: Pool, log: Logger): ChatTool {
  type ResolvedKeywordRow = {
    id: string;
    name?: string;
    type?: string;
    relevance?: number;
    sentiment?: number;
    created_at?: string;
  };

  function isKeywordSearchMentionRow(row: ResolvedKeywordRow): row is {
    id: string;
    name: string;
    type: string;
    relevance: number;
    sentiment: number;
    created_at: string;
  } {
    return (
      typeof row.id === 'string' &&
      row.id.length > 0 &&
      typeof row.name === 'string' &&
      typeof row.type === 'string' &&
      typeof row.relevance === 'number' &&
      typeof row.sentiment === 'number' &&
      typeof row.created_at === 'string'
    );
  }

  return {
    name: 'keyword_search',
    description: 'Look up an entity by name/alias. Returns mention counts, sentiment history, and recent event chains.',
    async execute(args: Record<string, unknown>): Promise<string> {
      const entity = args['entity'] as string | undefined;
      if (!entity) return 'Error: entity is required';

      log.info({ entity }, 'chat: keyword_search');

      const normalizedEntity = normalizeAlias(entity);
      const resolved = await pool.query<ResolvedKeywordRow>(
        `SELECT DISTINCT ON (ea.alias)
            ea.entity_id AS id
           FROM entities e
           JOIN entity_aliases ea ON ea.entity_id = e.id
          WHERE ea.alias = $1
          ORDER BY ea.alias, (e.status = 'active') DESC, (ea.context_key = '') DESC, ea.context_key, ea.entity_id`,
        [normalizedEntity],
      );

      if (resolved.rows.length === 0) {
        return `No mentions found for entity "${entity}".`;
      }

      const entityId = resolved.rows[0].id;

      const resolvedMentionRows = resolved.rows.filter(isKeywordSearchMentionRow);
      const dbRows =
        resolvedMentionRows.length > 0
          ? resolvedMentionRows
          : (
              await pool.query<{
                id: string;
                name: string;
                type: string;
                relevance: number;
                sentiment: number;
                created_at: string;
              }>(
                `SELECT e.id, e.name, e.type, e.relevance, em.sentiment, em.created_at
                 FROM entities e
                 JOIN entity_mentions em ON em.entity_id = e.id
                 WHERE e.id = $1
                 ORDER BY em.created_at DESC
                 LIMIT 20`,
                [entityId],
              )
            ).rows;

      if (dbRows.length === 0) {
        return `No mentions found for entity "${entity}".`;
      }

      const first = dbRows[0];
      const mentionCount = dbRows.length;
      const avgSentiment = dbRows.reduce((sum, r) => sum + r.sentiment, 0) / mentionCount;

      const lines: string[] = [
        `Entity: ${first.name} (${first.type})`,
        `Relevance: ${first.relevance}`,
        `Recent mentions: ${mentionCount}`,
        `Average sentiment: ${avgSentiment.toFixed(2)}`,
        '',
        'Recent sentiment history:',
      ];

      for (const row of dbRows) {
        lines.push(`  ${formatDateForTool(row.created_at)}: sentiment ${row.sentiment.toFixed(2)}`);
      }

      if (typeof first.id === 'string' && first.id.length > 0) {
        const chains = await getRecentEventChains(
          pool,
          [first.id],
          Date.now() - EVENT_CHAIN_LOOKBACK_MS,
          MAX_KEYWORD_EVENT_CHAINS,
        );
        if (chains.length > 0) {
          lines.push('', 'Recent event chains:');
          for (const chain of chains) {
            lines.push(formatEventChainSummary(chain));
          }
        }
      }

      return lines.join('\n');
    },
  };
}

function createReadRaw(pool: Pool, log: Logger, llm: LLM): ChatTool {
  return {
    name: 'read_raw',
    description: 'Read the original raw source message by item ID. Returns sanitized content.',
    async execute(args: Record<string, unknown>): Promise<string> {
      const itemId = args['itemId'] as string | undefined;
      if (!itemId) return 'Error: itemId is required';

      log.info({ itemId }, 'chat: read_raw');

      const dbResult = await pool.query<{
        id: string;
        content: string;
        author: string;
        created_at: string;
      }>('SELECT id, content, author, created_at FROM items WHERE id = $1', [itemId]);

      if (dbResult.rows.length === 0) {
        return `No item found with ID "${itemId}".`;
      }

      const row = dbResult.rows[0];

      // MUST sanitize — original source content could contain injection attempts
      const sanitized = llm.sanitizeForPrompt(row.content);
      const wrapped = wrapNonce('raw_content', sanitized);

      return `Item ${row.id} by ${row.author} at ${row.created_at}:\n${wrapped}`;
    },
  };
}

// ── Public API ─────────────────────────────────────────────────────────

export function createChatTools(
  pool: Pool,
  log: Logger,
  vectorCache: VectorCache,
  embedder: Embedder,
  llm: LLM,
): ChatTool[] {
  return [
    createSemanticSearch(pool, log, vectorCache, embedder),
    createKeywordSearch(pool, log),
    createReadRaw(pool, log, llm),
  ];
}
