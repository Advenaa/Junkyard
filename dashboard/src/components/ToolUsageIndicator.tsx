import { useState, useEffect } from 'react';

const TOOL_LABELS: Record<string, string> = {
  semantic_search: 'Searched summaries...',
  keyword_search: 'Looked up entity...',
  read_raw: 'Read source message...',
};

interface ToolUsageIndicatorProps {
  tools: string[];
  collapsed?: boolean;
}

export function ToolUsageIndicator({ tools, collapsed: initialCollapsed }: ToolUsageIndicatorProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed ?? false);

  useEffect(() => {
    if (collapsed) return;
    const timer = setTimeout(() => setCollapsed(true), 3000);
    return () => clearTimeout(timer);
  }, [collapsed]);

  if (tools.length === 0) return null;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="flex gap-1.5 mt-1.5"
      >
        {tools.map((tool) => (
          <span
            key={tool}
            className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-text-secondary"
          >
            {tool}
          </span>
        ))}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      {tools.map((tool) => (
        <div key={tool} className="flex items-center gap-1.5 text-xs text-text-secondary">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent opacity-60" />
          {TOOL_LABELS[tool] ?? tool}
        </div>
      ))}
    </div>
  );
}
