import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: 'narrative-admin',
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

interface NarrativeWatchlistOverview {
  latestDate: string | null;
  entries: Array<{
    id: string;
    name: string;
    date: string;
    memberCount: number;
    avgSentiment: number | null;
    signalStrength: 'new' | 'emerging' | 'strong' | 'stable' | 'fading';
  }>;
}

interface NarrativeDrilldown {
  narrative: {
    id: string;
    name: string;
    date: string;
    memberCount: number;
    avgSentiment: number | null;
    signalStrength: 'new' | 'emerging' | 'strong' | 'stable' | 'fading';
    summaries: Array<{
      id: string;
      source: string;
      sourceId: string;
      sentiment: number | null;
      urgency: 'routine' | 'elevated' | 'breaking' | null;
      itemCount: number;
      createdAt: number;
      text: string;
    }>;
  };
}

function buildFetchMock(
  narratives: NarrativeWatchlistOverview,
  narrativeDetails: Record<string, NarrativeDrilldown> = {},
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url, 'http://localhost');
    const path = requestUrl.pathname;
    const method = init?.method ?? 'GET';

    if (path === '/api/v1/sources' && method === 'GET') {
      return new Response(JSON.stringify({ sources: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/discord/tokens' && method === 'GET') {
      return new Response(JSON.stringify({ tokens: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/discord/tokens/health' && method === 'GET') {
      return new Response(JSON.stringify({ states: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/status' && method === 'GET') {
      return new Response(JSON.stringify({ itemsReady: 4, itemsProcessing: 1, summariesToday: 9, costToday: 1.42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/health' && method === 'GET') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          checks: [{ name: 'db', status: 'ok', message: 'healthy' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    if (path === '/api/v1/macro' && method === 'GET') {
      return new Response(JSON.stringify({ error: 'No macro data available yet' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/unusual-activity' && method === 'GET') {
      return new Response(JSON.stringify({ latestDate: '2026-04-08', entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/narratives' && method === 'GET') {
      return new Response(JSON.stringify(narratives), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path.startsWith('/api/v1/narratives/') && method === 'GET') {
      const narrativeId = path.slice('/api/v1/narratives/'.length);
      const narrative = narrativeDetails[narrativeId];
      if (!narrative) {
        return new Response(JSON.stringify({ error: 'Narrative not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(narrative), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/calendar-events' && method === 'GET') {
      return new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unhandled fetch ${method} ${path}`);
  });
}

describe('Settings narrative watchlist card', () => {
  function renderSettings() {
    return render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows recent narrative clusters in the Pipeline tab', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock({
        latestDate: '2026-04-08',
        entries: [
          {
            id: 'nar-sol',
            name: 'Solana fee rebound',
            date: '2026-04-08',
            memberCount: 6,
            avgSentiment: 0.42,
            signalStrength: 'emerging',
          },
          {
            id: 'nar-btc',
            name: 'BTC treasury chatter',
            date: '2026-04-08',
            memberCount: 4,
            avgSentiment: -0.15,
            signalStrength: 'fading',
          },
        ],
      }),
    );

    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', { name: 'Pipeline' }));

    await screen.findByText('Narrative Watchlist');
    expect(screen.getByText('2026-04-08')).toBeInTheDocument();
    expect(screen.getByText('Solana fee rebound')).toBeInTheDocument();
    expect(screen.getByText('Emerging')).toBeInTheDocument();
    expect(screen.getByText('6 summaries clustered')).toBeInTheDocument();
    expect(screen.getByText('sentiment +0.42')).toBeInTheDocument();
    expect(screen.getByText('BTC treasury chatter')).toBeInTheDocument();
    expect(screen.getByText('Fading')).toBeInTheDocument();
    expect(screen.getByText('sentiment -0.15')).toBeInTheDocument();
  });

  it('loads clustered summaries inline for a selected narrative', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock(
        {
          latestDate: '2026-04-08',
          entries: [
            {
              id: 'nar-sol',
              name: 'Solana fee rebound',
              date: '2026-04-08',
              memberCount: 6,
              avgSentiment: 0.42,
              signalStrength: 'emerging',
            },
          ],
        },
        {
          'nar-sol': {
            narrative: {
              id: 'nar-sol',
              name: 'Solana fee rebound',
              date: '2026-04-08',
              memberCount: 6,
              avgSentiment: 0.42,
              signalStrength: 'emerging',
              summaries: [
                {
                  id: 'sum-2',
                  source: 'twitter',
                  sourceId: '@solwatch',
                  sentiment: 0.61,
                  urgency: 'elevated',
                  itemCount: 5,
                  createdAt: Date.now() - 5 * 60 * 1000,
                  text: 'CT is reviving the Solana fee rebound trade after validators stabilized fees.',
                },
                {
                  id: 'sum-1',
                  source: 'discord',
                  sourceId: 'chan-1',
                  sentiment: 0.33,
                  urgency: 'routine',
                  itemCount: 3,
                  createdAt: Date.now() - 60 * 60 * 1000,
                  text: 'Discord traders are echoing the same Solana setup across multiple rooms.',
                },
              ],
            },
          },
        },
      ),
    );

    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', { name: 'Pipeline' }));
    await screen.findByText('Narrative Watchlist');

    await user.click(screen.getByRole('button', { name: 'Show summaries for Solana fee rebound' }));

    await screen.findByText('Most recent clustered summaries');
    expect(
      screen.getByText('CT is reviving the Solana fee rebound trade after validators stabilized fees.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Showing 2 of 6 summaries linked to this narrative.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open summary' })[0]).toHaveAttribute('href', '/summaries/sum-2');
    expect(screen.getByText('urgency elevated')).toBeInTheDocument();
  });

  it('shows an empty state when no narratives have been clustered yet', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ latestDate: null, entries: [] }));

    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', { name: 'Pipeline' }));

    await screen.findByText('No narrative clusters yet');
    expect(
      screen.getByText(
        'Narratives appear here after the daily clustering pass has enough summary embeddings to form stable groups.',
      ),
    ).toBeInTheDocument();
  });
});
