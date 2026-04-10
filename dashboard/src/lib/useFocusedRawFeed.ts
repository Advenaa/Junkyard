import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { isFocusedRawFeedActive } from './rawFeedNavigation';
import { type RawSourceItem, type RawSourceItemContextResponse, normalizeRawSourceItem } from './rawSourceItems';

interface FocusedRawFeedListItem {
  id: string;
  timestamp: number;
}

interface UseFocusedRawFeedOptions {
  focusedItemId: string;
  requestedSource?: string;
  requestedSourceId: string;
  selectedSource: string;
  selectedSourceKind?: string;
  items: FocusedRawFeedListItem[];
  loading: boolean;
  contextSize?: number;
}

export interface FocusedRawFeedContext {
  item: RawSourceItem;
  older: RawSourceItem[];
  newer: RawSourceItem[];
}

export const DEFAULT_FOCUSED_RAW_FEED_CONTEXT_SIZE = 2;
export const MAX_FOCUSED_RAW_FEED_CONTEXT_SIZE = 5;
const DEFAULT_GAP_LABEL = 'Live feed resumes below';
const DEFAULT_FOCUSED_CONTEXT_ERROR = 'Unable to load focused citation context. Please try again.';
const DEFAULT_FOCUSED_EXPANSION_ERROR = 'Unable to load more context. Please try again.';

export function formatFocusedRawFeedGapLabel(focusedTimestamp: number, liveTimestamp: number): string {
  const diffMs = liveTimestamp - focusedTimestamp;
  if (diffMs <= 0) return DEFAULT_GAP_LABEL;

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Live feed resumes less than a minute later';
  if (minutes < 60) return `Live feed resumes about ${minutes} minute${minutes === 1 ? '' : 's'} later`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Live feed resumes about ${hours} hour${hours === 1 ? '' : 's'} later`;

  const days = Math.floor(hours / 24);
  return `Live feed resumes about ${days} day${days === 1 ? '' : 's'} later`;
}

function normalizeFocusedRawFeedContext(response: RawSourceItemContextResponse): FocusedRawFeedContext {
  return {
    item: normalizeRawSourceItem(response.item),
    older: (response.context?.older ?? []).map(normalizeRawSourceItem),
    newer: (response.context?.newer ?? []).map(normalizeRawSourceItem),
  };
}

export function useFocusedRawFeed({
  focusedItemId,
  requestedSource,
  requestedSourceId,
  selectedSource,
  selectedSourceKind,
  items,
  loading,
  contextSize = DEFAULT_FOCUSED_RAW_FEED_CONTEXT_SIZE,
}: UseFocusedRawFeedOptions) {
  const [focusedContext, setFocusedContext] = useState<FocusedRawFeedContext | null>(null);
  const [focusedContextLoading, setFocusedContextLoading] = useState(false);
  const [loadedContextSize, setLoadedContextSize] = useState<number | null>(null);
  const [focusedContextError, setFocusedContextError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const focusedItemVisible = focusedItemId.length > 0 && items.some((item) => item.id === focusedItemId);
  const focusedRawFeedActive = isFocusedRawFeedActive({
    focusedItemId,
    focusedItemVisible,
    requestedSourceId,
    selectedSource,
  });

  useEffect(() => {
    if (!focusedRawFeedActive || loading) return;

    if (focusedContext?.item.id === focusedItemId && loadedContextSize === contextSize) {
      return;
    }

    const isSameFocusedItem = focusedContext?.item.id === focusedItemId;
    let cancelled = false;
    const loadFocusedContext = async () => {
      await Promise.resolve();
      if (cancelled) return;

      if (!isSameFocusedItem) {
        setFocusedContext(null);
      }
      setFocusedContextError(null);
      setFocusedContextLoading(true);

      try {
        const response = await apiFetch<RawSourceItemContextResponse>(`/items/${focusedItemId}?context=${contextSize}`);
        if (cancelled) return;

        const normalizedContext = normalizeFocusedRawFeedContext(response);
        if (
          normalizedContext.item.sourceId !== selectedSource ||
          (selectedSourceKind && normalizedContext.item.source !== selectedSourceKind)
        ) {
          setFocusedContext(null);
          setFocusedContextLoading(false);
          setLoadedContextSize(null);
          return;
        }

        setFocusedContext(normalizedContext);
        setFocusedContextLoading(false);
        setLoadedContextSize(contextSize);
      } catch {
        if (cancelled) return;
        if (!isSameFocusedItem) {
          setFocusedContext(null);
          setLoadedContextSize(null);
        }
        setFocusedContextLoading(false);
        setFocusedContextError(isSameFocusedItem ? DEFAULT_FOCUSED_EXPANSION_ERROR : DEFAULT_FOCUSED_CONTEXT_ERROR);
      }
    };
    void loadFocusedContext();

    return () => {
      cancelled = true;
    };
  }, [
    contextSize,
    focusedContext?.item.id,
    focusedItemId,
    focusedRawFeedActive,
    loadedContextSize,
    loading,
    requestedSource,
    retryNonce,
    selectedSource,
    selectedSourceKind,
  ]);

  const activeFocusedContext = focusedRawFeedActive ? focusedContext : null;
  const activeFocusedContextError = focusedRawFeedActive ? focusedContextError : null;
  const activeFocusedContextLoading = focusedRawFeedActive ? focusedContextLoading : false;
  const focusedGapLabel =
    activeFocusedContext && items.length > 0
      ? formatFocusedRawFeedGapLabel(activeFocusedContext.item.timestamp, items[0]!.timestamp)
      : DEFAULT_GAP_LABEL;

  return {
    focusedContext: activeFocusedContext,
    focusedContextError: activeFocusedContextError,
    focusedContextLoading: activeFocusedContextLoading,
    focusedGapLabel,
    focusedItemVisible,
    focusedRawFeedActive,
    retryFocusedContext: () => setRetryNonce((current) => current + 1),
  };
}
