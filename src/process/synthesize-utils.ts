import type { Logger } from '../logger.js';
import { getModelContextWindow, type LLMCallResult, type Stage } from '../llm.js';
import type { SummaryRow } from '../db/queries.js';
import { estimateTokens } from './chunk.js';
import type { MarketReport } from './schemas.js';
import type { ScoredSummary } from './synthesis-context.js';
import { safeParseReportResponse, type ParsedSummaryBody } from './synthesis-shared.js';
import { buildValidationRetrySystemPrompt } from './synthesize-prompts.js';

export const EVENT_CHAIN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
export const FIRST_MOVER_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const URGENCY_SCORES: Record<string, number> = {
  breaking: 3,
  elevated: 2,
  routine: 1,
};

const SYNTHESIS_CONTEXT_WINDOW_FALLBACK = 128_000;
const SYNTHESIS_TOKEN_SAFETY_BUFFER = 2_000;

/**
 * Compute midnight-to-midnight window (epoch ms) for today in the given timezone.
 * Uses Intl.DateTimeFormat for DST-safe offset computation (matches pulse module approach).
 */
export function getTodayWindow(timezone: string): { start: number; end: number; dateString: string } {
  const now = new Date();
  // Extract local date parts using Intl (DST-safe)
  const dtf = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  });
  const dateString = dtf.format(now); // YYYY-MM-DD

  // Compute offset by comparing UTC and local representations
  const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
  const localStr = now.toLocaleString('en-US', { timeZone: timezone });
  const offsetMs = new Date(localStr).getTime() - new Date(utcStr).getTime();

  // Midnight in target timezone
  const [year, month, day] = dateString.split('-').map(Number);
  const midnightUtc = Date.UTC(year, month - 1, day);
  const start = midnightUtc - offsetMs;
  const end = start + 24 * 60 * 60 * 1000;

  return { start, end, dateString };
}

export function scoreSummary(row: SummaryRow, parsed: ParsedSummaryBody): number {
  const urgencyScore = URGENCY_SCORES[row.urgency ?? 'routine'] ?? 1;
  const entityCount = parsed.entities.length;
  const engagement = row.item_count; // proxy for engagement
  return urgencyScore * 3 + entityCount * 2 + Math.log(1 + engagement);
}

export interface BudgetedSynthesisPrompt {
  summaries: ScoredSummary[];
  wrappedContent: string;
  estimatedInputTokens: number;
  inputBudget: number;
  contextWindow: number;
}

export function getSynthesisInputBudget(
  model: string,
  maxTokens: number,
): { contextWindow: number; inputBudget: number } {
  const contextWindow = getModelContextWindow(model) ?? SYNTHESIS_CONTEXT_WINDOW_FALLBACK;
  return {
    contextWindow,
    inputBudget: Math.max(0, contextWindow - maxTokens - SYNTHESIS_TOKEN_SAFETY_BUFFER),
  };
}

export function removeLowestScoredSummary(summaries: ScoredSummary[]): ScoredSummary[] {
  if (summaries.length === 0) return summaries;

  let lowestIndex = 0;
  for (let i = 1; i < summaries.length; i++) {
    if (summaries[i]!.score < summaries[lowestIndex]!.score) {
      lowestIndex = i;
    }
  }

  return summaries.filter((_, index) => index !== lowestIndex);
}

export function computeAvgSentiment(report: MarketReport): number | null {
  if (report.entitySentiment.length === 0) return null;
  const sum = report.entitySentiment.reduce((acc, e) => acc + e.sentiment, 0);
  return Math.round((sum / report.entitySentiment.length) * 100) / 100;
}

export function toLoggedError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export interface SynthLLM {
  call(params: {
    model: string;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    maxTokens: number;
    stage: Stage;
  }): Promise<LLMCallResult>;
  wrapWithNonce(content: string): { wrapped: string; nonce: string };
}

export function prepareBudgetedSynthesisPrompt(params: {
  llm: SynthLLM;
  log: Logger;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  label: string;
  summaries: ScoredSummary[];
  minSummaryCount: number;
  buildUserMessage: (summaries: ScoredSummary[]) => string;
}): BudgetedSynthesisPrompt | null {
  const { contextWindow, inputBudget } = getSynthesisInputBudget(params.model, params.maxTokens);
  let candidateSummaries = [...params.summaries];
  let trimmedCount = 0;

  const buildCandidate = (summaries: ScoredSummary[]): BudgetedSynthesisPrompt => {
    const { wrapped } = params.llm.wrapWithNonce(params.buildUserMessage(summaries));
    const estimatedInputTokens = estimateTokens(`${params.systemPrompt}\n${wrapped}`);
    return {
      summaries,
      wrappedContent: wrapped,
      estimatedInputTokens,
      inputBudget,
      contextWindow,
    };
  };

  let candidate = buildCandidate(candidateSummaries);
  const initialEstimatedInputTokens = candidate.estimatedInputTokens;
  while (candidate.estimatedInputTokens > inputBudget && candidateSummaries.length > params.minSummaryCount) {
    candidateSummaries = removeLowestScoredSummary(candidateSummaries);
    trimmedCount++;
    candidate = buildCandidate(candidateSummaries);
  }

  if (trimmedCount > 0 && candidate.estimatedInputTokens <= inputBudget) {
    params.log.warn(
      {
        contextWindow,
        inputBudget,
        maxTokens: params.maxTokens,
        initialEstimatedInputTokens,
        finalEstimatedInputTokens: candidate.estimatedInputTokens,
        initialSummaryCount: params.summaries.length,
        finalSummaryCount: candidate.summaries.length,
        trimmedSummaryCount: trimmedCount,
      },
      `${params.label} prompt exceeded estimated token budget, trimming summaries`,
    );
  }

  if (candidate.estimatedInputTokens > inputBudget) {
    params.log.warn(
      {
        contextWindow,
        inputBudget,
        maxTokens: params.maxTokens,
        initialEstimatedInputTokens,
        finalEstimatedInputTokens: candidate.estimatedInputTokens,
        initialSummaryCount: params.summaries.length,
        finalSummaryCount: candidate.summaries.length,
        trimmedSummaryCount: trimmedCount,
      },
      `${params.label} prompt still exceeds estimated token budget after trimming, aborting before LLM call`,
    );
    return null;
  }

  return candidate;
}

export async function callReportWithRetry(
  llm: SynthLLM,
  log: Logger,
  model: string,
  systemPrompt: string,
  wrappedContent: string,
  maxTokens: number,
  stage: Stage,
  label: string,
): Promise<MarketReport | null> {
  const firstResult = await llm.call({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: wrappedContent }],
    maxTokens,
    stage,
  });

  const firstParsed = safeParseReportResponse(firstResult.content);
  if (firstParsed.success) {
    return firstParsed.report;
  }

  const retrySystemPrompt =
    firstParsed.kind === 'schema' && firstParsed.errorPaths
      ? buildValidationRetrySystemPrompt(systemPrompt, firstParsed.errorPaths)
      : systemPrompt;

  if (firstParsed.kind === 'schema') {
    log.warn({ errorPaths: firstParsed.errorPaths }, `${label} validation failed, retrying with error feedback`);
  } else {
    log.warn(`${label} parse failed, retrying LLM call once`);
  }

  const retryResult = await llm.call({
    model,
    system: retrySystemPrompt,
    messages: [{ role: 'user', content: wrappedContent }],
    maxTokens,
    stage,
  });

  const retryParsed = safeParseReportResponse(retryResult.content);
  if (retryParsed.success) {
    return retryParsed.report;
  }

  if (retryParsed.kind === 'schema') {
    log.error({ errorPaths: retryParsed.errorPaths }, `${label} validation failed on retry, skipping report`);
  } else {
    log.error(`${label} parse failed on retry, skipping report`);
  }

  return null;
}
