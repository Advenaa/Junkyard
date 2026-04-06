import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { formatFocusedRawFeedGapLabel, useFocusedRawFeed } from '../useFocusedRawFeed';

describe('useFocusedRawFeed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads focused context for a hidden deep-linked item and formats the live-feed gap', async () => {
    const liveTimestamp = new Date('2026-01-15T12:00:00Z').getTime();
    const focusedTimestamp = liveTimestamp - 9 * 60_000;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/items/item-focus') {
          expect(parsed.searchParams.get('context')).toBe('2');
          return new Response(
            JSON.stringify({
              item: {
                id: 'item-focus',
                source: 'discord',
                sourceId: 'guild:beta',
                author: 'focus-user',
                content: 'Focused message',
                timestamp: focusedTimestamp,
                attachments: null,
                engagement: 0,
                status: 'processed',
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                url: null,
                createdAt: focusedTimestamp + 1_000,
              },
              context: {
                older: [],
                newer: [],
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    const { result } = renderHook(() =>
      useFocusedRawFeed({
        focusedItemId: 'item-focus',
        requestedSourceId: 'guild:beta',
        selectedSource: 'guild:beta',
        items: [{ id: 'item-latest', timestamp: liveTimestamp }],
        loading: false,
      }),
    );

    expect(result.current.focusedRawFeedActive).toBe(true);

    await waitFor(() => {
      expect(result.current.focusedContext?.item.id).toBe('item-focus');
    });

    expect(result.current.focusedContextLoading).toBe(false);
    expect(result.current.focusedGapLabel).toBe('Live feed resumes about 9 minutes later');
  });

  it('stays inactive when the focused item is already visible in the live feed', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useFocusedRawFeed({
        focusedItemId: 'item-focus',
        requestedSourceId: 'guild:beta',
        selectedSource: 'guild:beta',
        items: [{ id: 'item-focus', timestamp: 123 }],
        loading: false,
      }),
    );

    expect(result.current.focusedItemVisible).toBe(true);
    expect(result.current.focusedRawFeedActive).toBe(false);
    expect(result.current.focusedContext).toBeNull();
    expect(result.current.focusedGapLabel).toBe('Live feed resumes below');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears pinned context once the focused item becomes visible in the live feed', async () => {
    const liveTimestamp = new Date('2026-01-15T12:00:00Z').getTime();
    const focusedTimestamp = liveTimestamp - 9 * 60_000;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/items/item-focus') {
          return new Response(
            JSON.stringify({
              item: {
                id: 'item-focus',
                source: 'discord',
                sourceId: 'guild:beta',
                author: 'focus-user',
                content: 'Focused message',
                timestamp: focusedTimestamp,
                attachments: null,
                engagement: 0,
                status: 'processed',
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                url: null,
                createdAt: focusedTimestamp + 1_000,
              },
              context: {
                older: [],
                newer: [],
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    const initialProps = {
      focusedItemId: 'item-focus',
      requestedSourceId: 'guild:beta',
      selectedSource: 'guild:beta',
      items: [{ id: 'item-latest', timestamp: liveTimestamp }],
      loading: false,
    };

    const { result, rerender } = renderHook((props) => useFocusedRawFeed(props), { initialProps });

    await waitFor(() => {
      expect(result.current.focusedContext?.item.id).toBe('item-focus');
    });

    rerender({
      ...initialProps,
      items: [{ id: 'item-focus', timestamp: liveTimestamp }],
    });

    await waitFor(() => {
      expect(result.current.focusedContext).toBeNull();
    });

    expect(result.current.focusedItemVisible).toBe(true);
    expect(result.current.focusedRawFeedActive).toBe(false);
  });

  it('reloads focused context when the requested context size increases for the same item', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/items/item-focus') {
        const contextSize = parsed.searchParams.get('context');
        return new Response(
          JSON.stringify({
            item: {
              id: 'item-focus',
              source: 'discord',
              sourceId: 'guild:beta',
              author: 'focus-user',
              content: 'Focused message',
              timestamp: 1_000,
              attachments: null,
              engagement: 0,
              status: 'processed',
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              url: null,
              createdAt: 1_001,
            },
            context: {
              older:
                contextSize === '5'
                  ? [
                      {
                        id: 'item-earliest',
                        source: 'discord',
                        sourceId: 'guild:beta',
                        author: 'earliest-user',
                        content: 'Earlier message',
                        timestamp: 500,
                        attachments: null,
                        engagement: 0,
                        status: 'processed',
                        originalLanguage: 'eng',
                        translated: false,
                        filterReason: null,
                        url: null,
                        createdAt: 501,
                      },
                    ]
                  : [],
              newer: [],
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const initialProps = {
      focusedItemId: 'item-focus',
      requestedSourceId: 'guild:beta',
      selectedSource: 'guild:beta',
      items: [{ id: 'item-latest', timestamp: 2_000 }],
      loading: false,
      contextSize: 2,
    };

    const { result, rerender } = renderHook((props) => useFocusedRawFeed(props), { initialProps });

    await waitFor(() => {
      expect(result.current.focusedContext?.item.id).toBe('item-focus');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({
      ...initialProps,
      contextSize: 5,
    });

    await waitFor(() => {
      expect(result.current.focusedContext?.older[0]?.id).toBe('item-earliest');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the current focused citation visible when a wider context fetch fails and retries on demand', async () => {
    let expandedAttemptCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/items/item-focus') {
        const contextSize = parsed.searchParams.get('context');

        if (contextSize === '2') {
          return new Response(
            JSON.stringify({
              item: {
                id: 'item-focus',
                source: 'discord',
                sourceId: 'guild:beta',
                author: 'focus-user',
                content: 'Focused message',
                timestamp: 1_000,
                attachments: null,
                engagement: 0,
                status: 'processed',
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                url: null,
                createdAt: 1_001,
              },
              context: {
                older: [],
                newer: [],
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (contextSize === '5') {
          expandedAttemptCount += 1;

          if (expandedAttemptCount === 1) {
            throw new Error('boom');
          }

          return new Response(
            JSON.stringify({
              item: {
                id: 'item-focus',
                source: 'discord',
                sourceId: 'guild:beta',
                author: 'focus-user',
                content: 'Focused message',
                timestamp: 1_000,
                attachments: null,
                engagement: 0,
                status: 'processed',
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                url: null,
                createdAt: 1_001,
              },
              context: {
                older: [
                  {
                    id: 'item-earliest',
                    source: 'discord',
                    sourceId: 'guild:beta',
                    author: 'earliest-user',
                    content: 'Earlier message',
                    timestamp: 500,
                    attachments: null,
                    engagement: 0,
                    status: 'processed',
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    url: null,
                    createdAt: 501,
                  },
                ],
                newer: [],
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const initialProps = {
      focusedItemId: 'item-focus',
      requestedSourceId: 'guild:beta',
      selectedSource: 'guild:beta',
      items: [{ id: 'item-latest', timestamp: 2_000 }],
      loading: false,
      contextSize: 2,
    };

    const { result, rerender } = renderHook((props) => useFocusedRawFeed(props), { initialProps });

    await waitFor(() => {
      expect(result.current.focusedContext?.item.id).toBe('item-focus');
    });

    rerender({
      ...initialProps,
      contextSize: 5,
    });

    await waitFor(() => {
      expect(result.current.focusedContextError).toBe('Unable to load more context. Please try again.');
    });

    expect(result.current.focusedContext?.item.id).toBe('item-focus');
    expect(result.current.focusedContextLoading).toBe(false);
    expect(result.current.focusedContext?.older).toEqual([]);

    result.current.retryFocusedContext();

    await waitFor(() => {
      expect(result.current.focusedContext?.older[0]?.id).toBe('item-earliest');
    });

    expect(result.current.focusedContextError).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('formatFocusedRawFeedGapLabel', () => {
  it('returns a default label when the live feed is not later than the focused item', () => {
    expect(formatFocusedRawFeedGapLabel(100, 100)).toBe('Live feed resumes below');
  });
});
