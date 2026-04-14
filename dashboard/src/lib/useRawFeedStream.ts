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
  requestedSource?: string;
  requestedSourceId: string;
  pageSize?: number;
  maxItems?: number;
  pollIntervalMs?: number;
}

type FeedFetchMode = 'replace' | 'append' | 'prepend';

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_ITEMS = 500;
const DEFAULT_POLL_INTERVAL_MS = 10_000;

function isFeedEligibleSource(source: RawFeedSource): boolean {
  return source.source === 'discord' || source.source === 'twitter';
}

function resolveRequestedFeedSource(
  sources: RawFeedSource[],
  requestedSource: string,
  requestedSourceId: string,
): RawFeedSource | null {
  // When the caller pins a source kind, treat (source, sourceId) as a hard
  // identity. Falling back across kinds would let `?source=twitter&sourceId=X`
  // resolve to a discord row whenever the twitter source temporarily drops out
  // of the catalog, breaking the collision-safety contract M-014 enforces.
  if (requestedSource.length > 0) {
    if (requestedSourceId.length === 0) {
      return sources.find((source) => source.source === requestedSource) ?? null;
    }
    return sources.find((source) => source.source === requestedSource && source.sourceId === requestedSourceId) ?? null;
  }

  if (requestedSourceId.length > 0) {
    return sources.find((source) => source.sourceId === requestedSourceId) ?? null;
  }

  return null;
}

function buildFeedUrl(selectedFeedSource: RawFeedSource, pageSize: number, offset: number, after?: number): string {
  const encodedSourceId = encodeURIComponent(selectedFeedSource.sourceId);
  const searchParams = new URLSearchParams({
    limit: String(pageSize),
    offset: String(offset),
    source: selectedFeedSource.source,
  });
  if (after !== undefined) {
    searchParams.set('after', String(after));
  }
  return `/feed/${encodedSourceId}?${searchParams.toString()}`;
}

export function normalizeFeedItem(raw: RawFeedItemRaw): RawFeedItem {
  return { ...raw, attachments: normalizeRawMessageAttachments(raw.attachments) };
}

export function useRawFeedStream({
  requestedSource = '',
  requestedSourceId,
  pageSize = DEFAULT_PAGE_SIZE,
  maxItems = DEFAULT_MAX_ITEMS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseRawFeedStreamOptions) {
  const [sources, setSources] = useState<RawFeedSource[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [selectedSource, setSelectedSourceId] = useState<string>(requestedSourceId);
  const [selectedFeedSource, setSelectedFeedSourceState] = useState<RawFeedSource | null>(null);
  const [items, setItems] = useState<RawFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [live, setLive] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const itemsRef = useRef<RawFeedItem[]>([]);
  const selectedFeedSourceRef = useRef<RawFeedSource | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    selectedFeedSourceRef.current = selectedFeedSource;
  }, [selectedFeedSource]);

  const applySelectedFeedSource = useCallback((source: RawFeedSource | null) => {
    setSelectedFeedSourceState(source);
    setSelectedSourceId(source?.sourceId ?? '');
  }, []);

  useEffect(() => {
    apiFetch<{ sources: RawFeedSource[] }>('/sources')
      .then((response) => {
        const feedSources = response.sources.filter(isFeedEligibleSource);
        setSources(feedSources);
        setSourcesLoaded(true);
        const requestedSelection = resolveRequestedFeedSource(feedSources, requestedSource, requestedSourceId);
        if (requestedSelection) {
          applySelectedFeedSource(requestedSelection);
          return;
        }

        // Stale deep link: caller explicitly asked for a source/sourceId that
        // is no longer in the catalog. Leave the selection null so the UI can
        // surface an empty state instead of silently redirecting to a
        // different source kind.
        if (requestedSource.length > 0 || requestedSourceId.length > 0) {
          applySelectedFeedSource(null);
          return;
        }

        const currentSelection = selectedFeedSourceRef.current
          ? (feedSources.find(
              (source) =>
                source.source === selectedFeedSourceRef.current?.source &&
                source.sourceId === selectedFeedSourceRef.current?.sourceId,
            ) ?? null)
          : null;
        applySelectedFeedSource(currentSelection ?? feedSources[0] ?? null);
      })
      .catch(() => {
        setSourcesLoaded(true);
        setError('Failed to load sources.');
      });
  }, [applySelectedFeedSource, requestedSource, requestedSourceId]);

  const setSelectedSource = useCallback(
    (source: string | RawFeedSource) => {
      if (typeof source !== 'string') {
        // Caller passed a full identity — use it directly without re-running
        // the resolver (which would re-impose the requestedSource constraint
        // from the URL and reject manual cross-kind switches).
        const exactCatalogMatch = sources.find(
          (candidate) => candidate.source === source.source && candidate.sourceId === source.sourceId,
        );
        applySelectedFeedSource(exactCatalogMatch ?? source);
        return;
      }

      // Legacy string overload: manual pick by sourceId only (no source kind
      // hint). Pick the first catalog row whose sourceId matches; if multiple
      // sources collide on this sourceId, callers must use the object form
      // above to disambiguate.
      const sourceIdMatch = sources.find((candidate) => candidate.sourceId === source);
      applySelectedFeedSource(sourceIdMatch ?? null);
    },
    [applySelectedFeedSource, sources],
  );

  const fetchItems = useCallback(
    async (offset: number, mode: FeedFetchMode) => {
      if (!selectedFeedSource) return;

      try {
        setError(null);
        let url = buildFeedUrl(selectedFeedSource, pageSize, offset);
        if (mode === 'prepend') {
          const newestTimestamp = itemsRef.current[0]?.timestamp ?? null;
          if (newestTimestamp) {
            url = buildFeedUrl(selectedFeedSource, pageSize, 0, newestTimestamp);
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
    [maxItems, pageSize, selectedFeedSource],
  );

  useEffect(() => {
    if (!selectedFeedSource) return;

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        setError(null);
        const url = buildFeedUrl(selectedFeedSource, pageSize, 0);
        const response = await apiFetch<{ items: RawFeedItemRaw[] }>(url);
        if (cancelled) return;

        const normalized = response.items.map(normalizeFeedItem);
        setItems(normalized);
        setHasMore(response.items.length === pageSize);
      } catch {
        if (cancelled) return;
        setError('Failed to load feed. Please try again.');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [pageSize, selectedFeedSource]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (live && selectedFeedSource) {
      intervalRef.current = setInterval(() => {
        void fetchItems(0, 'prepend');
      }, pollIntervalMs);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchItems, live, pollIntervalMs, selectedFeedSource]);

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
    selectedFeedSource,
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
