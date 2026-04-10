import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRawFeedStream } from '../useRawFeedStream';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function decodedPath(parsed: URL): string {
  return decodeURIComponent(parsed.pathname);
}

describe('useRawFeedStream', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loads discord and twitter sources, drops rss/news, honors the requested source, and fetches the initial feed page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/sources') {
          return jsonResponse({
            sources: [
              { source: 'discord', sourceId: 'guild:alpha', label: 'Alpha Room' },
              { source: 'rss', sourceId: 'feed:macro', label: 'Macro Feed' },
              { source: 'twitter', sourceId: 'list:cabal', label: 'Cabal List' },
              { source: 'news', sourceId: 'news:bloomberg', label: 'Bloomberg' },
              { source: 'discord', sourceId: 'guild:beta', label: 'Beta Room' },
            ],
          });
        }

        if (decodedPath(parsed) === '/api/v1/feed/guild:beta') {
          expect(parsed.searchParams.get('limit')).toBe('2');
          expect(parsed.searchParams.get('offset')).toBe('0');
          return jsonResponse({
            items: [
              {
                id: 'item-beta',
                source: 'discord',
                author: 'beta-user',
                content: 'Beta room item',
                timestamp: 2_000,
                attachments: null,
                engagement: null,
              },
            ],
          });
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    const { result } = renderHook(() => useRawFeedStream({ requestedSourceId: 'guild:beta', pageSize: 2 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.sources.map((source) => source.sourceId)).toEqual([
      'guild:alpha',
      'list:cabal',
      'guild:beta',
    ]);
    expect(result.current.sources.map((source) => source.source)).toEqual(['discord', 'twitter', 'discord']);
    expect(result.current.sourcesLoaded).toBe(true);
    expect(result.current.selectedSource).toBe('guild:beta');
    expect(result.current.items.map((item) => item.id)).toEqual(['item-beta']);
  });

  it('selects the first feed-eligible source when none is requested, even if it is twitter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/sources') {
          return jsonResponse({
            sources: [
              { source: 'rss', sourceId: 'feed:macro', label: 'Macro Feed' },
              { source: 'twitter', sourceId: 'list:cabal', label: 'Cabal List' },
              { source: 'discord', sourceId: 'guild:beta', label: 'Beta Room' },
            ],
          });
        }

        if (decodedPath(parsed) === '/api/v1/feed/list:cabal') {
          return jsonResponse({
            items: [
              {
                id: 'item-tweet',
                source: 'twitter',
                author: 'cabal-user',
                content: 'Cabal tweet',
                timestamp: 3_000,
                attachments: null,
                engagement: null,
              },
            ],
          });
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    const { result } = renderHook(() => useRawFeedStream({ requestedSourceId: '', pageSize: 2 }));

    await waitFor(() => {
      expect(result.current.selectedSource).toBe('list:cabal');
    });

    await waitFor(() => {
      expect(result.current.items.map((item) => item.id)).toEqual(['item-tweet']);
    });
  });

  it('falls back to the first discord source when no source is requested', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/sources') {
          return jsonResponse({
            sources: [
              { source: 'discord', sourceId: 'guild:alpha', label: 'Alpha Room' },
              { source: 'discord', sourceId: 'guild:beta', label: 'Beta Room' },
            ],
          });
        }

        if (decodedPath(parsed) === '/api/v1/feed/guild:alpha') {
          return jsonResponse({
            items: [
              {
                id: 'item-alpha',
                source: 'discord',
                author: 'alpha-user',
                content: 'Alpha room item',
                timestamp: 1_000,
                attachments: null,
                engagement: null,
              },
            ],
          });
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    const { result } = renderHook(() => useRawFeedStream({ requestedSourceId: '', pageSize: 2 }));

    await waitFor(() => {
      expect(result.current.selectedSource).toBe('guild:alpha');
    });

    await waitFor(() => {
      expect(result.current.items.map((item) => item.id)).toEqual(['item-alpha']);
    });
  });

  it('URL-encodes twitter source IDs that contain reserved path characters', async () => {
    const requestedPaths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/sources') {
          return jsonResponse({
            sources: [{ source: 'twitter', sourceId: '#cabal OR ETH', label: 'Cabal Search' }],
          });
        }

        if (parsed.pathname.startsWith('/api/v1/feed/')) {
          requestedPaths.push(parsed.pathname);
          return jsonResponse({ items: [] });
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    const { result } = renderHook(() => useRawFeedStream({ requestedSourceId: '', pageSize: 2 }));

    await waitFor(() => {
      expect(result.current.selectedSource).toBe('#cabal OR ETH');
    });

    await waitFor(() => {
      expect(requestedPaths.length).toBeGreaterThan(0);
    });

    // Path segment must be percent-encoded so reserved chars don't truncate at '#' or split on '/'.
    expect(requestedPaths[0]).toBe(`/api/v1/feed/${encodeURIComponent('#cabal OR ETH')}`);
    // Round-trip back to the original via decoding.
    expect(decodeURIComponent(requestedPaths[0])).toBe('/api/v1/feed/#cabal OR ETH');
  });

  it('appends only new items when loading more pages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/sources') {
          return jsonResponse({
            sources: [{ source: 'discord', sourceId: 'guild:beta', label: 'Beta Room' }],
          });
        }

        if (decodedPath(parsed) === '/api/v1/feed/guild:beta' && parsed.searchParams.get('offset') === '0') {
          return jsonResponse({
            items: [
              {
                id: 'item-1',
                source: 'discord',
                author: 'beta-user',
                content: 'First item',
                timestamp: 2_000,
                attachments: null,
                engagement: null,
              },
              {
                id: 'item-2',
                source: 'discord',
                author: 'beta-user',
                content: 'Second item',
                timestamp: 1_000,
                attachments: null,
                engagement: null,
              },
            ],
          });
        }

        if (decodedPath(parsed) === '/api/v1/feed/guild:beta' && parsed.searchParams.get('offset') === '2') {
          return jsonResponse({
            items: [
              {
                id: 'item-2',
                source: 'discord',
                author: 'beta-user',
                content: 'Second item',
                timestamp: 1_000,
                attachments: null,
                engagement: null,
              },
              {
                id: 'item-3',
                source: 'discord',
                author: 'beta-user',
                content: 'Third item',
                timestamp: 500,
                attachments: null,
                engagement: null,
              },
            ],
          });
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    const { result } = renderHook(() => useRawFeedStream({ requestedSourceId: 'guild:beta', pageSize: 2 }));

    await waitFor(() => {
      expect(result.current.items.map((item) => item.id)).toEqual(['item-1', 'item-2']);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.items.map((item) => item.id)).toEqual(['item-1', 'item-2', 'item-3']);
  });

  it('polls for newer items while live and stops polling once paused', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/sources') {
        return jsonResponse({
          sources: [{ source: 'discord', sourceId: 'guild:beta', label: 'Beta Room' }],
        });
      }

      if (decodedPath(parsed) === '/api/v1/feed/guild:beta' && !parsed.searchParams.has('after')) {
        return jsonResponse({
          items: [
            {
              id: 'item-1',
              source: 'discord',
              author: 'beta-user',
              content: 'First item',
              timestamp: 1_000,
              attachments: null,
              engagement: null,
            },
          ],
        });
      }

      if (decodedPath(parsed) === '/api/v1/feed/guild:beta' && parsed.searchParams.get('after') === '1000') {
        return jsonResponse({
          items: [
            {
              id: 'item-2',
              source: 'discord',
              author: 'beta-user',
              content: 'Second item',
              timestamp: 2_000,
              attachments: null,
              engagement: null,
            },
          ],
        });
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useRawFeedStream({
        requestedSourceId: 'guild:beta',
        pageSize: 2,
        pollIntervalMs: 1_000,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.items.map((item) => item.id)).toEqual(['item-1']);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(result.current.items.map((item) => item.id)).toEqual(['item-2', 'item-1']);

    act(() => {
      result.current.setLive(false);
    });

    const callsAfterPause = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(fetchMock.mock.calls).toHaveLength(callsAfterPause);
  });
});
