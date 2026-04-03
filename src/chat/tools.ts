import crypto from 'node:crypto';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { VectorCache } from '../vector-cache.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface Embedder {
  embed(text: string): Promise<{ vector: Float32Array } | null>;
}

export interface LLM {
  sanitizeForPrompt(content: string): string;
}

export interface ChatTool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>): Promise<string>;
}

// ── Helpers ────────────────────────────────────────────────────────────

function wrapNonce(tag: string, content: string): string {
  const nonce = crypto.randomBytes(4).toString('hex');
  return `<${tag}_${nonce}>${content}</${tag}_${nonce}>`;
}

// ── Tool Factories ────────────────────────────────────────────────────

function createSemanticSearch(
  pool: Pool,
  log: Logger,
  vectorCache: VectorCache,
  embedder: Embedder,
): ChatTool {
  return {
    name: 'semantic_search',
    description:
      'Search summaries and reports by semantic similarity. Returns top 10 results with IDs for citation.',
    async execute(args: Record<string, unknown>): Promise<string> {
      const query = args['query'] as string | undefined;
      if (!query) return 'Error: query is required';

      const type = (args['type'] as 'summary' | 'report' | undefined) ?? 'summary';

      log.info({ query, type }, 'chat: semantic_search');

      const embedding = await embedder.embed(query);
      if (!embedding) return 'Error: embedding service unavailable';

      const results = vectorCache.search(embedding.vector, type, 10);

      if (results.length === 0) {
        return 'No results found.';
      }

      // Fetch content for each result
      const ids = results.map((r) => r.targetId);
      const tableName = type === 'summary' ? 'summaries' : 'reports';
      const contentColumn = 'body';

      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
      const dbResult = await pool.query<{
        id: string;
        body: string;
        created_at: string;
      }>(
        `SELECT id, body, created_at FROM ${tableName} WHERE id IN (${placeholders})`,
        ids,
      );

      const contentMap = new Map<string, { content: string; createdAt: string }>();
      for (const row of dbResult.rows) {
        contentMap.set(row.id, {
          content: row.body,
          createdAt: row.created_at,
        });
      }

      const lines: string[] = [];
      for (const result of results) {
        const entry = contentMap.get(result.targetId);
        if (!entry) continue;

        // Already pipeline-processed content — wrap but don't re-sanitize
        const wrapped = wrapNonce('search_result', entry.content);
        lines.push(
          `[${result.targetId}] (score: ${result.score.toFixed(3)}, date: ${entry.createdAt})\n${wrapped}`,
        );
      }

      return lines.join('\n\n');
    },
  };
}

function createKeywordSearch(pool: Pool, log: Logger): ChatTool {
  return {
    name: 'keyword_search',
    description:
      'Look up an entity by name/alias. Returns mention counts, sentiment history, and related entities.',
    async execute(args: Record<string, unknown>): Promise<string> {
      const entity = args['entity'] as string | undefined;
      if (!entity) return 'Error: entity is required';

      log.info({ entity }, 'chat: keyword_search');

      const dbResult = await pool.query<{
        name: string;
        type: string;
        relevance: number;
        sentiment: number;
        created_at: string;
      }>(
        `SELECT e.name, e.type, e.relevance, em.sentiment, em.created_at
         FROM entities e
         JOIN entity_mentions em ON em.entity_id = e.id
         JOIN entity_aliases ea ON ea.entity_id = e.id
         WHERE ea.alias = $1
         ORDER BY em.created_at DESC
         LIMIT 20`,
        [entity.toLowerCase()],
      );

      if (dbResult.rows.length === 0) {
        return `No mentions found for entity "${entity}".`;
      }

      const first = dbResult.rows[0];
      const mentionCount = dbResult.rows.length;
      const avgSentiment =
        dbResult.rows.reduce((sum, r) => sum + r.sentiment, 0) / mentionCount;

      const lines: string[] = [
        `Entity: ${first.name} (${first.type})`,
        `Relevance: ${first.relevance}`,
        `Recent mentions: ${mentionCount}`,
        `Average sentiment: ${avgSentiment.toFixed(2)}`,
        '',
        'Recent sentiment history:',
      ];

      for (const row of dbResult.rows) {
        lines.push(`  ${row.created_at}: sentiment ${row.sentiment.toFixed(2)}`);
      }

      return lines.join('\n');
    },
  };
}

function createReadRaw(pool: Pool, log: Logger, llm: LLM): ChatTool {
  return {
    name: 'read_raw',
    description:
      'Read the original raw source message by item ID. Returns sanitized content.',
    async execute(args: Record<string, unknown>): Promise<string> {
      const itemId = args['itemId'] as string | undefined;
      if (!itemId) return 'Error: itemId is required';

      log.info({ itemId }, 'chat: read_raw');

      const dbResult = await pool.query<{
        id: string;
        content: string;
        author: string;
        created_at: string;
      }>(
        'SELECT id, content, author, created_at FROM items WHERE id = $1',
        [itemId],
      );

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
