import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: 'source-admin',
      avatar: null,
      role: 'admin' as const,
    },
    loading: false,
    logout: vi.fn(),
  }),
}));
vi.mock('../../components/StatusProvider', () => {
  const statusValue = {
    ready: true,
    status: { itemsReady: 0, itemsProcessing: 0, summariesToday: 0, costToday: 0, disabledFeatures: [] },
    disabledFeatures: [],
    isFeatureDisabled: () => false,
    getDisabledFeature: () => null,
    registerDisabledFeature: vi.fn(),
  };
  return { useStatus: () => statusValue };
});

describe('Settings source management', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('deletes sources via query-string sourceId and shows a fallback name for null labels', async () => {
    const sources = [
      {
        source: 'rss',
        sourceId: 'https://feeds.example.com/alpha.xml?view=latest',
        label: null,
        enabled: true,
        pollInterval: 300,
        lastFetchedAt: null,
        errorCount: 0,
        lastError: null,
        status: 'ready',
        stateStatus: 'active',
      },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');
        const method = init?.method ?? 'GET';

        if (parsed.pathname === '/api/v1/sources' && method === 'GET') {
          return new Response(JSON.stringify({ sources }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (parsed.pathname === '/api/v1/discord/tokens' && method === 'GET') {
          return new Response(JSON.stringify({ tokens: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (parsed.pathname === '/api/v1/discord/tokens/health' && method === 'GET') {
          return new Response(JSON.stringify({ states: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (parsed.pathname === '/api/v1/sources/rss' && method === 'DELETE') {
          expect(parsed.searchParams.get('sourceId')).toBe('https://feeds.example.com/alpha.xml?view=latest');
          sources.splice(0, 1);
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unhandled fetch ${method} ${parsed.pathname}${parsed.search}`);
      }),
    );

    const user = userEvent.setup();
    render(<Settings />);

    const sourceCell = await screen.findByText('https://feeds.example.com/alpha.xml?view=latest');
    const sourceRow = sourceCell.closest('tr');
    expect(sourceRow).not.toBeNull();

    await user.click(within(sourceRow!).getByTitle('Delete https://feeds.example.com/alpha.xml?view=latest'));

    const deleteDialog = await screen.findByRole('dialog', { name: 'Delete Source' });
    expect(within(deleteDialog).getByText('https://feeds.example.com/alpha.xml?view=latest')).toBeInTheDocument();

    await user.click(within(deleteDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.getByText('No sources configured')).toBeInTheDocument();
    });
  });

  it('updates poll interval inline via PATCH and refreshes the row display', async () => {
    const sources = [
      {
        source: 'rss',
        sourceId: 'https://feeds.example.com/alpha.xml',
        label: 'Alpha feed',
        enabled: true,
        pollInterval: 300,
        lastFetchedAt: null,
        errorCount: 0,
        lastError: null,
        status: 'ready',
        stateStatus: 'active',
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');
      const method = init?.method ?? 'GET';

      if (parsed.pathname === '/api/v1/sources' && method === 'GET') {
        return new Response(JSON.stringify({ sources }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (parsed.pathname === '/api/v1/discord/tokens' && method === 'GET') {
        return new Response(JSON.stringify({ tokens: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (parsed.pathname === '/api/v1/discord/tokens/health' && method === 'GET') {
        return new Response(JSON.stringify({ states: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (parsed.pathname === '/api/v1/sources/rss' && method === 'PATCH') {
        expect(parsed.searchParams.get('sourceId')).toBe('https://feeds.example.com/alpha.xml');
        const body = JSON.parse(String(init?.body ?? '{}')) as { poll_interval?: number };
        sources[0] = { ...sources[0], pollInterval: body.poll_interval ?? sources[0].pollInterval };
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unhandled fetch ${method} ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<Settings />);

    const sourceCell = await screen.findByText('Alpha feed');
    const sourceRow = sourceCell.closest('tr');
    expect(sourceRow).not.toBeNull();
    expect(within(sourceRow!).getByText('5m')).toBeInTheDocument();

    await user.dblClick(within(sourceRow!).getByTitle('Double-click to edit poll interval (seconds, 60–86400)'));

    const input = within(sourceRow!).getByRole('spinbutton', { name: 'Edit poll interval for Alpha feed' });
    await user.clear(input);
    await user.type(input, '600');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const [requestUrl, requestInit] = patchCall!;
      const url =
        typeof requestUrl === 'string'
          ? requestUrl
          : requestUrl instanceof URL
            ? requestUrl.toString()
            : requestUrl.url;
      expect(url).toContain('/sources/');
      expect(requestInit?.body).toContain('"poll_interval":600');
      expect(within(sourceRow!).getByText('10m')).toBeInTheDocument();
    });
  });
});
