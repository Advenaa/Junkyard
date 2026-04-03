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

/** Stage-based default temperatures. Lower = more deterministic. */
const STAGE_TEMPERATURES: Record<string, number> = {
  summarize: 0.2,
  'pre-summarize': 0.2,
  synthesize: 0.5,
  pulse: 0.5,
  chat: 0.7,
  translate: 0.1,
  escalate: 0.3,
  'urgency-classify': 0.2,
  'narrative-cluster': 0.3,
  'entity-disambiguate': 0.2,
};

export interface LLMCallParams {
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  stage: Stage;
  temperature?: number;
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

export function parseModel(model: string): { provider: string; modelId: string } {
  const colonIdx = model.indexOf(':');
  if (colonIdx > 0) {
    return {
      provider: model.slice(0, colonIdx),
      modelId: model.slice(colonIdx + 1),
    };
  }
  return { provider: 'anthropic', modelId: model };
}

export function extractHttpStatus(err: unknown): number | null {
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

export function isContextLengthError(err: unknown): boolean {
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

export function extractRetryAfter(err: unknown): number | null {
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

/** Optional overrides for testing — never use in production. */
export interface LLMTestOverrides {
  /** Replace the complete() call with a mock function. */
  completeFn?: (model: unknown, context: unknown, opts: unknown) => Promise<unknown>;
  /** Replace the sleep() call with a mock (avoids real delays in tests). */
  sleepFn?: (ms: number) => Promise<void>;
}

export function createLLM(pool: Pool, log: Logger, _config: Config, _testOverrides?: LLMTestOverrides) {
  let halted = false;
  const _sleep = _testOverrides?.sleepFn ?? sleep;
  const _complete = _testOverrides?.completeFn ?? complete;

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
        const effectiveTemperature = params.temperature ?? STAGE_TEMPERATURES[params.stage] ?? 0.5;
        const response = await (_complete as typeof complete)(model, context, {
          maxTokens: params.maxTokens,
          temperature: effectiveTemperature,
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
        const cost = response.usage?.cost?.total ?? 0;

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
          if (attempt >= MAX_RETRIES) {
            log.error(
              { stage: params.stage },
              'LLM rate limited (429), exhausted retries',
            );
            throw err;
          }
          const retryAfter = extractRetryAfter(err) ?? 60;
          const delayMs = retryAfter * 1000 * (0.5 + Math.random());
          log.warn(
            { stage: params.stage, retryAfter, delayMs: Math.round(delayMs), attempt },
            'LLM rate limited (429), waiting',
          );
          await _sleep(delayMs);
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
          const overloadDelayMs = 30_000 * (0.5 + Math.random());
          log.warn(
            { stage: params.stage, delayMs: Math.round(overloadDelayMs), attempt },
            'LLM overloaded (529), backing off',
          );
          await _sleep(overloadDelayMs);
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
          const baseBackoffMs = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s
          const backoffMs = baseBackoffMs * (0.5 + Math.random());
          log.warn(
            { stage: params.stage, status, backoffMs: Math.round(backoffMs), attempt },
            'LLM server error, backing off',
          );
          await _sleep(backoffMs);
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

        // Retry on timeout errors (LM-008)
        if (err instanceof Error && (
          ('code' in err && (err as { code: string }).code === 'ETIMEDOUT') ||
          err.name === 'AbortError' ||
          err.message.toLowerCase().includes('timeout') ||
          err.message.toLowerCase().includes('aborted')
        )) {
          if (attempt < MAX_RETRIES) {
            log.warn({ err, attempt, stage: params.stage }, 'LLM call timed out, retrying');
            await _sleep(2000 * Math.pow(2, attempt));
            continue;
          }
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
    const nonce = crypto.randomBytes(8).toString('hex');
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
