import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { apiFetch } from '../lib/api';
import { EmptyState } from '../components/EmptyState';
import { isSafeUrl } from '../lib/url';

interface RawItemResponse {
  id: string;
  source: string;
  sourceId: string;
  author: string;
  content: string;
  timestamp: number;
  url: string | null;
  engagement: number;
  attachments: string[] | string | null;
  originalLanguage: string | null;
  translated: boolean;
  filterReason: string | null;
  status: string;
  createdAt: number;
}

interface RawItem extends Omit<RawItemResponse, 'attachments'> {
  attachments: string[];
}

const SOURCE_COLORS: Record<string, string> = {
  discord: 'bg-accent/20 text-accent',
  twitter: 'bg-accent-orange/20 text-accent-orange',
  rss: 'bg-accent-green/20 text-accent-green',
  news: 'bg-border text-text-secondary',
};

function normalizeItem(raw: RawItemResponse): RawItem {
  let attachments: string[] = [];
  if (Array.isArray(raw.attachments)) {
    attachments = raw.attachments;
  } else if (typeof raw.attachments === 'string') {
    try {
      attachments = JSON.parse(raw.attachments);
    } catch {
      attachments = [];
    }
  }

  return { ...raw, attachments };
}

function SourceBadge({ source }: { source: string }) {
  const color = SOURCE_COLORS[source] ?? 'bg-border text-text-secondary';
  return <span className={`px-2 py-0.5 rounded text-xs font-mono uppercase ${color}`}>{source}</span>;
}

function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ItemView() {
  const { id } = useParams<{ id: string }>();
  const requestKey = id ?? '';
  const [item, setItem] = useState<RawItem | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      return;
    }

    let cancelled = false;

    apiFetch<{ item: RawItemResponse }>(`/items/${id}`)
      .then((res) => {
        if (!cancelled) {
          setItem(normalizeItem(res.item));
          setError(null);
          setLoadedKey(id);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setItem(null);
          setError(err.message);
          setLoadedKey(id);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const loading = Boolean(id) && loadedKey !== requestKey;

  if (loading) {
    return <div className="p-6 text-text-secondary font-body">Loading...</div>;
  }

  if (error) {
    return <div className="p-6 text-accent-red font-body">Error: {error}</div>;
  }

  if (!item) {
    return (
      <div className="p-6">
        <EmptyState title="Item not found" description="This raw source item is no longer available." />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <SourceBadge source={item.source} />
          <span className="font-mono text-xs text-text-secondary uppercase tracking-wider">Raw Item</span>
        </div>
        <span className="font-mono text-xs text-text-secondary">{formatDateTime(item.timestamp)}</span>
      </div>

      <div className="bg-surface border border-border rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <span className="text-text-primary text-sm font-body font-medium">@{item.author}</span>
          <span className="font-mono text-xs uppercase tracking-wider text-text-secondary">{item.status}</span>
        </div>
        <p className="text-text-primary text-sm font-body leading-relaxed whitespace-pre-wrap">{item.content}</p>

        {item.attachments.length > 0 && (
          <div className="flex gap-2 flex-wrap pt-1">
            {item.attachments
              .slice(0, 4)
              .filter(isSafeUrl)
              .map((url, index) => (
                <a key={index} href={url} target="_blank" rel="noopener noreferrer" className="block">
                  <img
                    src={url}
                    alt={`Attachment ${index + 1}`}
                    loading="lazy"
                    className="max-w-[200px] max-h-[150px] rounded border border-border object-cover"
                  />
                </a>
              ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Source ID</div>
          <div className="text-sm text-text-primary font-body break-all">{item.sourceId}</div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Captured</div>
          <div className="text-sm text-text-primary font-body">{formatDateTime(item.createdAt)}</div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Flags</div>
          <div className="text-sm text-text-primary font-body leading-relaxed">
            {item.translated ? 'Translated to English' : 'Original text kept'}
            {item.originalLanguage && ` | language ${item.originalLanguage}`}
            {item.filterReason && ` | filter ${item.filterReason}`}
          </div>
        </div>
      </div>

      {item.url && isSafeUrl(item.url) && (
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">External Link</div>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent hover:underline break-all"
          >
            {item.url}
          </a>
        </div>
      )}
    </div>
  );
}
