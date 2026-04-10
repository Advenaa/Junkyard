import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { complete, getApiProvider, getModel, getModels, getProviders } from '@mariozechner/pi-ai';
import { refreshOpenAICodexToken } from '@mariozechner/pi-ai/oauth';
import type { Context, KnownProvider, Message, TextContent } from '@mariozechner/pi-ai';
import { distance } from 'fastest-levenshtein';
import { ulid } from 'ulid';
import type { Config } from './config.js';
import type { Pool } from './db/connection.js';
import { insertLlmUsage } from './db/queries.js';
import type { Logger } from './logger.js';

// ── OAuth Codex credentials ──────────────────────────────────────────

interface CodexCredentials {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

const OAUTH_FILE = '.oauth-codex.json';
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

let _codexCreds: CodexCredentials | null = null;

function loadCodexCredentials(): CodexCredentials | null {
  if (_codexCreds) return _codexCreds;
  try {
    const raw = readFileSync(OAUTH_FILE, 'utf-8');
    _codexCreds = JSON.parse(raw) as CodexCredentials;
    return _codexCreds;
  } catch {
    return null;
  }
}

async function getCodexApiKey(log: Logger): Promise<string | undefined> {
  const creds = loadCodexCredentials();
  if (!creds) return undefined;

  if (Date.now() < creds.expires - REFRESH_BUFFER_MS) {
    return creds.access;
  }

  // Token expired or about to expire — refresh
  try {
    log.info('Refreshing OpenAI Codex OAuth token...');
    const refreshed = await refreshOpenAICodexToken(creds.refresh);
    _codexCreds = refreshed as CodexCredentials;
    writeFileSync(OAUTH_FILE, JSON.stringify(refreshed, null, 2));
    log.info('OpenAI Codex OAuth token refreshed');
    return refreshed.access;
  } catch (err) {
    log.error({ err }, 'Failed to refresh OpenAI Codex token — re-login required');
    return creds.access; // try stale token as last resort
  }
}

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
  | 'event-link'
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
  'event-link': 0.1,
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const AUTH_FAILURE_COOLDOWN_MS = 30 * 60 * 1000;
const TRANSIENT_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

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

function suggestClosestModelId(modelId: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;

  let closest = candidates[0]!;
  let closestDistance = distance(modelId, closest);

  for (const candidate of candidates.slice(1)) {
    const candidateDistance = distance(modelId, candidate);
    if (candidateDistance < closestDistance) {
      closest = candidate;
      closestDistance = candidateDistance;
    }
  }

  const maxSuggestionDistance = Math.max(4, Math.ceil(modelId.length * 0.35));
  return closestDistance <= maxSuggestionDistance ? closest : null;
}

function validateConfiguredModel(model: string, name: string): void {
  const { provider, modelId } = parseModel(model);
  const providerModels = getModels(provider as KnownProvider);

  if (providerModels.length === 0) {
    const knownProviders = getProviders().sort().join(', ');
    throw new Error(`${name} "${model}" uses unknown provider "${provider}". Known providers: ${knownProviders}`);
  }

  const resolvedModel = getModel(provider as KnownProvider, modelId as never);
  if (!resolvedModel) {
    const suggestion = suggestClosestModelId(
      modelId,
      providerModels.map((candidate) => candidate.id),
    );
    const hint = suggestion
      ? ` Did you mean "${provider}:${suggestion}"?`
      : ` Example ${provider} models: ${providerModels
          .slice(0, 5)
          .map((candidate) => candidate.id)
          .join(', ')}`;
    throw new Error(`${name} "${model}" is not available in pi-ai for provider "${provider}".${hint}`);
  }

  if (!resolvedModel.api || !getApiProvider(resolvedModel.api)) {
    throw new Error(`${name} "${model}" resolved to an unavailable API backend "${resolvedModel.api ?? 'unknown'}"`);
  }
}

export function validateConfiguredModels(config: Pick<Config, 'models'>): void {
  validateConfiguredModel(config.models.normalizer, 'NORMALIZER_MODEL');
  validateConfiguredModel(config.models.chunk, 'CHUNK_MODEL');
  validateConfiguredModel(config.models.thinkalot, 'THINKALOT_MODEL');
  if (config.models.normalizerFallback) {
    validateConfiguredModel(config.models.normalizerFallback, 'NORMALIZER_MODEL_FALLBACK');
  }
  if (config.models.chunkFallback) {
    validateConfiguredModel(config.models.chunkFallback, 'CHUNK_MODEL_FALLBACK');
  }
  if (config.models.thinkalotFallback) {
    validateConfiguredModel(config.models.thinkalotFallback, 'THINKALOT_MODEL_FALLBACK');
  }
}

export function extractHttpStatus(err: unknown): number | null {
  if (err instanceof Error) {
    // Check structured properties first — more reliable than regex
    const record = err as unknown as Record<string, unknown>;
    if (typeof record['status'] === 'number') return record['status'];
    if (typeof record['statusCode'] === 'number') return record['statusCode'] as number;

    // Fallback: extract from message, rejecting word-char suffixes
    // like "432ms" or "500MB"
    const msg = err.message;
    const match = /\b(4\d{2}|5\d{2})(?!\w)/.exec(msg);
    if (match) return parseInt(match[1], 10);
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
    if (typeof record['retryAfter'] === 'number') return record['retryAfter'] as number;

    const match = /retry.?after[:\s]+(\d+)/i.exec(err.message);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function toPiMessages(messages: { role: 'user' | 'assistant'; content: string }[]): Message[] {
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
  const _sleep = _testOverrides?.sleepFn ?? sleep;
  const _complete = _testOverrides?.completeFn ?? complete;
  const providerAuthCircuitOpenUntil = new Map<string, number>();
  const providerFailureCircuitOpenUntil = new Map<string, number>();

  function isProviderAuthCircuitOpen(provider: string, now = Date.now()): boolean {
    const openUntil = providerAuthCircuitOpenUntil.get(provider);
    if (openUntil == null) return false;
    if (now >= openUntil) {
      providerAuthCircuitOpenUntil.delete(provider);
      log.info({ provider }, 'LLM auth circuit cooldown elapsed; provider restored');
      return false;
    }
    return true;
  }

  function openProviderAuthCircuit(provider: string, now = Date.now()): void {
    providerAuthCircuitOpenUntil.set(provider, now + AUTH_FAILURE_COOLDOWN_MS);
  }

  function isProviderFailureCircuitOpen(provider: string, now = Date.now()): boolean {
    const openUntil = providerFailureCircuitOpenUntil.get(provider);
    if (openUntil == null) return false;
    if (now >= openUntil) {
      providerFailureCircuitOpenUntil.delete(provider);
      log.info({ provider }, 'LLM transient failure circuit cooldown elapsed; provider restored');
      return false;
    }
    return true;
  }

  function openProviderFailureCircuit(provider: string, now = Date.now()): void {
    providerFailureCircuitOpenUntil.set(provider, now + TRANSIENT_FAILURE_COOLDOWN_MS);
  }

  function getConfiguredFallbackModels(requestedModel: string): string[] {
    const configuredModels = [_config.models?.normalizer, _config.models?.chunk, _config.models?.thinkalot].filter(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
    );

    return [...new Set(configuredModels)].filter((candidate) => candidate !== requestedModel);
  }

  function findFallbackModel(requestedModel: string, authFailedModels: ReadonlySet<string>): string | null {
    const { provider: requestedProvider } = parseModel(requestedModel);

    for (const candidate of getConfiguredFallbackModels(requestedModel)) {
      if (authFailedModels.has(candidate)) continue;

      const { provider: candidateProvider } = parseModel(candidate);
      if (candidateProvider === requestedProvider) continue;
      if (isProviderAuthCircuitOpen(candidateProvider)) continue;
      if (isProviderFailureCircuitOpen(candidateProvider)) continue;

      return candidate;
    }

    return null;
  }

  function resolveModelForAttempt(
    requestedModel: string,
    authFailedModels: ReadonlySet<string>,
  ): { modelName: string; fallbackFrom: string | null; fallbackReason: 'auth' | 'failure' | null } {
    const { provider: requestedProvider } = parseModel(requestedModel);

    const authCircuitOpen = isProviderAuthCircuitOpen(requestedProvider) || authFailedModels.has(requestedModel);
    const failureCircuitOpen = isProviderFailureCircuitOpen(requestedProvider);

    if (!authCircuitOpen && !failureCircuitOpen) {
      return { modelName: requestedModel, fallbackFrom: null, fallbackReason: null };
    }

    const fallbackModel = findFallbackModel(requestedModel, authFailedModels);
    if (fallbackModel) {
      return {
        modelName: fallbackModel,
        fallbackFrom: requestedModel,
        fallbackReason: authCircuitOpen ? 'auth' : 'failure',
      };
    }

    if (authCircuitOpen) {
      throw new LLMHaltedError(
        `LLM provider "${requestedProvider}" temporarily halted after authentication failures (401)`,
      );
    }

    throw new LLMHaltedError(`LLM provider "${requestedProvider}" temporarily unavailable after repeated failures`);
  }

  async function call(params: LLMCallParams): Promise<LLMCallResult> {
    const piMessages = toPiMessages(params.messages);
    const context: Context = {
      systemPrompt: params.system,
      messages: piMessages,
    };

    const MAX_RETRIES = 3;
    let retryAttempt = 0;
    let emptyRetried = false;
    const authFailedModels = new Set<string>();

    while (retryAttempt <= MAX_RETRIES) {
      const { modelName, fallbackFrom, fallbackReason } = resolveModelForAttempt(params.model, authFailedModels);
      const { provider, modelId } = parseModel(modelName);
      const model = getModel(provider as KnownProvider, modelId as never);

      if (fallbackFrom) {
        log.warn(
          { stage: params.stage, requestedModel: fallbackFrom, fallbackModel: modelName, reason: fallbackReason },
          'LLM provider circuit open, failing over to alternate configured model',
        );
      }

      try {
        // openai-codex-responses rejects the `temperature` parameter for the gpt-5.4 family
        // with {"detail":"Unsupported parameter: temperature"}. Omit it for that provider.
        const isCodexProvider = provider === 'openai-codex';
        const effectiveTemperature = params.temperature ?? STAGE_TEMPERATURES[params.stage] ?? 0.5;
        const codexKey = isCodexProvider ? await getCodexApiKey(log) : undefined;
        const response = await (_complete as typeof complete)(model, context, {
          maxTokens: params.maxTokens,
          ...(isCodexProvider ? {} : { temperature: effectiveTemperature }),
          ...(codexKey ? { apiKey: codexKey } : {}),
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
            throw new Error(`LLM refused to respond: ${response.errorMessage}`);
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
          log.warn({ stage: params.stage, attempt: retryAttempt }, 'Empty LLM response, retrying once');
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
          model: modelName,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          costUsd: cost,
          createdAt: Date.now(),
        }).catch((dbErr: unknown) => {
          log.error({ err: dbErr }, 'Failed to log LLM usage');
        });

        providerFailureCircuitOpenUntil.delete(provider);
        return { content: text, usage, cost };
      } catch (err: unknown) {
        // If it's already one of our typed errors, rethrow
        if (err instanceof ContextLengthExceededError || err instanceof LLMHaltedError) {
          throw err;
        }

        // L1: context length exceeded
        if (isContextLengthError(err)) {
          throw new ContextLengthExceededError(err instanceof Error ? err.message : 'Context length exceeded');
        }

        const status = extractHttpStatus(err);

        // L3: 401 — open a provider-scoped auth circuit and fail over if possible
        if (status === 401) {
          authFailedModels.add(modelName);
          openProviderAuthCircuit(provider);
          log.fatal(
            { stage: params.stage, provider, model: modelName },
            'LLM auth failure (401) — opening provider auth circuit',
          );

          if (findFallbackModel(params.model, authFailedModels)) {
            continue;
          }

          throw new LLMHaltedError(`LLM provider "${provider}" temporarily halted after authentication failures (401)`);
        }

        // L2: 400 other — no retry
        if (status === 400) {
          log.error({ stage: params.stage, err }, 'LLM bad request (400), not retrying');
          throw err;
        }

        // L4: 429 — rate limited
        if (status === 429) {
          if (retryAttempt >= MAX_RETRIES) {
            log.error({ stage: params.stage }, 'LLM rate limited (429), exhausted retries');
            openProviderFailureCircuit(provider);
            if (findFallbackModel(params.model, authFailedModels)) {
              retryAttempt = 0;
              emptyRetried = false;
              continue;
            }
            throw err;
          }
          const retryAfter = extractRetryAfter(err) ?? 60;
          const delayMs = retryAfter * 1000 + Math.random() * retryAfter * 500;
          log.warn(
            { stage: params.stage, retryAfter, delayMs: Math.round(delayMs), attempt: retryAttempt },
            'LLM rate limited (429), waiting',
          );
          await _sleep(delayMs);
          retryAttempt++;
          continue;
        }

        // L5: 529 — overloaded
        if (status === 529) {
          if (retryAttempt >= MAX_RETRIES) {
            log.error({ stage: params.stage }, 'LLM overloaded (529), exhausted retries');
            openProviderFailureCircuit(provider);
            if (findFallbackModel(params.model, authFailedModels)) {
              retryAttempt = 0;
              emptyRetried = false;
              continue;
            }
            throw err;
          }
          const overloadDelayMs = 30_000 + Math.random() * 15_000;
          log.warn(
            { stage: params.stage, delayMs: Math.round(overloadDelayMs), attempt: retryAttempt },
            'LLM overloaded (529), backing off',
          );
          await _sleep(overloadDelayMs);
          retryAttempt++;
          continue;
        }

        // L6: 500/502/503 — exponential backoff
        if (status === 500 || status === 502 || status === 503) {
          if (retryAttempt >= MAX_RETRIES) {
            log.error({ stage: params.stage, status }, 'LLM server error, exhausted retries');
            openProviderFailureCircuit(provider);
            if (findFallbackModel(params.model, authFailedModels)) {
              retryAttempt = 0;
              emptyRetried = false;
              continue;
            }
            throw err;
          }
          const baseBackoffMs = 2000 * Math.pow(2, retryAttempt); // 2s, 4s, 8s
          const backoffMs = baseBackoffMs * (0.5 + Math.random());
          log.warn(
            { stage: params.stage, status, backoffMs: Math.round(backoffMs), attempt: retryAttempt },
            'LLM server error, backing off',
          );
          await _sleep(backoffMs);
          retryAttempt++;
          continue;
        }

        // L8: refusal string in error
        if (err instanceof Error && /refus/i.test(err.message)) {
          log.error({ stage: params.stage }, 'LLM refused to respond (error)');
          throw err;
        }

        // Retry on timeout errors (LM-008)
        if (
          err instanceof Error &&
          (('code' in err && (err as { code: string }).code === 'ETIMEDOUT') ||
            err.name === 'AbortError' ||
            err.message.toLowerCase().includes('timeout') ||
            err.message.toLowerCase().includes('aborted'))
        ) {
          if (retryAttempt < MAX_RETRIES) {
            log.warn({ err, attempt: retryAttempt, stage: params.stage }, 'LLM call timed out, retrying');
            await _sleep(2000 * Math.pow(2, retryAttempt));
            retryAttempt++;
            continue;
          }
          openProviderFailureCircuit(provider);
          if (findFallbackModel(params.model, authFailedModels)) {
            retryAttempt = 0;
            emptyRetried = false;
            continue;
          }
          throw err;
        }

        // Unknown error — don't retry
        log.error({ stage: params.stage, err, attempt: retryAttempt }, 'LLM unknown error, not retrying');
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
    // Escape ampersands first (so pre-existing &lt; becomes &amp;lt;),
    // then angle brackets
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
