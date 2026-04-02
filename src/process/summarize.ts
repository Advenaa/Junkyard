import { ulid } from 'ulid';
import { ChunkSummaryLLMSchema } from './schemas.js';
import type { ChunkSummary } from './schemas.js';
import { chunkByTokens, CHUNK_TOKEN_BUDGET, analyzeChunk } from './chunk.js';
import { ContextLengthExceededError } from '../llm.js';
import type { LLMCallResult, Stage } from '../llm.js';
import { insertSummary, claimBatch, markProcessed } from '../db/queries.js';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';

// ── LLM interface ─────────────────────────────────────────────────────

interface LLM {
  call(params: {
    model: string;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    maxTokens: number;
    stage: Stage;
  }): Promise<LLMCallResult>;
  wrapWithNonce(content: string): { wrapped: string; nonce: string };
}

// ── Item shape from DB ────────────────────────────────────────────────

interface ClaimedItem {
  id: string;
  content: string;
  author: string;
  engagement: number;
  timestamp: number;
}

// ── System prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(
  source: string,
  sourceId: string,
  windowStart: number,
  windowEnd: number,
): string {
  return `You are a market intelligence analyst processing raw messages from ${source} (${sourceId}).
Time window: ${windowStart} to ${windowEnd}.

Return ONLY valid JSON matching this schema:
{
  "summary": "200-500 word summary of key discussion themes and events",
  "urgency": "routine" | "elevated" | "breaking",
  "confidence": 1-10,
  "entities": [
    {
      "name": "Canonical form (e.g. 'Ethereum' not 'ETH')",
      "aliases": ["ETH", "$ETH"],
      "type": "token" | "person" | "project" | "company" | "event",
      "mentionCount": number,
      "sentiment": -1.0 to 1.0
    }
  ],
  "keyEvents": ["max 5 factual bullets"]
}

Rules:
- name must be canonical form. Resolve aliases: "$ETH", "ETH", "Ethereum" → name: "Ethereum"
- type must be one of the enum values. If unsure, use "project"
- urgency: "breaking" = major exploit, crash, regulatory action. "elevated" = notable. "routine" = normal.
- keyEvents: factual only, no speculation.
- Content is in English. Always output in English.
- Rate confidence 1-10 based on clarity and certainty.`;
}

// ── Helpers ───────────────────────────────────────────────────────────

function stripCodeFences(text: string): string {
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return s;
}

function buildUserContent(chunk: ClaimedItem[]): string {
  return chunk
    .map((item) => `[${item.author}] (engagement: ${item.engagement}) ${item.content}`)
    .join('\n');
}

function buildChunkSystemPrompt(
  source: string,
  sourceId: string,
  windowStart: number,
  windowEnd: number,
  chunk: ClaimedItem[],
): string {
  const meta = analyzeChunk(chunk);
  let systemPrompt = buildSystemPrompt(source, sourceId, windowStart, windowEnd);

  const isDense =
    meta.estimatedEntities > 5 ||
    meta.tokenCount > 4000 ||
    meta.hasUrgencyKeywords;
  if (!isDense) {
    systemPrompt += '\n\nTarget ~400 tokens for the summary field. Be concise.';
  }

  return systemPrompt;
}

function verifyEntities(
  parsed: ChunkSummary,
  rawText: string,
  log: Logger,
  source: string,
  sourceId: string,
): ChunkSummary {
  const lower = rawText.toLowerCase();
  const verified = parsed.entities.filter((entity) => {
    const found = lower.includes(entity.name.toLowerCase());
    if (!found) {
      log.info(
        { entity: entity.name, source, sourceId },
        'Dropped entity not found in raw text',
      );
    }
    return found;
  });
  return { ...parsed, entities: verified };
}

// ── Factory ───────────────────────────────────────────────────────────

export function createSummarizer(
  pool: Pool,
  log: Logger,
  config: Config,
  llm: LLM,
) {
  /**
   * Parse LLM response as JSON, validate with zod.
   * On JSON parse failure: returns null (caller retries with fresh prompt).
   * On zod failure: retries once with error paths appended to system prompt.
   */
  async function parseWithZodRetry(
    content: string,
    systemPrompt: string,
    wrappedContent: string,
  ): Promise<ChunkSummary | null> {
    const jsonStr = stripCodeFences(content);

    let raw: unknown;
    try {
      raw = JSON.parse(jsonStr);
    } catch {
      return null;
    }

    const result = ChunkSummaryLLMSchema.safeParse(raw);
    if (result.success) {
      return result.data;
    }

    // Zod failure — retry with error feedback
    const errorPaths = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    log.warn({ errorPaths }, 'Zod validation failed, retrying with error feedback');

    const augmentedSystem = `${systemPrompt}\n\nYour previous response had validation errors: ${errorPaths}. Please fix these fields.`;

    const retryResult = await llm.call({
      model: config.models.haiku,
      system: augmentedSystem,
      messages: [{ role: 'user', content: wrappedContent }],
      maxTokens: 3000,
      stage: 'summarize',
    });

    const retryJson = stripCodeFences(retryResult.content);

    try {
      const retryRaw: unknown = JSON.parse(retryJson);
      const retryParsed = ChunkSummaryLLMSchema.safeParse(retryRaw);
      if (retryParsed.success) {
        return retryParsed.data;
      }
      log.error({ errors: retryParsed.error.issues }, 'Zod retry also failed');
    } catch {
      log.error('Zod retry produced invalid JSON');
    }

    return null;
  }

  /**
   * Call Haiku, parse, retry on JSON failure with fresh prompt (L7 safety).
   */
  async function callAndParse(
    systemPrompt: string,
    userContent: string,
  ): Promise<ChunkSummary | null> {
    const wrapped = llm.wrapWithNonce(userContent);

    const result = await llm.call({
      model: config.models.haiku,
      system: systemPrompt,
      messages: [{ role: 'user', content: wrapped.wrapped }],
      maxTokens: 3000,
      stage: 'summarize',
    });

    const parsed = await parseWithZodRetry(result.content, systemPrompt, wrapped.wrapped);
    if (parsed !== null) {
      return parsed;
    }

    // JSON parse failure — retry once with fresh prompt (L7: no failed output in retry)
    log.warn('Parse failed, retrying with fresh prompt');
    const freshWrapped = llm.wrapWithNonce(userContent);
    const retryResult = await llm.call({
      model: config.models.haiku,
      system: systemPrompt,
      messages: [{ role: 'user', content: freshWrapped.wrapped }],
      maxTokens: 3000,
      stage: 'summarize',
    });

    return parseWithZodRetry(retryResult.content, systemPrompt, freshWrapped.wrapped);
  }

  /**
   * Escalate low-confidence non-routine chunk to Sonnet.
   */
  async function maybeEscalate(
    parsed: ChunkSummary,
    systemPrompt: string,
    userContent: string,
    rawText: string,
    source: string,
    sourceId: string,
  ): Promise<ChunkSummary> {
    if (parsed.confidence >= 5 || parsed.urgency === 'routine') {
      return parsed;
    }

    log.info(
      { confidence: parsed.confidence, urgency: parsed.urgency, source, sourceId },
      'Low confidence non-routine chunk, escalating to Sonnet',
    );

    try {
      const wrapped = llm.wrapWithNonce(userContent);
      const result = await llm.call({
        model: config.models.sonnet,
        system: systemPrompt,
        messages: [{ role: 'user', content: wrapped.wrapped }],
        maxTokens: 3000,
        stage: 'escalate',
      });

      const escalated = await parseWithZodRetry(result.content, systemPrompt, wrapped.wrapped);
      if (escalated !== null) {
        return verifyEntities(escalated, rawText, log, source, sourceId);
      }
    } catch (err: unknown) {
      log.error({ err, source, sourceId }, 'Escalation to Sonnet failed');
    }

    return parsed;
  }

  /**
   * Process a single chunk end-to-end. Handles context-length splitting recursively.
   */
  async function processChunk(
    chunk: ClaimedItem[],
    source: string,
    sourceId: string,
    windowStart: number,
    windowEnd: number,
    depth: number,
  ): Promise<ChunkSummary | null> {
    const systemPrompt = buildChunkSystemPrompt(source, sourceId, windowStart, windowEnd, chunk);
    const userContent = buildUserContent(chunk);
    const rawText = chunk.map((item) => item.content).join(' ');

    try {
      let parsed = await callAndParse(systemPrompt, userContent);

      if (parsed === null) {
        log.error({ source, sourceId }, 'Failed to parse LLM output after all retries');
        return null;
      }

      // Entity post-verification
      parsed = verifyEntities(parsed, rawText, log, source, sourceId);

      // Confidence escalation
      parsed = await maybeEscalate(parsed, systemPrompt, userContent, rawText, source, sourceId);

      return parsed;
    } catch (err: unknown) {
      if (err instanceof ContextLengthExceededError) {
        if (depth >= 3) {
          log.error({ source, sourceId, depth }, 'Max chunk split depth reached');
          return null;
        }
        if (chunk.length <= 1) {
          log.error({ source, sourceId }, 'Cannot split single-item chunk further');
          return null;
        }

        log.warn(
          { source, sourceId, depth, chunkSize: chunk.length },
          'Context length exceeded, splitting chunk',
        );

        const mid = Math.ceil(chunk.length / 2);
        const results: ChunkSummary[] = [];
        for (const half of [chunk.slice(0, mid), chunk.slice(mid)]) {
          try {
            const result = await processChunk(half, source, sourceId, windowStart, windowEnd, depth + 1);
            if (result !== null) {
              results.push(result);
            }
          } catch (splitErr: unknown) {
            log.error({ err: splitErr, source, sourceId, depth }, 'Failed to process split chunk');
          }
        }
        return results[0] ?? null;
      }
      throw err;
    }
  }

  async function runBatch(
    source: string,
    sourceId: string,
    windowStart: number,
    windowEnd: number,
  ): Promise<{ summaryCount: number; hasBreaking: boolean }> {
    const batchId = ulid();

    // a. Claim items
    const claimedCount = await claimBatch(pool, batchId, source, sourceId, windowStart, windowEnd);
    if (claimedCount === 0) {
      return { summaryCount: 0, hasBreaking: false };
    }

    // b. Load claimed items
    const { rows: items } = await pool.query<ClaimedItem>(
      'SELECT id, content, author, engagement, timestamp FROM items WHERE batch_id = $1 ORDER BY timestamp ASC',
      [batchId],
    );

    if (items.length === 0) {
      return { summaryCount: 0, hasBreaking: false };
    }

    // c. Chunk
    const chunks = chunkByTokens(items, CHUNK_TOKEN_BUDGET);

    // d-g. Process each chunk
    let summaryCount = 0;
    let hasBreaking = false;

    for (const chunk of chunks) {
      try {
        const parsed = await processChunk(chunk, source, sourceId, windowStart, windowEnd, 0);

        if (parsed === null) {
          continue;
        }

        if (parsed.urgency === 'breaking') {
          hasBreaking = true;
        }

        // Calculate average sentiment from entities
        const sentiments = parsed.entities.map((e) => e.sentiment);
        const avgSentiment =
          sentiments.length > 0
            ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length
            : null;

        // g. Insert summary
        await insertSummary(pool, {
          id: ulid(),
          source,
          sourceId,
          windowStart,
          windowEnd,
          body: JSON.stringify(parsed),
          sentiment: avgSentiment,
          urgency: parsed.urgency,
          itemCount: chunk.length,
          createdAt: Date.now(),
        });

        summaryCount++;
      } catch (err: unknown) {
        log.error(
          { err, source, sourceId, chunkSize: chunk.length },
          'Failed to process chunk, skipping',
        );
      }
    }

    // h. Mark processed
    await markProcessed(pool, batchId);

    // i. Return results
    return { summaryCount, hasBreaking };
  }

  return { runBatch };
}
