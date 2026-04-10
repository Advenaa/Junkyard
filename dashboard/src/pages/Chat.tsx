import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import { apiFetch } from '../lib/api';
import { ChatPanel } from '../components/ChatPanel';
import { ChatMessage } from '../components/ChatMessage';
import type { ChatSource } from '../components/ChatSources';
import { useStatus } from '../components/StatusProvider';
import { FeatureDisabledCard } from '../components/FeatureDisabledCard';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  sources?: ChatSource[];
  retryQuery?: string;
}

interface ChatResponse {
  response: string;
  toolsUsed: string[];
  sources: ChatSource[];
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function parseErrorMessage(err: unknown): string {
  if (err instanceof TypeError && err.message === 'Failed to fetch') {
    return 'Network error. Check your connection.';
  }
  if (err instanceof Error) {
    const match = err.message.match(/API (\d+):/);
    if (match) {
      const status = Number(match[1]);
      if (status === 429) return "You're sending messages too quickly. Please wait a moment.";
      if (status >= 500) return 'The server encountered an error. Try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

export function Chat() {
  const { getDisabledFeature } = useStatus();
  const disabledEmbeddings = getDisabledFeature('embeddings');
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('podders-chat-messages') ?? '[]');
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [retryQuery, setRetryQuery] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [conversationId, setConversationId] = useState(() => {
    return sessionStorage.getItem('podders-chat-conversation-id') ?? generateId();
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationIdRef = useRef(conversationId);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    sessionStorage.setItem('podders-chat-messages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    sessionStorage.setItem('podders-chat-conversation-id', conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const send = useCallback(
    async (overrideQuery?: string) => {
      const query = overrideQuery ?? input.trim();
      if (!query || loading) return;

      const requestConversationId = conversationId;
      const isRetry = !!overrideQuery;

      if (!isRetry) {
        setInput('');
        setMessages((prev) => [...prev, { id: generateId(), role: 'user', content: query }]);
      }
      setRetryQuery(null);
      setLoading(true);

      try {
        const data = await apiFetch<ChatResponse>('/chat', {
          method: 'POST',
          body: JSON.stringify({ query, conversationId: requestConversationId }),
        });
        if (conversationIdRef.current !== requestConversationId) return;
        setRetryQuery(null);
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content: data.response,
            toolsUsed: data.toolsUsed,
            sources: data.sources,
          },
        ]);
      } catch (err) {
        if (conversationIdRef.current !== requestConversationId) return;
        const errorMessage = parseErrorMessage(err);
        setRetryQuery(query);
        setMessages((prev) => [
          ...prev,
          { id: generateId(), role: 'assistant', content: errorMessage, retryQuery: query },
        ]);
      } finally {
        if (conversationIdRef.current === requestConversationId) {
          setLoading(false);
        }
      }
    },
    [input, loading, conversationId],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const newChat = () => {
    setMessages([]);
    setConversationId(generateId());
    setInput('');
    setRetryQuery(null);
    sessionStorage.removeItem('podders-chat-messages');
    sessionStorage.removeItem('podders-chat-conversation-id');
    textareaRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface">
        <span className="text-sm text-text-secondary">Chat</span>
        <button
          onClick={newChat}
          aria-label="Start new chat conversation"
          className="text-xs px-3 py-2.5 min-h-[44px] rounded bg-surface-raised text-text-secondary hover:text-text-primary transition-colors"
        >
          New Chat
        </button>
      </div>

      {disabledEmbeddings && (
        <div className="px-4 pt-3">
          <FeatureDisabledCard
            feature={disabledEmbeddings}
            variant="inline"
            title="Semantic search is disabled — keyword lookups and raw-message retrieval still work."
          />
        </div>
      )}

      {/* Messages */}
      <ChatPanel>
        {messages.length === 0 && !loading && (
          <div className="flex items-center justify-center h-full text-text-secondary text-sm">
            Ask anything about your market intelligence data.
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id}>
            <ChatMessage role={msg.role} content={msg.content} toolsUsed={msg.toolsUsed} sources={msg.sources} />
            {msg.retryQuery && (
              <div className="flex justify-start pl-10 -mt-1 mb-2">
                <button
                  onClick={() => send(msg.retryQuery)}
                  disabled={loading}
                  className="text-xs px-3 py-1.5 rounded bg-surface-raised text-accent hover:text-accent/80 border border-border disabled:opacity-40 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div>
            <ChatMessage role="assistant" content="" loading />
            <div className="pl-10 -mt-1 mb-2 text-xs text-text-secondary">
              {elapsed < 10
                ? `Analyzing... (${elapsed}s)`
                : `Complex queries take longer — searching and cross-referencing data... (${elapsed}s)`}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </ChatPanel>

      {/* Input bar */}
      <div className="border-t border-border bg-surface px-4 py-3">
        <div className="flex gap-2 items-end max-w-3xl mx-auto">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Chat message input"
            placeholder="Ask about markets, entities, signals..."
            rows={1}
            className="flex-1 resize-none overflow-y-auto bg-surface-raised text-text-primary placeholder:text-text-secondary text-sm rounded-lg px-4 py-2.5 border border-border focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim() || input.length > 4000}
            aria-label="Send message"
            className="px-4 py-2.5 min-h-[44px] rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40 transition-opacity"
          >
            Send
          </button>
        </div>
        {input.length > 3000 && (
          <div
            className={`text-xs font-mono mt-1 text-right max-w-3xl mx-auto ${input.length > 4000 ? 'text-red-400' : 'text-text-secondary'}`}
          >
            {input.length.toLocaleString()}/4,000
          </div>
        )}
      </div>
    </div>
  );
}
