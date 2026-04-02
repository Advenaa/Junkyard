import type { ReactNode } from 'react';
import { ToolUsageIndicator } from './ToolUsageIndicator';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  loading?: boolean;
}

function renderContent(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={match.index} className="font-semibold">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(
        <code key={match.index} className="px-1 py-0.5 rounded bg-background text-accent text-[13px] font-mono">
          {match[3]}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export function ChatMessage({ role, content, toolsUsed, loading }: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[75%] ${isUser ? 'order-1' : ''}`}>
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? 'bg-accent text-white rounded-br-md'
              : 'bg-surface text-text-primary rounded-bl-md'
          }`}
        >
          {loading ? (
            <span className="inline-flex gap-1">
              <span className="animate-bounce [animation-delay:0ms]">.</span>
              <span className="animate-bounce [animation-delay:150ms]">.</span>
              <span className="animate-bounce [animation-delay:300ms]">.</span>
            </span>
          ) : (
            renderContent(content)
          )}
        </div>
        {!loading && toolsUsed && toolsUsed.length > 0 && (
          <ToolUsageIndicator tools={toolsUsed} />
        )}
      </div>
    </div>
  );
}
