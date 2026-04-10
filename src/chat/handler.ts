import { franc } from 'franc';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';
import type { VectorCache } from '../vector-cache.js';
import type { LLMCallParams, LLMCallResult } from '../llm.js';
import { refundChatDailyTokens, reserveChatDailyTokens } from '../db/queries.js';
import { createConversationManager } from './conversations.js';
import { createChatTools } from './tools.js';
import type { ChatTool, Embedder, LLM as ToolLLM } from './tools.js';

// ── Types ──────────────────────────────────────────────────────────────

interface ChatLLM extends ToolLLM {
  call(params: LLMCallParams): Promise<LLMCallResult>;
  wrapWithNonce(content: string): { wrapped: string; nonce: string };
}

interface ChatResult {
  response: string;
  toolsUsed: string[];
  sources: ChatSource[];
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface ChatSource {
  type: 'report' | 'summary' | 'item';
  id: string;
  label: string;
  snippet: string;
  dateLabel?: string;
  chainRootId?: string;
  chainLabel?: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 5;
const MAX_TOOL_RESULT_CHARS = 2000;
const MAX_TOTAL_TOOL_RESULT_CHARS = 30_000;
const MAX_DAILY_TOKENS_PER_USER = 100_000; // ~$1.50/day/user at Sonnet pricing
const CHAT_RESPONSE_TOKEN_RESERVATION = 5_120;
const TRANSLATION_TOKEN_RESERVATION = 1_280;

const SYSTEM_PROMPT = `You are Podders, a market intelligence assistant for crypto and Indonesian macro markets. Answer questions using ONLY the data retrieved by your tools. If you don't have data on a topic, say so — never speculate.

Available tools:
- semantic_search(query, type?): Search summaries/reports by meaning
- keyword_search(entity): Look up entity mentions, sentiment, history, and active event chains
- read_raw(itemId): Read the original source message

Always cite your sources. If a user asks about an entity, use keyword_search first, then semantic_search for context.
If the user asks about an ongoing story, timeline, chain of events, exploit follow-up, governance response, or what changed over time, prefer semantic_search with type="report" after keyword_search so you retrieve synthesized report context instead of only raw summary fragments.
Use semantic_search with type="summary" when you need narrower chunk-level detail, and use read_raw only when the original message text is necessary.`;

const TOOL_DEFINITIONS = [
  {
    name: 'semantic_search',
    description:
      'Search summaries and reports by semantic similarity. Use report mode for synthesized chain-aware context.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        type: {
          type: 'string',
          enum: ['summary', 'report'],
          description: 'Type of content to search (default: summary). Use report for synthesized report-level context.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'keyword_search',
    description: 'Look up an entity by name/alias for mentions, sentiment, history, and recent event chains.',
    parameters: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'The entity name or alias' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'read_raw',
    description: 'Read the original raw source message by item ID.',
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'string', description: 'The item ID to read' },
      },
      required: ['itemId'],
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────

function parseToolCalls(content: string): ToolCall[] {
  // Parse tool calls from LLM response — expects JSON blocks
  const calls: ToolCall[] = [];
  const regex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as { name: string; args: Record<string, unknown> };
      if (parsed.name && typeof parsed.name === 'string') {
        calls.push({
          name: parsed.name,
          args: (parsed.args as Record<string, unknown>) ?? {},
        });
      }
    } catch {
      // Skip malformed tool calls
    }
  }

  return calls;
}

function truncateToolResult(result: string, limit: number): string {
  if (result.length <= limit) return result;
  return result.slice(0, limit) + '\n...[truncated]';
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function currentBudgetDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractWrappedToolPayload(wrapped: string, nonce: string): string {
  const openTag = `<scraped_content_${nonce}>`;
  const closeTag = `</scraped_content_${nonce}>`;
  if (!wrapped.startsWith(openTag) || !wrapped.endsWith(closeTag)) {
    return wrapped;
  }
  return wrapped.slice(openTag.length, wrapped.length - closeTag.length);
}

function buildToolResultMessage(llm: ChatLLM, toolName: string, result: string): string {
  // Frame the entire tool payload as untrusted data so a malicious tool name or result
  // cannot break out of the tool-result wrapper and inject follow-up instructions.
  const { wrapped, nonce } = llm.wrapWithNonce(`Tool: ${toolName}\n${result}`);
  const payload = extractWrappedToolPayload(wrapped, nonce);
  return `<tool_result_${nonce}>\n${payload}\n</tool_result_${nonce}>`;
}

function formatToolUsageLabel(tool: ChatTool, args: Record<string, unknown>): string {
  return tool.formatUsage?.(args) ?? tool.name;
}

function truncateSnippet(text: string, max = 140): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 3) + '...';
}

function buildCitationLabel(type: 'report' | 'summary', id: string, rawSnippet: string): string {
  if (type === 'report') {
    const match = rawSnippet.match(/^Type:\s+([a-z]+)\s+\|\s+Date:\s+([0-9-]+)/i);
    if (match) {
      const reportType = match[1][0]!.toUpperCase() + match[1].slice(1).toLowerCase();
      return `${reportType} ${match[2]}`;
    }
    return `Report ${id.slice(0, 8)}`;
  }

  return `Summary ${id.slice(0, 8)}`;
}

interface ChainCitationMetadata {
  rootId: string;
  label?: string;
}

function toTitleCase(value: string): string {
  return value
    .split(/[_-\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function extractChainMetadata(rawSnippet: string): ChainCitationMetadata | null {
  const line = rawSnippet.match(/^Focused (?:report|summary) chain:\s+([^\n]+)/im)?.[1];
  if (!line) return null;

  const fields = new Map<string, string>();
  for (const segment of line.split('|')) {
    const [rawKey, ...rawValue] = segment.split('=');
    const key = rawKey?.trim();
    const value = rawValue.join('=').trim();
    if (key && value) {
      fields.set(key, value);
    }
  }

  const rootId = fields.get('chainRoot');
  if (!rootId) return null;

  const entity = fields.get('entity');
  const eventType = fields.get('eventType');
  const labelParts = [entity, eventType ? toTitleCase(eventType) : null].filter(
    (part): part is string => !!part && part.length > 0,
  );

  return {
    rootId,
    label: labelParts.length > 0 ? labelParts.join(' · ') : undefined,
  };
}

function stripCitationMetadata(rawSnippet: string): string {
  return rawSnippet.replace(/^Focused (?:report|summary) chain:.*(?:\n|$)/gim, '').trim();
}

function extractReadRawSources(toolResult: string): ChatSource[] {
  const match = toolResult.match(
    /^Item\s+(\S+)\s+by\s+(.+?)\s+at\s+(.+?):\n<raw_content_[0-9a-f]{8}>([\s\S]*?)<\/raw_content_[0-9a-f]{8}>$/,
  );
  if (!match) return [];

  const [, id, _author, _timestamp, rawContent] = match;
  const snippet = truncateSnippet(rawContent ?? '');
  if (!id || !snippet) return [];

  return [
    {
      type: 'item',
      id,
      label: `Item ${id.slice(0, 8)}`,
      snippet,
    },
  ];
}

function extractSemanticSearchSources(usageLabel: string, toolResult: string): ChatSource[] {
  const type: 'report' | 'summary' = usageLabel === 'semantic_search:report' ? 'report' : 'summary';
  const sources: ChatSource[] = [];
  const blockRegex = /\[([^\]]+)\] \(([^)]*)\)\n<search_result_[0-9a-f]{8}>([\s\S]*?)<\/search_result_[0-9a-f]{8}>/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(toolResult)) !== null) {
    const id = match[1]?.trim();
    const metadata = match[2] ?? '';
    const rawSnippet = match[3] ?? '';
    const cleanedSnippet = stripCitationMetadata(rawSnippet);
    const snippet = truncateSnippet(cleanedSnippet);
    if (!id || !snippet) continue;
    const source: ChatSource = {
      type,
      id,
      label: buildCitationLabel(type, id, cleanedSnippet),
      snippet,
    };
    const dateLabel = metadata.match(/(?:^|,\s*)date:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i)?.[1];
    if (dateLabel) {
      source.dateLabel = dateLabel;
    }
    if (type === 'report' || type === 'summary') {
      const chainMetadata = extractChainMetadata(rawSnippet);
      if (chainMetadata) {
        source.chainRootId = chainMetadata.rootId;
        if (chainMetadata.label) {
          source.chainLabel = chainMetadata.label;
        }
      }
    }
    sources.push(source);
  }

  return sources;
}

function extractSourcesFromToolResult(usageLabel: string, toolResult: string): ChatSource[] {
  if (usageLabel.startsWith('semantic_search:')) {
    return extractSemanticSearchSources(usageLabel, toolResult);
  }
  if (usageLabel === 'read_raw') {
    return extractReadRawSources(toolResult);
  }
  return [];
}

// ── Factory ───────────────────────────────────────────────────────────

export function createChatHandler(
  pool: Pool,
  log: Logger,
  config: Config,
  llm: ChatLLM,
  vectorCache: VectorCache,
  embedder: Embedder,
) {
  const conversations = createConversationManager();
  const tools = createChatTools(pool, log, vectorCache, embedder, llm);

  const toolMap = new Map<string, ChatTool>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  async function reserveTrackedTokens(userId: string, tokens: number): Promise<'ok' | 'limit' | 'error'> {
    if (tokens <= 0) return 'ok';

    try {
      const reservation = await reserveChatDailyTokens(
        pool,
        userId,
        currentBudgetDay(),
        tokens,
        MAX_DAILY_TOKENS_PER_USER,
        Date.now(),
      );
      return reservation.allowed ? 'ok' : 'limit';
    } catch (err: unknown) {
      log.error({ err, userId, tokens }, 'chat: failed to reserve daily token budget');
      return 'error';
    }
  }

  async function refundTrackedTokens(userId: string, tokens: number): Promise<void> {
    if (tokens <= 0) return;

    try {
      await refundChatDailyTokens(pool, userId, currentBudgetDay(), tokens, Date.now());
    } catch (err: unknown) {
      log.warn({ err, userId, tokens }, 'chat: failed to refund daily token budget');
    }
  }

  function budgetExceededResult(): ChatResult {
    return {
      response: 'You have reached your daily query limit. Your budget resets at midnight UTC. Please try again later.',
      toolsUsed: [],
      sources: [],
    };
  }

  // Periodic cleanup of idle conversations
  const cleanupInterval = setInterval(() => {
    conversations.cleanup();
  }, 600_000); // every 10 minutes

  // Allow cleanup interval to not block process exit
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  async function handle(query: string, conversationId: string, userId: string): Promise<ChatResult> {
    // When the budget is exhausted, tell the user it resets at midnight UTC.
    if (query.length > 4000) {
      return { response: 'Query is too long. Please keep it under 4000 characters.', toolsUsed: [], sources: [] };
    }

    const toolsUsed: string[] = [];
    const toolUsageLabels: string[] = [];
    const sources = new Map<string, ChatSource>();
    let processedQuery = query;
    let queryWrapped = false; // CH-020: track whether processedQuery has nonce wrapping

    // Step 1: Indonesian detection and translation
    const detectedLang = franc(query, { minLength: 3 });
    if (detectedLang === 'ind') {
      log.info({ conversationId }, 'chat: detected Indonesian, translating');
      const translationBudget = await reserveTrackedTokens(
        userId,
        estimateTokens(query) + TRANSLATION_TOKEN_RESERVATION,
      );
      if (translationBudget === 'limit') {
        return budgetExceededResult();
      }
      if (translationBudget === 'error') {
        return {
          response: 'Chat service is temporarily unavailable. Please try again later.',
          toolsUsed: [],
          sources: [],
        };
      }

      try {
        const translateResult = await llm.call({
          model: config.models.haiku,
          system: 'Translate the following Indonesian text to English. Return only the translation, nothing else.',
          messages: [{ role: 'user', content: query }],
          maxTokens: 1024,
          stage: 'translate',
        });
        const translationActual = estimateTokens(query) + estimateTokens(translateResult.content ?? '');
        await refundTrackedTokens(userId, estimateTokens(query) + TRANSLATION_TOKEN_RESERVATION - translationActual);
        // Validate translation result — fall back to original on failure (D-022)
        // Indonesian text is often significantly longer than its English translation,
        // so use a generous 5x multiplier to avoid false rejections.
        const translated = translateResult.content?.trim();
        if (translated && translated.length > 0 && translated.length < query.length * 5) {
          // Wrap translated text in nonce-protected XML — the translation came from an LLM
          // and could carry through prompt injection embedded in the original Indonesian query.
          const { wrapped } = llm.wrapWithNonce(translated);
          processedQuery = wrapped;
          queryWrapped = true; // CH-020
        } else {
          log.warn(
            { conversationId, translatedLength: translated?.length },
            'Translation result invalid, re-embedding original Indonesian query',
          );
          // Re-embed the original Indonesian query so semantic search still works.
          // processedQuery stays as original query — the LLM and tools will handle it.
          processedQuery = query;
        }
      } catch (err: unknown) {
        await refundTrackedTokens(userId, estimateTokens(query) + TRANSLATION_TOKEN_RESERVATION);
        log.warn({ conversationId, err }, 'chat: Indonesian translation failed, using original query');
      }
    }

    // Step 2: Build conversation context
    const history = conversations.get(conversationId, userId);

    // Step 4: Build messages for LLM
    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      ...history,
      { role: 'user', content: processedQuery },
    ];

    // Step 5: Tool execution loop
    let rounds = 0;
    let finalResponse = '';

    const toolDefsText = JSON.stringify(TOOL_DEFINITIONS);
    const systemWithTools = `${SYSTEM_PROMPT}\n\nTool definitions:\n${toolDefsText}\n\nTo use a tool, respond with a <tool_call> block containing JSON with "name" and "args". You may use multiple tool calls. When you have enough information, respond with your final answer as plain text (no tool_call blocks).`;

    // Count input tokens once (user query + history)
    const inputTokens = Math.ceil(messages.reduce((sum, m) => sum + m.content.length / 4, 0));
    const inputBudget = await reserveTrackedTokens(userId, inputTokens);
    if (inputBudget === 'limit') {
      return budgetExceededResult();
    }
    if (inputBudget === 'error') {
      return {
        response: 'Chat service is temporarily unavailable. Please try again later.',
        toolsUsed: [],
        sources: [],
      };
    }

    const toolFailures = new Map<string, number>();
    let totalToolResultChars = 0;

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;

      let result: LLMCallResult;
      const responseBudget = await reserveTrackedTokens(userId, CHAT_RESPONSE_TOKEN_RESERVATION);
      if (responseBudget === 'limit') {
        return budgetExceededResult();
      }
      if (responseBudget === 'error') {
        return { response: 'Chat service is temporarily unavailable. Please try again later.', toolsUsed, sources: [] };
      }

      try {
        result = await llm.call({
          model: config.models.sonnet,
          system: systemWithTools,
          messages,
          maxTokens: 4096,
          stage: 'chat',
        });
      } catch (err: unknown) {
        await refundTrackedTokens(userId, CHAT_RESPONSE_TOKEN_RESERVATION);
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('halted') || msg.includes('401') || msg.includes('unauthorized')) {
          log.error({ err, conversationId }, 'chat: LLM service halted');
          return {
            response: 'Chat service is temporarily unavailable. Please try again later.',
            toolsUsed,
            sources: [],
          };
        }
        if (msg.includes('context') || msg.includes('token')) {
          log.warn({ err, conversationId }, 'chat: context length exceeded');
          return {
            response: 'Your conversation is too long. Please start a new conversation.',
            toolsUsed,
            sources: [],
          };
        }
        log.error({ err, conversationId }, 'chat: LLM call failed');
        return { response: 'An error occurred processing your request. Please try again.', toolsUsed, sources: [] };
      }

      const responseTokens = estimateTokens(result.content ?? '');
      await refundTrackedTokens(userId, CHAT_RESPONSE_TOKEN_RESERVATION - responseTokens);

      const toolCalls = parseToolCalls(result.content);

      if (toolCalls.length === 0) {
        // No tool calls — this is the final response
        finalResponse = result.content;
        break;
      }

      // Execute tool calls
      const toolResults: string[] = [];
      let budgetExhausted = false;
      for (const call of toolCalls) {
        // Check total tool result budget before executing more tools
        if (totalToolResultChars >= MAX_TOTAL_TOOL_RESULT_CHARS) {
          budgetExhausted = true;
          log.warn(
            { conversationId, totalToolResultChars },
            'chat: tool result budget exhausted, skipping remaining calls',
          );
          toolResults.push(
            buildToolResultMessage(
              llm,
              call.name,
              'Skipped: tool result budget exhausted. Work with the data you already have.',
            ),
          );
          continue;
        }

        const tool = toolMap.get(call.name);
        if (!tool) {
          toolResults.push(buildToolResultMessage(llm, call.name, `Error: unknown tool "${call.name}"`));
          continue;
        }

        try {
          const toolResult = await tool.execute(call.args);
          if (!toolsUsed.includes(call.name)) {
            toolsUsed.push(call.name);
          }
          const usageLabel = formatToolUsageLabel(tool, call.args);
          if (!toolUsageLabels.includes(usageLabel)) {
            toolUsageLabels.push(usageLabel);
          }
          const truncatedResult = truncateToolResult(toolResult, MAX_TOOL_RESULT_CHARS);
          for (const source of extractSourcesFromToolResult(usageLabel, truncatedResult)) {
            sources.set(`${source.type}:${source.id}`, source);
          }
          totalToolResultChars += truncatedResult.length;
          toolResults.push(buildToolResultMessage(llm, call.name, truncatedResult));
          // Reset failure counter on success
          toolFailures.delete(call.name);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          log.error({ tool: call.name, err }, 'chat: tool execution failed');
          const failures = (toolFailures.get(call.name) ?? 0) + 1;
          toolFailures.set(call.name, failures);
          if (failures >= 2) {
            toolResults.push(
              buildToolResultMessage(
                llm,
                call.name,
                `Error: tool "${call.name}" has failed ${failures} times and is temporarily unavailable. Use a different approach.`,
              ),
            );
          } else {
            toolResults.push(buildToolResultMessage(llm, call.name, `Error: ${errMsg}`));
          }
        }
      }

      // Add assistant message with tool calls and tool results
      messages.push({ role: 'assistant', content: result.content });
      const toolResultsText = toolResults.join('\n\n');
      if (budgetExhausted) {
        messages.push({
          role: 'user',
          content: `${toolResultsText}\n\n[System: Tool result budget reached. Do NOT call more tools. Produce your final answer now using the data you already have.]`,
        });
      } else {
        messages.push({ role: 'user', content: toolResultsText });
      }
    }

    // If we exhausted rounds without a final response, use the last result
    if (!finalResponse) {
      finalResponse =
        'I was unable to complete the analysis within the allowed number of steps. Please try a more specific question.';
    }

    // Step 6: Save conversation history
    // CH-020: Ensure query is always nonce-wrapped before saving to conversation history
    const historyQuery = queryWrapped ? processedQuery : llm.wrapWithNonce(processedQuery).wrapped;
    conversations.add(conversationId, userId, 'user', historyQuery);
    conversations.add(conversationId, userId, 'assistant', finalResponse);

    return {
      response: finalResponse,
      toolsUsed: toolUsageLabels.length > 0 ? toolUsageLabels : toolsUsed,
      sources: [...sources.values()],
    };
  }

  return { handle };
}
