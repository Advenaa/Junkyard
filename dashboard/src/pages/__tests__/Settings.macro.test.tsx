import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: 'macro-admin',
      avatar: null,
      role: 'admin' as const,
    },
    loading: false,
    logout: vi.fn(),
  }),
}));

interface MacroOverviewEntry {
  indicator: 'vix' | 'dxy' | 'us10y' | 'spx' | 'gold';
  label: string;
  value: number;
  change1d: number | null;
  change7d: number | null;
  date: string;
  signal: 'risk-on' | 'risk-off' | 'neutral';
  narrative: string;
}

interface MacroOverview {
  overallBias: 'risk-on' | 'risk-off' | 'mixed';
  latestDate: string | null;
  entries: MacroOverviewEntry[];
}

function buildFetchMock(macroOverview: MacroOverview | null) {
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

    if (path === '/api/v1/calendar-events' && method === 'GET') {
      return new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/macro' && method === 'GET') {
      if (macroOverview == null) {
        return new Response(JSON.stringify({ error: 'No macro data available yet' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(macroOverview), {
        status: 200,
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
      return new Response(JSON.stringify({ latestDate: '2026-04-08', entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unhandled fetch ${method} ${path}`);
  });
}

describe('Settings macro backdrop card', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows macro bias and indicator cards in the Pipeline tab when macro data exists', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock({
        overallBias: 'risk-off',
        latestDate: '2026-04-08',
        entries: [
          {
            indicator: 'vix',
            label: 'VIX',
            value: 21.9,
            change1d: 1.1,
            change7d: 3.9,
            date: '2026-04-08',
            signal: 'risk-off',
            narrative: 'volatility rising',
          },
          {
            indicator: 'spx',
            label: 'S&P 500',
            value: 5234,
            change1d: -35,
            change7d: -102,
            date: '2026-04-08',
            signal: 'risk-off',
            narrative: 'equities fading',
          },
          {
            indicator: 'gold',
            label: 'Gold',
            value: 2331.45,
            change1d: 18.2,
            change7d: 44.6,
            date: '2026-04-08',
            signal: 'risk-off',
            narrative: 'gold firming',
          },
        ],
      }),
    );

    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole('button', { name: 'Pipeline' }));

    await screen.findByText('Macro Backdrop');
    expect(screen.getByLabelText('Overall macro bias risk-off')).toBeInTheDocument();
    expect(screen.getByText('Latest snapshot date')).toBeInTheDocument();
    expect(screen.getByText('2026-04-08')).toBeInTheDocument();
    expect(screen.getByText('VIX')).toBeInTheDocument();
    expect(screen.getByText('volatility rising')).toBeInTheDocument();
    expect(screen.getByText('1d change +1.10')).toBeInTheDocument();
    expect(screen.getByText('S&P 500')).toBeInTheDocument();
    expect(screen.getByText('equities fading')).toBeInTheDocument();
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByText('gold firming')).toBeInTheDocument();
  });

  it('shows an empty state when no macro snapshots are available yet', async () => {
    vi.stubGlobal('fetch', buildFetchMock(null));

    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole('button', { name: 'Pipeline' }));

    await screen.findByText('No macro snapshots yet');
    expect(
      screen.getByText('Macro indicators appear here after the daily FRED refresh runs with FRED_API_KEY configured.'),
    ).toBeInTheDocument();
  });
});
