import { franc } from 'franc';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';
import type { VectorCache } from '../vector-cache.js';
import type { LLMCallParams, LLMCallResult } from '../llm.js';
import { createConversationManager } from './conversations.js';
import { createChatTools } from './tools.js';
import type { ChatTool, Embedder, LLM as ToolLLM } from './tools.js';

// ── Types ──────────────────────────────────────────────────────────────

interface ChatLLM extends ToolLLM {
  call(params: LLMCallParams): Promise<LLMCallResult>;
}

interface ChatResult {
  response: string;
  toolsUsed: string[];
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

// ── Constants ─────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT = `You are Podders, a market intelligence assistant for crypto and Indonesian macro markets. Answer questions using ONLY the data retrieved by your tools. If you don't have data on a topic, say so — never speculate.

Available tools:
- semantic_search(query, type?): Search summaries/reports by meaning
- keyword_search(entity): Look up entity mentions, sentiment, history
- read_raw(itemId): Read the original source message

Always cite your sources. If a user asks about an entity, use keyword_search first, then semantic_search for context.`;

const TOOL_DEFINITIONS = [
  {
    name: 'semantic_search',
    description: 'Search summaries and reports by semantic similarity.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        type: {
          type: 'string',
          enum: ['summary', 'report'],
          description: 'Type of content to search (default: summary)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'keyword_search',
    description:
      'Look up an entity by name/alias for mentions, sentiment, and history.',
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

function buildToolResultMessage(
  toolName: string,
  result: string,
): string {
  return `<tool_result name="${toolName}">\n${result}\n</tool_result>`;
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

  // Per-user daily token budget tracking (D-020)
  // In-memory — resets on process restart. Acceptable for single-process deploy (pm2/systemd).
  // Budget resets daily at midnight UTC regardless. A restart mid-day gives users a fresh budget.
  const userTokens = new Map<string, { count: number; day: string }>();
  const MAX_DAILY_TOKENS_PER_USER = 100_000; // ~$1.50/day/user at Sonnet pricing

  function checkUserBudget(userId: string): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const entry = userTokens.get(userId);
    if (!entry || entry.day !== today) {
      userTokens.set(userId, { count: 0, day: today });
      return true;
    }
    return entry.count < MAX_DAILY_TOKENS_PER_USER;
  }

  function trackTokens(userId: string, tokens: number): void {
    const today = new Date().toISOString().slice(0, 10);
    const entry = userTokens.get(userId);
    if (!entry || entry.day !== today) {
      userTokens.set(userId, { count: tokens, day: today });
    } else {
      entry.count += tokens;
    }
  }

  const toolMap = new Map<string, ChatTool>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  // Periodic cleanup of idle conversations and stale token entries
  const cleanupInterval = setInterval(() => {
    conversations.cleanup();

    const today = new Date().toISOString().slice(0, 10);
    for (const [uid, entry] of userTokens) {
      if (entry.day !== today) {
        userTokens.delete(uid);
      }
    }
  }, 600_000); // every 10 minutes

  // Allow cleanup interval to not block process exit
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  async function handle(
    query: string,
    conversationId: string,
    userId: string,
  ): Promise<ChatResult> {
    if (!checkUserBudget(userId)) {
      return { response: 'You have reached your daily query limit. Please try again tomorrow.', toolsUsed: [] };
    }

    if (query.length > 4000) {
      return { response: 'Query is too long. Please keep it under 4000 characters.', toolsUsed: [] };
    }

    const toolsUsed: string[] = [];
    let processedQuery = query;

    // Step 1: Indonesian detection and translation
    const detectedLang = franc(query, { minLength: 3 });
    if (detectedLang === 'ind') {
      log.info({ conversationId }, 'chat: detected Indonesian, translating');
      const translateResult = await llm.call({
        model: config.models.haiku,
        system: 'Translate the following Indonesian text to English. Return only the translation, nothing else.',
        messages: [{ role: 'user', content: query }],
        maxTokens: 1024,
        stage: 'translate',
      });
      // Track translation token usage
      trackTokens(userId, Math.ceil(query.length / 4 + (translateResult.content?.length ?? 0) / 4));
      // Validate translation result — fall back to original on failure (D-022)
      const translated = translateResult.content?.trim();
      if (translated && translated.length > 0 && translated.length < query.length * 3) {
        processedQuery = translated;
      } else {
        log.warn({ conversationId, translatedLength: translated?.length }, 'Translation result invalid, using original query');
        // processedQuery stays as original query
      }
    }

    // Step 2: Sanitize user input before LLM
    processedQuery = llm.sanitizeForPrompt(processedQuery);

    // Step 3: Build conversation context
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
    trackTokens(userId, inputTokens);

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;

      let result: LLMCallResult;
      try {
        result = await llm.call({
          model: config.models.sonnet,
          system: systemWithTools,
          messages,
          maxTokens: 4096,
          stage: 'chat',
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('halted') || msg.includes('401') || msg.includes('unauthorized')) {
          log.error({ err, conversationId }, 'chat: LLM service halted');
          return { response: 'Chat service is temporarily unavailable. Please try again later.', toolsUsed };
        }
        if (msg.includes('context') || msg.includes('token')) {
          log.warn({ err, conversationId }, 'chat: context length exceeded');
          return { response: 'Your conversation is too long. Please start a new conversation.', toolsUsed };
        }
        log.error({ err, conversationId }, 'chat: LLM call failed');
        return { response: 'An error occurred processing your request. Please try again.', toolsUsed };
      }

      // Track only new tokens this round — response + any tool results added
      const responseTokens = Math.ceil((result.content?.length ?? 0) / 4);
      trackTokens(userId, responseTokens);

      const toolCalls = parseToolCalls(result.content);

      if (toolCalls.length === 0) {
        // No tool calls — this is the final response
        finalResponse = result.content;
        break;
      }

      // Execute tool calls
      const toolResults: string[] = [];
      for (const call of toolCalls) {
        const tool = toolMap.get(call.name);
        if (!tool) {
          toolResults.push(
            buildToolResultMessage(call.name, `Error: unknown tool "${call.name}"`),
          );
          continue;
        }

        if (!toolsUsed.includes(call.name)) {
          toolsUsed.push(call.name);
        }

        try {
          const toolResult = await tool.execute(call.args);
          const sanitizedResult = llm.sanitizeForPrompt(toolResult);
          toolResults.push(buildToolResultMessage(call.name, sanitizedResult));
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          log.error({ tool: call.name, err }, 'chat: tool execution failed');
          toolResults.push(
            buildToolResultMessage(call.name, `Error: ${errMsg}`),
          );
        }
      }

      // Add assistant message with tool calls and tool results
      messages.push({ role: 'assistant', content: result.content });
      messages.push({ role: 'user', content: toolResults.join('\n\n') });
    }

    // If we exhausted rounds without a final response, use the last result
    if (!finalResponse) {
      finalResponse =
        'I was unable to complete the analysis within the allowed number of steps. Please try a more specific question.';
    }

    // Step 6: Save conversation history
    conversations.add(conversationId, userId, 'user', processedQuery);
    conversations.add(conversationId, userId, 'assistant', finalResponse);

    return { response: finalResponse, toolsUsed };
  }

  return { handle };
}
