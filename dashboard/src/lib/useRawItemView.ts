import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { type RawSourceItem, type RawSourceItemContextResponse, normalizeRawSourceItem } from './rawSourceItems';

export interface RawItemViewContext {
  older: RawSourceItem[];
  newer: RawSourceItem[];
}

export type RawItemViewRouteState = 'loading' | 'error' | 'not_found' | 'ready';

interface UseRawItemViewOptions {
  itemId: string;
  contextSize?: number;
}

export const DEFAULT_RAW_ITEM_CONTEXT_SIZE = 3;
export const MAX_RAW_ITEM_CONTEXT_SIZE = 6;
const DEFAULT_RAW_ITEM_CONTEXT_ERROR = 'Unable to load more source context. Please try again.';

function createEmptyContext(): RawItemViewContext {
  return { older: [], newer: [] };
}

function normalizeRawItemViewContext(response: RawSourceItemContextResponse): RawItemViewContext {
  return {
    older: (response.context?.older ?? []).map(normalizeRawSourceItem),
    newer: (response.context?.newer ?? []).map(normalizeRawSourceItem),
  };
}

export function useRawItemView({ itemId, contextSize = DEFAULT_RAW_ITEM_CONTEXT_SIZE }: UseRawItemViewOptions) {
  const [item, setItem] = useState<RawSourceItem | null>(null);
  const [contextItems, setContextItems] = useState<RawItemViewContext>(createEmptyContext);
  const [loadedItemId, setLoadedItemId] = useState('');
  const [loadedContextSize, setLoadedContextSize] = useState<number | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const hasLoadedSameItem = loadedItemId === itemId && item !== null;

  useEffect(() => {
    if (!itemId) {
      setItem(null);
      setContextItems(createEmptyContext());
      setLoadedItemId('');
      setLoadedContextSize(null);
      setContextLoading(false);
      setContextError(null);
      setError(null);
      return;
    }

    if (hasLoadedSameItem && loadedContextSize === contextSize && !contextError) {
      setContextLoading(false);
      return;
    }

    let cancelled = false;
    setContextLoading(true);
    setContextError(null);
    setError(null);

    apiFetch<RawSourceItemContextResponse>(`/items/${itemId}?context=${contextSize}`)
      .then((response) => {
        if (cancelled) return;

        setItem(normalizeRawSourceItem(response.item));
        setContextItems(normalizeRawItemViewContext(response));
        setLoadedItemId(itemId);
        setLoadedContextSize(contextSize);
        setContextLoading(false);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;

        if (!hasLoadedSameItem) {
          setItem(null);
          setContextItems(createEmptyContext());
          setLoadedItemId(itemId);
          setLoadedContextSize(null);
          setError(err.message);
        } else {
          setContextError(DEFAULT_RAW_ITEM_CONTEXT_ERROR);
        }

        setContextLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [contextSize, hasLoadedSameItem, itemId, loadedContextSize, retryNonce]);

  const loading = itemId.length > 0 && loadedItemId !== itemId;
  const activeItem = loadedItemId === itemId ? item : null;
  const activeContextItems = loadedItemId === itemId ? contextItems : createEmptyContext();
  const activeError = loadedItemId === itemId ? error : null;
  const routeState: RawItemViewRouteState = loading ? 'loading' : activeError ? 'error' : activeItem ? 'ready' : 'not_found';

  return {
    item: activeItem,
    contextItems: activeContextItems,
    contextError,
    contextLoading,
    error: activeError,
    loading,
    routeState,
    retryContext: () => setRetryNonce((current) => current + 1),
  };
}
