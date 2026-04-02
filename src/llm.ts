import crypto from 'node:crypto';
import { complete, getModel } from '@mariozechner/pi-ai';
import type {
  Context,
  KnownProvider,
  Message,
  TextContent,
} from '@mariozechner/pi-ai';
import { ulid } from 'ulid';
import type { Config } from './config.js';
import type { Pool } from './db/connection.js';
import { insertLlmUsage } from './db/queries.js';
import type { Logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────

export type Stage =
  | 'summarize'
  | 'synthesize'
  | 'pre-summarize'
  | 'urgency-classify'
  | 'pulse'
  | 'chat'
  | 'translate'
  | 'escalate'
  | 'narrative-cluster'
  | 'entity-disambiguate';

export interface LLMCallParams {
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  stage: Stage;
}

export interface LLMCallResult {
  content: string;
  usage: { input_tokens: number; output_tokens: number };
  cost: number;
}

export class ContextLengthExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextLengthExceededError';
  }
}

export class LLMHaltedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMHaltedError';
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function parseModel(model: string): { provider: string; modelId: string } {
  const colonIdx = model.indexOf(':');
  if (colonIdx > 0) {
    return {
      provider: model.slice(0, colonIdx),
      modelId: model.slice(colonIdx + 1),
    };
  }
  return { provider: 'anthropic', modelId: model };
}

function extractHttpStatus(err: unknown): number | null {
  if (err instanceof Error) {
    const msg = err.message;
    const match = /\b(4\d{2}|5\d{2})\b/.exec(msg);
    if (match) return parseInt(match[1], 10);

    const record = err as unknown as Record<string, unknown>;
    if (typeof record['status'] === 'number') return record['status'];
    if (typeof record['statusCode'] === 'number')
      return record['statusCode'] as number;
  }
  return null;
}

function isContextLengthError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('context length') ||
      msg.includes('too many tokens') ||
      msg.includes('maximum context') ||
      msg.includes('token limit')
    );
  }
  return false;
}

function extractRetryAfter(err: unknown): number | null {
  if (err instanceof Error) {
    const record = err as unknown as Record<string, unknown>;
    if (typeof record['retryAfter'] === 'number')
      return record['retryAfter'] as number;

    const match = /retry.?after[:\s]+(\d+)/i.exec(err.message);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function toPiMessages(
  messages: { role: 'user' | 'assistant'; content: string }[],
): Message[] {
  return messages.map((m) => {
    const now = Date.now();
    if (m.role === 'user') {
      return {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: m.content }],
        timestamp: now,
      };
    }
    // Assistant messages: Pi expects full AssistantMessage shape.
    // We construct a minimal one — complete() only reads role + content.
    return {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: m.content }],
      api: 'anthropic-messages' as const,
      provider: 'anthropic',
      model: '',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop' as const,
      timestamp: now,
    };
  });
}

// ── Factory ────────────────────────────────────────────────────────────

export function createLLM(pool: Pool, log: Logger, _config: Config) {
  let halted = false;

  async function call(params: LLMCallParams): Promise<LLMCallResult> {
    if (halted) {
      throw new LLMHaltedError('LLM subsystem halted due to auth failure');
    }

    const { provider, modelId } = parseModel(params.model);
    const model = getModel(
      provider as KnownProvider,
      modelId as never,
    );

    const piMessages = toPiMessages(params.messages);
    const context: Context = {
      systemPrompt: params.system,
      messages: piMessages,
    };

    const MAX_RETRIES = 3;
    let emptyRetried = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await complete(model, context, {
          maxTokens: params.maxTokens,
        });

        // L8: error stopReason with refusal-like message
        if (response.stopReason === 'error' && response.errorMessage) {
          const errMsg = response.errorMessage.toLowerCase();
          if (errMsg.includes('refus') || errMsg.includes('content_filter')) {
            log.error(
              {
                stage: params.stage,
                stopReason: response.stopReason,
                errorMessage: response.errorMessage,
              },
              'LLM refused to respond',
            );
            throw new Error(
              `LLM refused to respond: ${response.errorMessage}`,
            );
          }
        }

        // Extract text
        const text = response.content
          .filter((c): c is TextContent => c.type === 'text')
          .map((c) => c.text)
          .join('');

        // L7: empty content — retry once
        if (!text.trim() && !emptyRetried) {
          emptyRetried = true;
          log.warn(
            { stage: params.stage, attempt },
            'Empty LLM response, retrying once',
          );
          continue;
        }

        // Log usage to DB
        const usage = {
          input_tokens: response.usage.input,
          output_tokens: response.usage.output,
        };
        const cost = response.usage.cost.total;

        await insertLlmUsage(pool, {
          id: ulid(),
          stage: params.stage,
          model: params.model,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          costUsd: cost,
          createdAt: Date.now(),
        }).catch((dbErr: unknown) => {
          log.error({ err: dbErr }, 'Failed to log LLM usage');
        });

        return { content: text, usage, cost };
      } catch (err: unknown) {
        // If it's already one of our typed errors, rethrow
        if (
          err instanceof ContextLengthExceededError ||
          err instanceof LLMHaltedError
        ) {
          throw err;
        }

        // L1: context length exceeded
        if (isContextLengthError(err)) {
          throw new ContextLengthExceededError(
            err instanceof Error ? err.message : 'Context length exceeded',
          );
        }

        const status = extractHttpStatus(err);

        // L3: 401 — halt everything
        if (status === 401) {
          halted = true;
          log.fatal(
            { stage: params.stage },
            'LLM auth failure (401) — halting all LLM calls',
          );
          throw new LLMHaltedError('Authentication failed (401)');
        }

        // L2: 400 other — no retry
        if (status === 400) {
          log.error(
            { stage: params.stage, err },
            'LLM bad request (400), not retrying',
          );
          throw err;
        }

        // L4: 429 — rate limited
        if (status === 429) {
          const retryAfter = extractRetryAfter(err) ?? 60;
          log.warn(
            { stage: params.stage, retryAfter, attempt },
            'LLM rate limited (429), waiting',
          );
          await sleep(retryAfter * 1000);
          continue;
        }

        // L5: 529 — overloaded
        if (status === 529) {
          if (attempt >= MAX_RETRIES) {
            log.error(
              { stage: params.stage },
              'LLM overloaded (529), exhausted retries',
            );
            throw err;
          }
          log.warn(
            { stage: params.stage, attempt },
            'LLM overloaded (529), backing off 30s',
          );
          await sleep(30_000);
          continue;
        }

        // L6: 500/502/503 — exponential backoff
        if (status === 500 || status === 502 || status === 503) {
          if (attempt >= MAX_RETRIES) {
            log.error(
              { stage: params.stage, status },
              'LLM server error, exhausted retries',
            );
            throw err;
          }
          const backoffMs = 2000 * Math.pow(4, attempt); // 2s, 8s, 32s
          log.warn(
            { stage: params.stage, status, backoffMs, attempt },
            'LLM server error, backing off',
          );
          await sleep(backoffMs);
          continue;
        }

        // L8: refusal string in error
        if (err instanceof Error && /refus/i.test(err.message)) {
          log.error(
            { stage: params.stage },
            'LLM refused to respond (error)',
          );
          throw err;
        }

        // Unknown error — don't retry
        log.error(
          { stage: params.stage, err, attempt },
          'LLM unknown error, not retrying',
        );
        throw err;
      }
    }

    // Should not reach here, but if loop exits without return/throw
    throw new Error('LLM call failed: exhausted all retries');
  }

  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  function sanitizeForPrompt(content: string): string {
    let s = content;
    // Strip zero-width chars: U+200B-U+200D, U+FEFF, U+2060
    s = s.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '');
    // Strip RTL/LTR overrides: U+202A-U+202E, U+2066-U+2069
    s = s.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
    // NFKC normalize
    s = s.normalize('NFKC');
    // Escape angle brackets
    s = s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return s;
  }

  function wrapWithNonce(content: string): { wrapped: string; nonce: string } {
    const nonce = crypto.randomBytes(4).toString('hex');
    const sanitized = sanitizeForPrompt(content);
    const wrapped = `<scraped_content_${nonce}>${sanitized}</scraped_content_${nonce}>`;
    return { wrapped, nonce };
  }

  function getBudgetHint(estimatedTokens: number, budget: number): string {
    if (estimatedTokens < budget * 0.3) {
      return 'Be very concise — this is a sparse batch.';
    }
    if (estimatedTokens < budget * 0.6) {
      return 'Be concise.';
    }
    return '';
  }

  return {
    call,
    estimateTokens,
    sanitizeForPrompt,
    wrapWithNonce,
    getBudgetHint,
  };
}
