import { useState } from 'react';

const TOOL_LABELS: Record<string, string> = {
  semantic_search: 'Searched summaries by meaning',
  keyword_search: 'Searched summaries by keyword',
  read_raw: 'Read raw source messages',
  get_entity: 'Looked up entity details',
  get_recent: 'Fetched recent items',
};

function formatToolName(tool: string): string {
  if (tool in TOOL_LABELS) return TOOL_LABELS[tool];
  return tool.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

interface ToolUsageIndicatorProps {
  tools: string[];
  collapsed?: boolean;
}

export function ToolUsageIndicator({ tools, collapsed: initialCollapsed }: ToolUsageIndicatorProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed ?? true);

  if (tools.length === 0) return null;

  if (collapsed) {
    return (
      <div className="mt-1.5 pt-1.5 border-t border-border/50">
        <button
          onClick={() => setCollapsed(false)}
          className="text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          Used {tools.length} tool{tools.length !== 1 ? 's' : ''} ▸
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-1">
      <button
        onClick={() => setCollapsed(true)}
        className="text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        Used {tools.length} tool{tools.length !== 1 ? 's' : ''} ▾
      </button>
      {tools.map((tool) => (
        <div key={tool} className="flex items-center gap-1.5 text-xs text-text-secondary">
          <span className="text-[10px]">🔧</span>
          {formatToolName(tool)}
        </div>
      ))}
    </div>
  );
}
