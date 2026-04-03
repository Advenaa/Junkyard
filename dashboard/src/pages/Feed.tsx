import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { isSafeUrl } from '../lib/url';
import { EmptyState } from '../components/EmptyState';

interface FeedSource {
  source: string;
  sourceId: string;
  label: string;
}

interface FeedItemRaw {
  id: string;
  source: string;
  author: string;
  content: string;
  timestamp: string;
  attachments: string | string[] | null;
  engagement: Record<string, number> | null;
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

function normalizeFeedItem(raw: FeedItemRaw): FeedItem {
  let attachments: string[] = [];
  if (Array.isArray(raw.attachments)) {
    attachments = raw.attachments;
  } else if (typeof raw.attachments === 'string') {
    try { attachments = JSON.parse(raw.attachments); } catch { attachments = []; }
  }
  return { ...raw, attachments };
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
const MAX_ITEMS = 500;

export function Feed() {
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [live, setLive] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const itemsRef = useRef<FeedItem[]>([]);

  // Keep itemsRef in sync for polling reads
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Load sources
  useEffect(() => {
    apiFetch<{ sources: FeedSource[] }>('/sources').then((res) => {
      const discordSources = res.sources.filter((s) => s.source === 'discord');
      setSources(discordSources);
      if (discordSources.length > 0 && !selectedSource) {
        setSelectedSource(discordSources[0].sourceId);
      }
    }).catch(() => setError('Failed to load sources.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchItems = useCallback(
    async (offset: number, mode: 'replace' | 'append' | 'prepend') => {
      if (!selectedSource) return;
      try {
        setError(null);
        let url = `/feed/${selectedSource}?limit=${PAGE_SIZE}&offset=${offset}`;
        if (mode === 'prepend') {
          // For polling, only request items newer than the most recent item
          const current = itemsRef.current;
          const newestTs = current.length > 0 ? current[0].timestamp : null;
          if (newestTs) {
            url = `/feed/${selectedSource}?limit=${PAGE_SIZE}&offset=0&after=${encodeURIComponent(newestTs)}`;
          }
          const res = await apiFetch<{ items: FeedItemRaw[] }>(url);
          if (res.items.length > 0) {
            const normalized = res.items.map(normalizeFeedItem);
            setItems((prev) => {
              const existingIds = new Set(prev.map((item) => item.id));
              const newItems = normalized.filter((item) => !existingIds.has(item.id));
              if (newItems.length === 0) return prev;
              const combined = [...newItems, ...prev];
              return combined.length > MAX_ITEMS ? combined.slice(0, MAX_ITEMS) : combined;
            });
          }
          return;
        }
        const res = await apiFetch<{ items: FeedItemRaw[] }>(url);
        const normalized = res.items.map(normalizeFeedItem);
        if (mode === 'append') {
          setItems((prev) => {
            const existingIds = new Set(prev.map((i) => i.id));
            const newItems = normalized.filter((i) => !existingIds.has(i.id));
            return [...prev, ...newItems];
          });
        } else {
          setItems(normalized);
        }
        setHasMore(res.items.length === PAGE_SIZE);
      } catch (err) {
        setError('Failed to load feed. Please try again.');
      }
    },
    [selectedSource],
  );

  // Fetch on source change
  useEffect(() => {
    if (!selectedSource) return;
    setLoading(true);
    fetchItems(0, 'replace').finally(() => setLoading(false));
  }, [selectedSource, fetchItems]);

  // Polling
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (live && selectedSource) {
      intervalRef.current = setInterval(async () => {
        try {
          await fetchItems(0, 'prepend');
        } catch {
          // Silently skip polling errors — user will see data from last successful fetch
        }
      }, 10_000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [live, selectedSource, fetchItems]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      await fetchItems(items.length, 'append');
    } catch {
      setError('Failed to load more items. Please try again.');
    } finally {
      setLoadingMore(false);
    }
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

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          <p>{error}</p>
          <button onClick={() => fetchItems(0, 'replace')} className="mt-2 text-sm underline">Retry</button>
        </div>
      )}

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
                  {item.attachments.slice(0, 4).filter(isSafeUrl).map((url, i) => (
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
