import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import { apiFetch } from '../lib/api';
import { ChatPanel } from '../components/ChatPanel';
import { ChatMessage } from '../components/ChatMessage';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
}

interface ChatResponse {
  response: string;
  toolsUsed: string[];
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(generateId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = useCallback(async () => {
    const query = input.trim();
    if (!query || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: query }]);
    setLoading(true);

    try {
      const data = await apiFetch<ChatResponse>('/chat', {
        method: 'POST',
        body: JSON.stringify({ query, conversationId }),
      });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.response, toolsUsed: data.toolsUsed },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, conversationId]);

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
    textareaRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-49px)] bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface">
        <span className="text-sm text-text-secondary">Chat</span>
        <button
          onClick={newChat}
          className="text-xs px-3 py-1 rounded bg-surface-raised text-text-secondary hover:text-text-primary transition-colors"
        >
          New Chat
        </button>
      </div>

      {/* Messages */}
      <ChatPanel>
        {messages.length === 0 && !loading && (
          <div className="flex items-center justify-center h-full text-text-secondary text-sm">
            Ask anything about your market intelligence data.
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} role={msg.role} content={msg.content} toolsUsed={msg.toolsUsed} />
        ))}
        {loading && <ChatMessage role="assistant" content="" loading />}
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
            placeholder="Ask about markets, entities, signals..."
            rows={1}
            className="flex-1 resize-none bg-surface-raised text-text-primary placeholder:text-text-secondary text-sm rounded-lg px-4 py-2.5 border border-border focus:border-accent focus:outline-none"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40 transition-opacity"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
