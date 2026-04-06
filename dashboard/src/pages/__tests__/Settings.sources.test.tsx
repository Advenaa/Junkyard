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
});
