import { Link } from 'react-router';

export interface ChatSource {
  type: 'report' | 'summary';
  id: string;
  label: string;
  snippet: string;
}

interface ChatSourcesProps {
  sources: ChatSource[];
}

function hrefForSource(source: ChatSource): string | null {
  if (source.type === 'report') {
    return `/reports/${source.id}`;
  }
  if (source.type === 'summary') {
    return `/summaries/${source.id}`;
  }
  return null;
}

export function ChatSources({ sources }: ChatSourcesProps) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary">Sources</div>
      <div className="flex flex-wrap gap-2">
        {sources.map((source) => {
          const href = hrefForSource(source);
          const className =
            'inline-flex items-center rounded-full border border-border bg-surface-raised px-3 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary';

          if (href) {
            return (
              <Link key={`${source.type}:${source.id}`} to={href} title={source.snippet} className={className}>
                {source.label}
              </Link>
            );
          }

          return (
            <span key={`${source.type}:${source.id}`} title={source.snippet} className={className}>
              {source.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
