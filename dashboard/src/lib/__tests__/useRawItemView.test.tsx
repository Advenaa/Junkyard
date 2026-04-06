import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_RAW_ITEM_CONTEXT_SIZE, useRawItemView } from '../useRawItemView';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useRawItemView', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the requested raw item and normalizes nearby source context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/items/item-1') {
          expect(parsed.searchParams.get('context')).toBe(String(DEFAULT_RAW_ITEM_CONTEXT_SIZE));
          return jsonResponse({
            item: {
              id: 'item-1',
              source: 'discord',
              sourceId: 'guild:alpha',
              author: 'alice',
              content: 'Focused message',
              timestamp: 2_000,
              url: null,
              engagement: null,
              attachments: '["https://cdn.example.com/focus.png"]',
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 2_100,
            },
            context: {
              older: [
                {
                  id: 'item-older',
                  source: 'discord',
                  sourceId: 'guild:alpha',
                  author: 'bob',
                  content: 'Earlier message',
                  timestamp: 1_000,
                  url: null,
                  engagement: null,
                  attachments: null,
                  originalLanguage: 'eng',
                  translated: false,
                  filterReason: null,
                  status: 'processed',
                  createdAt: 1_100,
                },
              ],
              newer: [
                {
                  id: 'item-newer',
                  source: 'discord',
                  sourceId: 'guild:alpha',
                  author: 'charlie',
                  content: 'Later message',
                  timestamp: 3_000,
                  url: null,
                  engagement: null,
                  attachments: '["https://cdn.example.com/later.png"]',
                  originalLanguage: 'eng',
                  translated: false,
                  filterReason: null,
                  status: 'processed',
                  createdAt: 3_100,
                },
              ],
            },
          });
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    const { result } = renderHook(() => useRawItemView({ itemId: 'item-1' }));

    expect(result.current.routeState).toBe('loading');

    await waitFor(() => {
      expect(result.current.routeState).toBe('ready');
    });

    expect(result.current.item?.attachments).toEqual(['https://cdn.example.com/focus.png']);
    expect(result.current.contextItems.older.map((item) => item.id)).toEqual(['item-older']);
    expect(result.current.contextItems.newer[0]?.attachments).toEqual(['https://cdn.example.com/later.png']);
    expect(result.current.error).toBeNull();
  });

  it('surfaces an error route state when the item request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500, statusText: 'Internal Server Error' })),
    );

    const { result } = renderHook(() => useRawItemView({ itemId: 'item-1' }));

    await waitFor(() => {
      expect(result.current.routeState).toBe('error');
    });

    expect(result.current.item).toBeNull();
    expect(result.current.contextItems).toEqual({ older: [], newer: [] });
    expect(result.current.error).toBe('API 500: Internal Server Error');
  });

  it('hides stale item data while a different item id is loading', async () => {
    const secondRequest = createDeferred<Response>();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/items/item-1') {
          return jsonResponse({
            item: {
              id: 'item-1',
              source: 'discord',
              sourceId: 'guild:alpha',
              author: 'alice',
              content: 'First item',
              timestamp: 2_000,
              url: null,
              engagement: null,
              attachments: null,
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 2_100,
            },
            context: { older: [], newer: [] },
          });
        }

        if (parsed.pathname === '/api/v1/items/item-2') {
          return secondRequest.promise;
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    const { result, rerender } = renderHook((props: { itemId: string }) => useRawItemView(props), {
      initialProps: { itemId: 'item-1' },
    });

    await waitFor(() => {
      expect(result.current.item?.id).toBe('item-1');
    });

    rerender({ itemId: 'item-2' });

    expect(result.current.routeState).toBe('loading');
    expect(result.current.item).toBeNull();

    secondRequest.resolve(
      jsonResponse({
        item: {
          id: 'item-2',
          source: 'discord',
          sourceId: 'guild:alpha',
          author: 'bob',
          content: 'Second item',
          timestamp: 3_000,
          url: null,
          engagement: null,
          attachments: null,
          originalLanguage: 'eng',
          translated: false,
          filterReason: null,
          status: 'processed',
          createdAt: 3_100,
        },
        context: { older: [], newer: [] },
      }),
    );

    await waitFor(() => {
      expect(result.current.item?.id).toBe('item-2');
    });
  });

  it('does not fetch and stays not-found when the route has no item id', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useRawItemView({ itemId: '' }));

    expect(result.current.routeState).toBe('not_found');
    expect(result.current.loading).toBe(false);
    expect(result.current.item).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the current item ready while loading a larger context window for the same item', async () => {
    const expandedRequest = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/items/item-1') {
        const contextSize = parsed.searchParams.get('context');

        if (contextSize === '3') {
          return jsonResponse({
            item: {
              id: 'item-1',
              source: 'discord',
              sourceId: 'guild:alpha',
              author: 'alice',
              content: 'Focused message',
              timestamp: 2_000,
              url: null,
              engagement: null,
              attachments: null,
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 2_100,
            },
            context: {
              older: [
                {
                  id: 'item-older',
                  source: 'discord',
                  sourceId: 'guild:alpha',
                  author: 'bob',
                  content: 'Earlier message',
                  timestamp: 1_000,
                  url: null,
                  engagement: null,
                  attachments: null,
                  originalLanguage: 'eng',
                  translated: false,
                  filterReason: null,
                  status: 'processed',
                  createdAt: 1_100,
                },
              ],
              newer: [],
            },
          });
        }

        if (contextSize === '6') {
          return expandedRequest.promise;
        }
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      (props: { itemId: string; contextSize: number }) => useRawItemView(props),
      {
        initialProps: { itemId: 'item-1', contextSize: 3 },
      },
    );

    await waitFor(() => {
      expect(result.current.routeState).toBe('ready');
    });

    expect(result.current.contextItems.older.map((item) => item.id)).toEqual(['item-older']);

    rerender({ itemId: 'item-1', contextSize: 6 });

    expect(result.current.routeState).toBe('ready');
    expect(result.current.contextLoading).toBe(true);
    expect(result.current.item?.id).toBe('item-1');
    expect(result.current.contextItems.older.map((item) => item.id)).toEqual(['item-older']);

    expandedRequest.resolve(
      jsonResponse({
        item: {
          id: 'item-1',
          source: 'discord',
          sourceId: 'guild:alpha',
          author: 'alice',
          content: 'Focused message',
          timestamp: 2_000,
          url: null,
          engagement: null,
          attachments: null,
          originalLanguage: 'eng',
          translated: false,
          filterReason: null,
          status: 'processed',
          createdAt: 2_100,
        },
        context: {
          older: [
            {
              id: 'item-oldest',
              source: 'discord',
              sourceId: 'guild:alpha',
              author: 'eve',
              content: 'Much earlier message',
              timestamp: 500,
              url: null,
              engagement: null,
              attachments: null,
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 600,
            },
            {
              id: 'item-older',
              source: 'discord',
              sourceId: 'guild:alpha',
              author: 'bob',
              content: 'Earlier message',
              timestamp: 1_000,
              url: null,
              engagement: null,
              attachments: null,
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 1_100,
            },
          ],
          newer: [
            {
              id: 'item-newer',
              source: 'discord',
              sourceId: 'guild:alpha',
              author: 'charlie',
              content: 'Later message',
              timestamp: 3_000,
              url: null,
              engagement: null,
              attachments: null,
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 3_100,
            },
          ],
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.contextItems.older.map((item) => item.id)).toEqual(['item-oldest', 'item-older']);
    });

    expect(result.current.contextLoading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the current item and context visible when a wider source-context fetch fails, then retries on demand', async () => {
    let expandedAttemptCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/items/item-1') {
        const contextSize = parsed.searchParams.get('context');

        if (contextSize === '3') {
          return jsonResponse({
            item: {
              id: 'item-1',
              source: 'discord',
              sourceId: 'guild:alpha',
              author: 'alice',
              content: 'Focused message',
              timestamp: 2_000,
              url: null,
              engagement: null,
              attachments: null,
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 2_100,
            },
            context: {
              older: [
                {
                  id: 'item-older',
                  source: 'discord',
                  sourceId: 'guild:alpha',
                  author: 'bob',
                  content: 'Earlier message',
                  timestamp: 1_000,
                  url: null,
                  engagement: null,
                  attachments: null,
                  originalLanguage: 'eng',
                  translated: false,
                  filterReason: null,
                  status: 'processed',
                  createdAt: 1_100,
                },
              ],
              newer: [],
            },
          });
        }

        if (contextSize === '6') {
          expandedAttemptCount += 1;

          if (expandedAttemptCount === 1) {
            throw new Error('boom');
          }

          return jsonResponse({
            item: {
              id: 'item-1',
              source: 'discord',
              sourceId: 'guild:alpha',
              author: 'alice',
              content: 'Focused message',
              timestamp: 2_000,
              url: null,
              engagement: null,
              attachments: null,
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 2_100,
            },
            context: {
              older: [
                {
                  id: 'item-oldest',
                  source: 'discord',
                  sourceId: 'guild:alpha',
                  author: 'eve',
                  content: 'Much earlier message',
                  timestamp: 500,
                  url: null,
                  engagement: null,
                  attachments: null,
                  originalLanguage: 'eng',
                  translated: false,
                  filterReason: null,
                  status: 'processed',
                  createdAt: 600,
                },
                {
                  id: 'item-older',
                  source: 'discord',
                  sourceId: 'guild:alpha',
                  author: 'bob',
                  content: 'Earlier message',
                  timestamp: 1_000,
                  url: null,
                  engagement: null,
                  attachments: null,
                  originalLanguage: 'eng',
                  translated: false,
                  filterReason: null,
                  status: 'processed',
                  createdAt: 1_100,
                },
              ],
              newer: [],
            },
          });
        }
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      (props: { itemId: string; contextSize: number }) => useRawItemView(props),
      {
        initialProps: { itemId: 'item-1', contextSize: 3 },
      },
    );

    await waitFor(() => {
      expect(result.current.routeState).toBe('ready');
    });

    rerender({ itemId: 'item-1', contextSize: 6 });

    await waitFor(() => {
      expect(result.current.contextError).toBe('Unable to load more source context. Please try again.');
    });

    expect(result.current.routeState).toBe('ready');
    expect(result.current.item?.id).toBe('item-1');
    expect(result.current.contextItems.older.map((item) => item.id)).toEqual(['item-older']);
    expect(result.current.contextLoading).toBe(false);

    result.current.retryContext();

    await waitFor(() => {
      expect(result.current.contextItems.older.map((item) => item.id)).toEqual(['item-oldest', 'item-older']);
    });

    expect(result.current.contextError).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
