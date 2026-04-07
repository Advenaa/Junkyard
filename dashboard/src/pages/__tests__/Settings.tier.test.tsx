import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: 'tier-admin',
      avatar: null,
      role: 'admin' as const,
    },
    loading: false,
    logout: vi.fn(),
  }),
}));

function buildFetchMock(sources: unknown[] = []) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url, 'http://localhost');
    const path = parsed.pathname;

    if (path === '/api/v1/sources') {
      return new Response(JSON.stringify({ sources }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path === '/api/v1/discord/tokens') {
      return new Response(JSON.stringify({ tokens: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path === '/api/v1/discord/tokens/health') {
      return new Response(JSON.stringify({ states: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path === '/api/v1/status') {
      return new Response(JSON.stringify({ itemsReady: 0, itemsProcessing: 0, summariesToday: 0, costToday: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

describe('Settings source tier display', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows tier for sources in the source list', async () => {
    const sources = [
      {
        source: 'discord',
        sourceId: 'alpha-group',
        label: 'Alpha Discord',
        enabled: true,
        pollInterval: 300,
        lastFetchedAt: null,
        errorCount: 0,
        lastError: null,
        status: 'ready',
        stateStatus: 'active',
        tier: 'alpha',
      },
    ];
    vi.stubGlobal('fetch', buildFetchMock(sources));

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Alpha Discord')).toBeInTheDocument();
    });

    // The Tier column header should be visible
    expect(screen.getByText('Tier')).toBeInTheDocument();
    // The tier select should be present with the alpha option
    const selects = screen.getAllByRole('combobox');
    const tierSelect = selects.find((s) => (s as HTMLSelectElement).value === 'alpha');
    expect(tierSelect).toBeTruthy();
  });

  it('shows general tier by default', async () => {
    const sources = [
      {
        source: 'rss',
        sourceId: 'https://feed.example.com',
        label: 'Example Feed',
        enabled: true,
        pollInterval: 3600,
        lastFetchedAt: null,
        errorCount: 0,
        lastError: null,
        status: 'ready',
        stateStatus: 'active',
        tier: 'general',
      },
    ];
    vi.stubGlobal('fetch', buildFetchMock(sources));

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Example Feed')).toBeInTheDocument();
    });
  });
});
