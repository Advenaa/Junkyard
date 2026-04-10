import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import { normalizeRawMessageAttachments } from './rawMessages';

export interface RawFeedSource {
  source: string;
  sourceId: string;
  label: string;
}

export interface RawFeedItemRaw {
  id: string;
  source: string;
  author: string;
  content: string;
  timestamp: number;
  attachments: string | string[] | null;
  engagement: Record<string, number> | null;
}

export interface RawFeedItem {
  id: string;
  source: string;
  author: string;
  content: string;
  timestamp: number;
  attachments: string[];
  engagement: Record<string, number> | null;
}

interface UseRawFeedStreamOptions {
  requestedSourceId: string;
  pageSize?: number;
  maxItems?: number;
  pollIntervalMs?: number;
}

type FeedFetchMode = 'replace' | 'append' | 'prepend';

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_ITEMS = 500;
const DEFAULT_POLL_INTERVAL_MS = 10_000;

export function normalizeFeedItem(raw: RawFeedItemRaw): RawFeedItem {
  return { ...raw, attachments: normalizeRawMessageAttachments(raw.attachments) };
}

export function useRawFeedStream({
  requestedSourceId,
  pageSize = DEFAULT_PAGE_SIZE,
  maxItems = DEFAULT_MAX_ITEMS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseRawFeedStreamOptions) {
  const [sources, setSources] = useState<RawFeedSource[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string>(requestedSourceId);
  const [items, setItems] = useState<RawFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [live, setLive] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const itemsRef = useRef<RawFeedItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    apiFetch<{ sources: RawFeedSource[] }>('/sources')
      .then((response) => {
        const feedSources = response.sources.filter(
          (source) => source.source === 'discord' || source.source === 'twitter',
        );
        setSources(feedSources);
        setSourcesLoaded(true);
        setSelectedSource((current) => {
          const hasCurrent = current && feedSources.some((source) => source.sourceId === current);
          if (hasCurrent) return current;
          const requestedExists =
            requestedSourceId.length > 0 && feedSources.some((source) => source.sourceId === requestedSourceId);
          return requestedExists ? requestedSourceId : (feedSources[0]?.sourceId ?? '');
        });
      })
      .catch(() => {
        setSourcesLoaded(true);
        setError('Failed to load sources.');
      });
  }, [requestedSourceId]);

  const fetchItems = useCallback(
    async (offset: number, mode: FeedFetchMode) => {
      if (!selectedSource) return;

      try {
        setError(null);
        const encodedSource = encodeURIComponent(selectedSource);
        let url = `/feed/${encodedSource}?limit=${pageSize}&offset=${offset}`;
        if (mode === 'prepend') {
          const newestTimestamp = itemsRef.current[0]?.timestamp ?? null;
          if (newestTimestamp) {
            url = `/feed/${encodedSource}?limit=${pageSize}&offset=0&after=${encodeURIComponent(newestTimestamp)}`;
          }

          const response = await apiFetch<{ items: RawFeedItemRaw[] }>(url);
          if (response.items.length > 0) {
            const normalized = response.items.map(normalizeFeedItem);
            setItems((previous) => {
              const existingIds = new Set(previous.map((item) => item.id));
              const newItems = normalized.filter((item) => !existingIds.has(item.id));
              if (newItems.length === 0) return previous;

              const combined = [...newItems, ...previous];
              return combined.length > maxItems ? combined.slice(0, maxItems) : combined;
            });
          }
          return;
        }

        const response = await apiFetch<{ items: RawFeedItemRaw[] }>(url);
        const normalized = response.items.map(normalizeFeedItem);
        if (mode === 'append') {
          setItems((previous) => {
            const existingIds = new Set(previous.map((item) => item.id));
            const newItems = normalized.filter((item) => !existingIds.has(item.id));
            return [...previous, ...newItems];
          });
        } else {
          setItems(normalized);
        }
        setHasMore(response.items.length === pageSize);
      } catch {
        setError('Failed to load feed. Please try again.');
      }
    },
    [maxItems, pageSize, selectedSource],
  );

  useEffect(() => {
    if (!selectedSource) return;
    setLoading(true);
    fetchItems(0, 'replace').finally(() => setLoading(false));
  }, [fetchItems, selectedSource]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (live && selectedSource) {
      intervalRef.current = setInterval(() => {
        void fetchItems(0, 'prepend');
      }, pollIntervalMs);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchItems, live, pollIntervalMs, selectedSource]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      await fetchItems(items.length, 'append');
    } catch {
      setError('Failed to load more items. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  }, [fetchItems, items.length]);

  const reload = useCallback(async () => {
    await fetchItems(0, 'replace');
  }, [fetchItems]);

  return {
    sources,
    sourcesLoaded,
    selectedSource,
    setSelectedSource,
    items,
    loading,
    error,
    loadingMore,
    hasMore,
    live,
    setLive,
    loadMore,
    reload,
  };
}
