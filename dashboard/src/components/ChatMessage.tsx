import type { ReactNode } from 'react';
import { ChatSources, type ChatSource } from './ChatSources';
import { ToolUsageIndicator } from './ToolUsageIndicator';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  sources?: ChatSource[];
  loading?: boolean;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(
        <strong key={`${keyPrefix}-b-${match.index}`} className="font-semibold">
          {match[2]}
        </strong>,
      );
    } else if (match[3]) {
      parts.push(
        <code
          key={`${keyPrefix}-c-${match.index}`}
          className="px-1 py-0.5 rounded bg-background text-accent text-[13px] font-mono"
        >
          {match[3]}
        </code>,
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function renderContent(text: string): ReactNode {
  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle (``` with optional language tag)
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        // Close code block
        elements.push(
          <pre
            key={`code-${i}`}
            className="bg-background rounded-lg p-3 text-xs font-mono text-text-primary overflow-x-auto my-2"
          >
            <code>{codeLines.join('\n')}</code>
          </pre>,
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      elements.push(
        <div key={`h3-${i}`} className="font-heading text-base text-text-primary mt-3 mb-1">
          {renderInline(line.slice(4), `h3-${i}`)}
        </div>,
      );
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <div key={`h2-${i}`} className="font-heading text-lg text-text-primary mt-3 mb-1">
          {renderInline(line.slice(3), `h2-${i}`)}
        </div>,
      );
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <div key={`h1-${i}`} className="font-heading text-xl text-text-primary mt-3 mb-1">
          {renderInline(line.slice(2), `h1-${i}`)}
        </div>,
      );
      continue;
    }

    // Bullet lists (- or * followed by space)
    if (/^[-*] /.test(line)) {
      elements.push(
        <div key={`ul-${i}`} className="pl-4 text-text-primary">
          {'• '}
          {renderInline(line.slice(2), `ul-${i}`)}
        </div>,
      );
      continue;
    }

    // Numbered lists (1. , 2. , etc.)
    const numMatch = line.match(/^(\d+)\. /);
    if (numMatch) {
      const num = numMatch[1];
      const content = line.slice(numMatch[0].length);
      elements.push(
        <div key={`ol-${i}`} className="pl-4 text-text-primary">
          {`${num}. `}
          {renderInline(content, `ol-${i}`)}
        </div>,
      );
      continue;
    }

    // Empty line → line break
    if (line.trim() === '') {
      elements.push(<br key={`br-${i}`} />);
      continue;
    }

    // Regular paragraph with inline formatting
    elements.push(
      <span key={`p-${i}`}>
        {renderInline(line, `p-${i}`)}
        {i < lines.length - 1 ? '\n' : ''}
      </span>,
    );
  }

  // Flush unclosed code block (defensive)
  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre
        key="code-unclosed"
        className="bg-background rounded-lg p-3 text-xs font-mono text-text-primary overflow-x-auto my-2"
      >
        <code>{codeLines.join('\n')}</code>
      </pre>,
    );
  }

  return <>{elements}</>;
}

export function ChatMessage({ role, content, toolsUsed, sources, loading }: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[75%] ${isUser ? 'order-1' : ''}`}>
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
            isUser ? 'bg-accent text-white rounded-br-md' : 'bg-surface text-text-primary rounded-bl-md'
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
        {!loading && sources && sources.length > 0 && <ChatSources sources={sources} />}
        {!loading && toolsUsed && toolsUsed.length > 0 && <ToolUsageIndicator tools={toolsUsed} />}
      </div>
    </div>
  );
}
