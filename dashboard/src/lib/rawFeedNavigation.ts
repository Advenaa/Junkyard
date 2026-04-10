interface RawFeedItemTarget {
  id: string;
  source: string;
  sourceId: string;
}

interface RawRouteContextOptions {
  contextSize?: number;
}

interface RawFeedFocusState {
  focusedItemId: string;
  focusedItemVisible: boolean;
  requestedSourceId: string;
  selectedSource: string;
}

export function supportsRawFeedNavigation(source: string): boolean {
  return source === 'discord' || source === 'twitter';
}

function normalizeRawRouteContextSize(contextSize?: number): number | null {
  return Number.isInteger(contextSize) && (contextSize ?? 0) > 0 ? (contextSize ?? null) : null;
}

function appendRawRouteContextSize(params: URLSearchParams, contextSize?: number) {
  const normalizedContextSize = normalizeRawRouteContextSize(contextSize);
  if (normalizedContextSize !== null) {
    params.set('context', String(normalizedContextSize));
  }
}

export function readRawRouteContextSize(rawValue: string | null, defaultSize: number, maxSize: number): number {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 1) return defaultSize;
  return Math.min(parsed, maxSize);
}

export function toRawRouteContextParam(currentSize: number, defaultSize: number, maxSize: number): number | undefined {
  const normalizedCurrentSize = normalizeRawRouteContextSize(currentSize);
  if (normalizedCurrentSize === null || normalizedCurrentSize <= defaultSize) {
    return undefined;
  }

  return Math.min(normalizedCurrentSize, maxSize);
}

export function buildRawItemHref(itemId: string, { contextSize }: RawRouteContextOptions = {}): string {
  const params = new URLSearchParams();
  appendRawRouteContextSize(params, contextSize);
  const suffix = params.toString();
  return suffix.length > 0 ? `/items/${itemId}?${suffix}` : `/items/${itemId}`;
}

export function buildRawFeedFocusHref(
  source: string,
  sourceId: string,
  itemId: string,
  { contextSize }: RawRouteContextOptions = {},
): string {
  const params = new URLSearchParams();
  params.set('source', source);
  params.set('sourceId', sourceId);
  params.set('itemId', itemId);
  appendRawRouteContextSize(params, contextSize);
  return `/feed?${params.toString()}`;
}

export function buildRawFeedSourceHref(source: string, sourceId: string): string {
  const params = new URLSearchParams();
  params.set('source', source);
  params.set('sourceId', sourceId);
  return `/feed?${params.toString()}`;
}

export function buildRawFeedFocusHrefForItem(
  item: RawFeedItemTarget,
  options: RawRouteContextOptions = {},
): string | null {
  if (!supportsRawFeedNavigation(item.source)) return null;
  return buildRawFeedFocusHref(item.source, item.sourceId, item.id, options);
}

export function buildRawFeedSourceHrefForItem(item: Pick<RawFeedItemTarget, 'source' | 'sourceId'>): string | null {
  if (!supportsRawFeedNavigation(item.source)) return null;
  return buildRawFeedSourceHref(item.source, item.sourceId);
}

export function isFocusedRawFeedActive(state: RawFeedFocusState): boolean {
  return (
    state.focusedItemId.length > 0 && state.selectedSource === state.requestedSourceId && !state.focusedItemVisible
  );
}
