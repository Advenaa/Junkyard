import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import type { EmbedContentRequest } from '@google/generative-ai';
import { ulid } from 'ulid';
import type { Config } from './config.js';
import type { Pool } from './db/connection.js';
import type { Logger } from './logger.js';
import { insertLlmUsage } from './db/queries.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface EmbedResult {
  vector: Float32Array;
  dimensions: number; // 768
  model: string; // 'gemini-embedding-001'
}

interface GoogleGenerativeAIFetchError extends Error {
  status: number;
}

function isFetchError(err: unknown): err is GoogleGenerativeAIFetchError {
  return err instanceof Error && 'status' in err && typeof (err as GoogleGenerativeAIFetchError).status === 'number';
}

// ── Constants ──────────────────────────────────────────────────────────

const MODEL_NAME = 'gemini-embedding-001';
const DIMENSIONS = 768;
const BATCH_CHUNK_SIZE = 100;
const MAX_CHARS = 2048; // ~512 tokens at 4 chars/token
const RETRY_BACKOFFS = [2_000, 8_000, 32_000]; // 3 retries for 5xx
const DEFAULT_429_WAIT = 60_000;

// Gemini free tier: 1500 req/day. Leave 100 buffer for manual/debug use.
export const DAILY_QUOTA_LIMIT = 1400;

// ── Helpers ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function bytesToVector(buf: Buffer): Float32Array | null {
  if (buf.byteLength === 0 || buf.byteLength % 4 !== 0) {
    return null;
  }
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

// ── Discord text preparation ───────────────────────────────────────────

function stripDiscordFormatting(text: string): string {
  let result = text;
  // Remove bold/italic markers: **bold** → bold, *italic* → italic
  result = result.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  // Remove underline: __text__ → text
  result = result.replace(/__([^_]+)__/g, '$1');
  // Remove strikethrough: ~~text~~ → text
  result = result.replace(/~~([^~]+)~~/g, '$1');
  // Remove blockquotes: > quote → quote
  result = result.replace(/^>\s?/gm, '');
  // Remove user mentions: <@123456> or <@!123456>
  result = result.replace(/<@!?\d+>/g, '');
  // Remove channel mentions: <#123456>
  result = result.replace(/<#\d+>/g, '');
  // Remove custom emoji: <:name:123456> or <a:name:123456>
  result = result.replace(/<a?:\w+:\d+>/g, '');
  return result;
}

// ── Retry wrapper ──────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, log: Logger, onAuthFailure?: () => void): Promise<T> {
  let lastError: unknown;

  // Initial attempt + 3 retries
  for (let attempt = 0; attempt <= RETRY_BACKOFFS.length; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      if (!isFetchError(err)) throw err;

      if (err.status === 401 || err.status === 403) {
        onAuthFailure?.();
        throw err;
      }

      if (err.status === 429) {
        // Google GenAI SDK does not expose Retry-After headers in error objects.
        // Use a sensible default that respects Gemini's free tier (1500 req/day ≈ 1 req/min).
        const waitMs = DEFAULT_429_WAIT;
        log.warn({ status: 429, waitMs, attempt }, 'embed: rate limited, waiting');
        await sleep(waitMs);
        continue;
      }

      if (err.status >= 500 && err.status < 600) {
        if (attempt >= RETRY_BACKOFFS.length) break;
        const backoff = RETRY_BACKOFFS[attempt];
        log.warn({ status: err.status, backoff, attempt }, 'embed: server error, retrying');
        await sleep(backoff);
        continue;
      }

      // Non-retryable error
      throw err;
    }
  }

  throw lastError;
}

// ── Public API ─────────────────────────────────────────────────────────

export function createEmbedder(config: Config, pool: Pool, log: Logger, onAuthFailure?: () => void) {
  const geminiKey = config.geminiApiKey ?? config.googleApiKey;
  const available = Boolean(geminiKey);
  const genAI = available ? new GoogleGenerativeAI(geminiKey!) : null;
  const model = genAI ? genAI.getGenerativeModel({ model: MODEL_NAME }) : null;

  // ── Daily quota tracking (in-memory, resets each calendar day) ──────
  let dailyCount = 0;
  let dayStart = Date.now();
  let initPromise: Promise<void> | null = null;

  async function initQuota(): Promise<void> {
    if (!initPromise) {
      initPromise = (async () => {
        try {
          const today = new Date().toISOString().slice(0, 10);
          const { rows } = await pool.query<{ count: string }>(
            `SELECT COUNT(*) as count FROM llm_usage WHERE stage = 'embedding' AND created_at > $1`,
            [new Date(today + 'T00:00:00Z').getTime()],
          );
          dailyCount = parseInt(rows[0]?.count ?? '0', 10);
          if (dailyCount > 0) {
            log.info({ dailyCount }, 'Restored embedding quota from DB');
          }
        } catch {
          dailyCount = DAILY_QUOTA_LIMIT;
          initPromise = null;
          log.warn({ dailyCount }, 'Could not restore embedding quota from DB, failing closed until retry succeeds');
        }
      })();
    }
    return initPromise;
  }

  function getQuotaState(): { dailyCount: number; initialized: boolean } {
    return { dailyCount, initialized: initPromise !== null };
  }

  function resetIfNewDay(): void {
    const now = Date.now();
    const currentDay = new Date(now).toISOString().slice(0, 10);
    const storedDay = new Date(dayStart).toISOString().slice(0, 10);
    if (currentDay !== storedDay) {
      dailyCount = 0;
      dayStart = now;
      initPromise = null; // Re-init on new day
    }
  }

  function isAvailable(): boolean {
    return available;
  }

  async function embed(text: string, taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT): Promise<EmbedResult | null> {
    if (!available || !model) return null;

    await initQuota();
    resetIfNewDay();
    if (dailyCount + 1 > DAILY_QUOTA_LIMIT) {
      log.warn(
        { dailyCount, requestCount: 1, limit: DAILY_QUOTA_LIMIT },
        'embed: daily quota exhausted, skipping embed call',
      );
      return null;
    }
    dailyCount += 1; // Reserve upfront

    let result;
    try {
      result = await withRetry(
        () =>
          // SDK 0.24.1 forwards outputDimensionality but does not type it yet.
          model.embedContent({
            content: { parts: [{ text }], role: 'user' },
            taskType,
            outputDimensionality: DIMENSIONS,
          } as Parameters<typeof model.embedContent>[0]),
        log,
        onAuthFailure,
      );
    } catch (err) {
      dailyCount -= 1; // Refund on failure
      throw err;
    }

    const vector = new Float32Array(result.embedding.values);
    if (vector.length !== DIMENSIONS) {
      log.warn({ expected: DIMENSIONS, got: vector.length, model: MODEL_NAME }, 'embed: unexpected vector dimensions');
      throw new Error(`embed: expected ${DIMENSIONS} dimensions but got ${vector.length}`);
    }
    const inputTokens = estimateTokens(text);

    await insertLlmUsage(pool, {
      id: ulid(),
      stage: 'embedding',
      model: MODEL_NAME,
      inputTokens,
      outputTokens: 0,
      costUsd: 0,
      createdAt: Date.now(),
    });

    return { vector, dimensions: DIMENSIONS, model: MODEL_NAME };
  }

  async function embedBatch(texts: string[]): Promise<(EmbedResult | null)[]> {
    if (!available || !model) return texts.map(() => null);

    // Each batch chunk is one API request; total requests = ceil(texts.length / BATCH_CHUNK_SIZE)
    const totalRequests = Math.ceil(texts.length / BATCH_CHUNK_SIZE);

    await initQuota();
    resetIfNewDay();
    if (dailyCount + totalRequests > DAILY_QUOTA_LIMIT) {
      log.warn(
        { dailyCount, requestCount: totalRequests, limit: DAILY_QUOTA_LIMIT },
        'embed: daily quota exhausted, skipping embed call',
      );
      return texts.map(() => null);
    }
    dailyCount += totalRequests; // Reserve upfront

    const results: (EmbedResult | null)[] = [];
    let totalInputTokens = 0;
    let chunksCompleted = 0;

    try {
      for (let i = 0; i < texts.length; i += BATCH_CHUNK_SIZE) {
        const chunk = texts.slice(i, i + BATCH_CHUNK_SIZE);

        const batchResult = await withRetry(
          () =>
            model.batchEmbedContents({
              requests: chunk.map(
                (text) =>
                  ({
                    content: { parts: [{ text }], role: 'user' },
                    taskType: TaskType.RETRIEVAL_DOCUMENT,
                    outputDimensionality: DIMENSIONS,
                  }) as EmbedContentRequest,
              ),
            }),
          log,
          onAuthFailure,
        );

        chunksCompleted += 1;

        if (batchResult.embeddings.length !== chunk.length) {
          log.warn(
            {
              expected: chunk.length,
              got: batchResult.embeddings.length,
            },
            'embed: batch result count mismatch — some items may have been filtered',
          );
          throw new Error(`embedBatch: expected ${chunk.length} embeddings but got ${batchResult.embeddings.length}`);
        }

        for (let j = 0; j < chunk.length; j++) {
          const vector = new Float32Array(batchResult.embeddings[j].values);
          if (vector.length !== DIMENSIONS) {
            log.warn(
              { expected: DIMENSIONS, got: vector.length, model: MODEL_NAME, batchIndex: j },
              'embedBatch: unexpected vector dimensions',
            );
            throw new Error(`embedBatch: expected ${DIMENSIONS} dimensions but got ${vector.length}`);
          }
          results.push({ vector, dimensions: DIMENSIONS, model: MODEL_NAME });
          totalInputTokens += estimateTokens(chunk[j]);
        }
      }
    } catch (err) {
      dailyCount -= totalRequests - chunksCompleted; // Refund unused
      throw err;
    }

    await insertLlmUsage(pool, {
      id: ulid(),
      stage: 'embedding',
      model: MODEL_NAME,
      inputTokens: totalInputTokens,
      outputTokens: 0,
      costUsd: 0,
      createdAt: Date.now(),
    });

    return results;
  }

  function prepareText(text: string, type: 'item' | 'summary' | 'entity' | 'report'): string {
    let cleaned = stripDiscordFormatting(text);
    // Collapse multiple whitespace/newlines to single space
    cleaned = cleaned.replace(/\s+/g, ' ');
    // Truncate to ~512 tokens
    if (cleaned.length > MAX_CHARS) {
      cleaned = cleaned.slice(0, MAX_CHARS);
    }
    // Prefix with type for retrieval differentiation
    cleaned = `${type}: ${cleaned}`;
    return cleaned.trim();
  }

  function vectorToBytes(vector: Float32Array): Buffer {
    return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  }

  return {
    isAvailable,
    embed,
    embedBatch,
    prepareText,
    vectorToBytes,
    /** @internal — exposed for unit tests */
    getQuotaState,
  };
}
