import { ChunkSummaryLLMSchema } from './schemas.js';
import type { ChunkSummary } from './schemas.js';
import { budgetExhausted, escalationBudgetExhausted, type CallBudget } from './summarize-budget.js';
import { normalizeChunkSummaryCandidate, stripCodeFences } from './summarize.js';
import type { ClaimedItem, LLM } from './summarize.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';

type VerifyChunkSummary = (
  parsed: ChunkSummary,
  rawText: string,
  chunk: ClaimedItem[],
  log: Logger,
  source: string,
  sourceId: string,
) => ChunkSummary;

export function createEscalation(log: Logger, config: Config, llm: LLM, verifyChunkSummary: VerifyChunkSummary) {
  async function parseWithZodRetry(
    content: string,
    systemPrompt: string,
    wrappedContent: string,
    callBudget: CallBudget,
  ): Promise<ChunkSummary | null> {
    const jsonStr = stripCodeFences(content);

    let raw: unknown;
    try {
      raw = JSON.parse(jsonStr);
    } catch {
      return null;
    }

    const result = ChunkSummaryLLMSchema.safeParse(normalizeChunkSummaryCandidate(raw));
    if (result.success) {
      return result.data;
    }

    const errorPaths = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    log.warn({ errorPaths }, 'Zod validation failed, retrying with error feedback');

    const augmentedSystem = `${systemPrompt}\n\nYour previous response had validation errors: ${errorPaths}. Please fix these fields.`;

    if (budgetExhausted(callBudget, log)) return null;
    const retryResult = await llm.call({
      model: config.models.chunk,
      system: augmentedSystem,
      messages: [{ role: 'user', content: wrappedContent }],
      maxTokens: 3000,
      stage: 'summarize',
    });

    const retryJson = stripCodeFences(retryResult.content);

    try {
      const retryRaw: unknown = JSON.parse(retryJson);
      const retryParsed = ChunkSummaryLLMSchema.safeParse(normalizeChunkSummaryCandidate(retryRaw));
      if (retryParsed.success) {
        return retryParsed.data;
      }
      log.error({ errors: retryParsed.error.issues }, 'Zod retry also failed');
    } catch {
      log.error('Zod retry produced invalid JSON');
    }

    return null;
  }

  async function callAndParse(
    systemPrompt: string,
    userContent: string,
    callBudget: CallBudget,
  ): Promise<ChunkSummary | null> {
    const wrapped = llm.wrapWithNonce(userContent);

    if (budgetExhausted(callBudget, log)) return null;
    const result = await llm.call({
      model: config.models.chunk,
      system: systemPrompt,
      messages: [{ role: 'user', content: wrapped.wrapped }],
      maxTokens: 3000,
      stage: 'summarize',
    });

    const parsed = await parseWithZodRetry(result.content, systemPrompt, wrapped.wrapped, callBudget);
    if (parsed !== null) {
      return parsed;
    }

    log.warn('Parse failed, retrying with fresh prompt');
    const freshWrapped = llm.wrapWithNonce(userContent);
    if (budgetExhausted(callBudget, log)) return null;
    const retryResult = await llm.call({
      model: config.models.chunk,
      system: systemPrompt,
      messages: [{ role: 'user', content: freshWrapped.wrapped }],
      maxTokens: 3000,
      stage: 'summarize',
    });

    return parseWithZodRetry(retryResult.content, systemPrompt, freshWrapped.wrapped, callBudget);
  }

  async function maybeEscalate(
    parsed: ChunkSummary,
    systemPrompt: string,
    userContent: string,
    rawText: string,
    chunk: ClaimedItem[],
    source: string,
    sourceId: string,
    callBudget: CallBudget,
  ): Promise<ChunkSummary> {
    if (parsed.confidence >= 5 || parsed.urgency === 'routine') {
      return parsed;
    }

    if (escalationBudgetExhausted(callBudget, log)) {
      return parsed;
    }

    log.info(
      {
        confidence: parsed.confidence,
        urgency: parsed.urgency,
        source,
        sourceId,
        escalationNumber: callBudget.escalationCount + 1,
        maxEscalations: callBudget.maxEscalations,
      },
      'Low confidence non-routine chunk, escalating to Sonnet',
    );

    try {
      const wrapped = llm.wrapWithNonce(userContent);
      if (budgetExhausted(callBudget, log)) return parsed;
      callBudget.escalationCount++;
      const result = await llm.call({
        model: config.models.thinkalot,
        system: systemPrompt,
        messages: [{ role: 'user', content: wrapped.wrapped }],
        maxTokens: 3000,
        stage: 'escalate',
      });

      const escalated = await parseWithZodRetry(result.content, systemPrompt, wrapped.wrapped, callBudget);
      if (escalated !== null) {
        return verifyChunkSummary(escalated, rawText, chunk, log, source, sourceId);
      }
    } catch (err: unknown) {
      log.error({ err, source, sourceId }, 'Escalation to Sonnet failed');
    }

    return parsed;
  }

  return { parseWithZodRetry, callAndParse, maybeEscalate };
}
