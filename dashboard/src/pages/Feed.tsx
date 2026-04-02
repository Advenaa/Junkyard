import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { EmptyState } from '../components/EmptyState';

interface FeedSource {
  source: string;
  sourceId: string;
  label: string;
}

interface FeedItem {
  id: string;
  source: string;
  author: string;
  content: string;
  timestamp: string;
  attachments: string[];
  engagement: Record<string, number> | null;
}

function formatTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const PAGE_SIZE = 50;

export function Feed() {
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [live, setLive] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load sources
  useEffect(() => {
    apiFetch<{ sources: FeedSource[] }>('/sources').then((res) => {
      const discordSources = res.sources.filter((s) => s.source === 'discord');
      setSources(discordSources);
      if (discordSources.length > 0 && !selectedSource) {
        setSelectedSource(discordSources[0].sourceId);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchItems = useCallback(
    async (offset: number, append: boolean) => {
      if (!selectedSource) return;
      const res = await apiFetch<{ items: FeedItem[] }>(
        `/feed/${selectedSource}?limit=${PAGE_SIZE}&offset=${offset}`,
      );
      if (append) {
        setItems((prev) => [...prev, ...res.items]);
      } else {
        setItems(res.items);
      }
      setHasMore(res.items.length === PAGE_SIZE);
    },
    [selectedSource],
  );

  // Fetch on source change
  useEffect(() => {
    if (!selectedSource) return;
    setLoading(true);
    fetchItems(0, false).finally(() => setLoading(false));
  }, [selectedSource, fetchItems]);

  // Polling
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (live && selectedSource) {
      intervalRef.current = setInterval(() => {
        fetchItems(0, false);
      }, 10_000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [live, selectedSource, fetchItems]);

  const loadMore = async () => {
    setLoadingMore(true);
    await fetchItems(items.length, true);
    setLoadingMore(false);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="font-heading text-2xl text-text-primary">Raw Feed</h1>
        <div className="flex items-center gap-4">
          {/* Channel Selector */}
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            className="bg-background border border-border rounded-lg px-3 py-2 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
          >
            {sources.map((s) => (
              <option key={s.sourceId} value={s.sourceId}>
                {s.label}
              </option>
            ))}
          </select>

          {/* Live / Paused Toggle */}
          <div className="flex bg-surface border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setLive(true)}
              className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors ${
                live ? 'bg-accent-green/20 text-accent-green' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Live
            </button>
            <button
              onClick={() => setLive(false)}
              className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors ${
                !live ? 'bg-surface-raised text-text-primary' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Paused
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      {loading ? (
        <div className="text-text-secondary font-body py-8">Loading...</div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No messages yet"
          description="Messages from this source will appear here once ingestion starts."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="bg-surface border border-border rounded-lg p-4 space-y-2"
            >
              {/* Meta */}
              <div className="flex items-center justify-between">
                <span className="text-text-primary text-sm font-body font-medium">
                  @{item.author}
                </span>
                <span className="text-text-secondary text-xs font-mono">
                  {formatTime(item.timestamp)}
                </span>
              </div>

              {/* Content */}
              <p className="text-text-primary text-sm font-body leading-relaxed whitespace-pre-wrap">
                {item.content}
              </p>

              {/* Attachments / Images */}
              {item.attachments && item.attachments.length > 0 && (
                <div className="flex gap-2 flex-wrap pt-1">
                  {item.attachments.slice(0, 4).map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <img
                        src={url}
                        alt=""
                        loading="lazy"
                        className="max-w-[200px] max-h-[150px] rounded border border-border object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Load More */}
      {!loading && hasMore && items.length > 0 && (
        <div className="text-center pt-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-6 py-2 bg-surface border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary hover:border-[#3a3a4f] transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
