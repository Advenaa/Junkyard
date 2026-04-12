import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../lib/api.js', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../lib/api.js';
import { Dashboard } from '../Dashboard';

const mockApiFetch = vi.mocked(apiFetch);

function buildDashboardResponses() {
  return {
    '/status': {
      itemsReady: 12,
      itemsProcessing: 3,
      summariesToday: 42,
      costToday: 12.345,
    },
    '/health': {
      overall: 'ok' as const,
      db: 'ok',
      services: {
        twitter: 'ok',
      },
    },
    '/reports?limit=1': {
      reports: [
        {
          id: 'report-1',
          type: 'daily',
          createdAt: Date.UTC(2026, 3, 13, 2, 0, 0),
          thesis: 'Market breadth is improving as BTC strength spills into higher-beta rotation.',
          macroRegime: 'risk-on',
          macroConfidence: 0.82,
          keyEvents: [
            'BTC cleared a local resistance band on higher spot demand.',
            'ETH beta caught up as majors started to broaden participation.',
          ],
          narrativeShifts: [
            'Meme rotation cooled while infrastructure stories picked up.',
            'Funding normalized after the weekend squeeze.',
          ],
        },
      ],
    },
    '/price-watch': {
      entries: [
        {
          entityId: 'btc',
          entityName: 'Bitcoin',
          price: 95123.45,
          change24h: 4.2,
          sentiment: 0.42,
          previousSentiment: 0.31,
          priceHistory: [
            { x: 1, y: 92000 },
            { x: 2, y: 93100 },
            { x: 3, y: 94050 },
            { x: 4, y: 95123.45 },
          ],
        },
      ],
    },
    '/first-movers?limit=6': {
      entries: [
        {
          entityId: 'sol',
          entityName: 'Solana',
          authorName: 'trader_alex',
          platform: 'X',
          detectedAt: Date.now() - 60 * 60 * 1000,
        },
      ],
    },
    '/alpha-watch?limit=6': {
      entries: [
        {
          entityId: 'hyper',
          entityName: 'Hyperliquid',
          tier: 'A1',
          propagationSummary: 'Perp flow chatter is spreading from niche desks into larger accounts.',
        },
      ],
    },
    '/unusual-activity': {
      entries: [
        {
          entityId: 'aave',
          entityName: 'Aave',
          description: 'Borrow demand spiked against the prior week baseline after stablecoin inflows accelerated.',
        },
      ],
    },
  };
}

function installSuccessfulMock(overrides: Record<string, unknown> = {}) {
  const responses = {
    ...buildDashboardResponses(),
    ...overrides,
  };

  mockApiFetch.mockImplementation(async (path) => {
    if (typeof path !== 'string' || !(path in responses)) {
      throw new Error(`Unhandled path ${String(path)}`);
    }

    return responses[path as keyof typeof responses] as never;
  });
}

describe('Dashboard', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    window.localStorage.clear();
  });

  it('renders loading skeletons initially', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(screen.getAllByLabelText('Loading').length).toBeGreaterThan(0);
  });

  it('renders the status strip with the health dot when data loads', async () => {
    installSuccessfulMock();

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByLabelText('System health: ok')).toBeInTheDocument());
    expect(screen.getByText('$12.35')).toBeInTheDocument();
    expect(screen.getByText('15 items')).toBeInTheDocument();
    expect(screen.getByText('42 summaries')).toBeInTheDocument();
  });

  it('renders the thesis blockquote from the latest report', async () => {
    installSuccessfulMock();

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('Market breadth is improving as BTC strength spills into higher-beta rotation.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Risk-on')).toBeInTheDocument();
    expect(screen.getByText('82% confidence')).toBeInTheDocument();
  });

  it('renders entity cards in the mover section', async () => {
    installSuccessfulMock();

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await screen.findByText('Price Watch');
    expect(await screen.findByRole('link', { name: 'Bitcoin' })).toHaveAttribute('href', '/entities/btc');
    expect(screen.getByText('$95,123.45')).toBeInTheDocument();
    expect(screen.getByText('+4.2%')).toBeInTheDocument();
    expect(screen.getByText('0.42 ↑')).toBeInTheDocument();
  });

  it('shows an error state for a failed section without crashing the others', async () => {
    installSuccessfulMock();
    mockApiFetch.mockImplementation(async (path) => {
      if (path === '/unusual-activity') {
        throw new Error('boom');
      }

      const responses = buildDashboardResponses();
      if (typeof path !== 'string' || !(path in responses)) {
        throw new Error(`Unhandled path ${String(path)}`);
      }

      return responses[path as keyof typeof responses] as never;
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Failed to load')).toBeInTheDocument());
    expect(
      screen.getByText('Market breadth is improving as BTC strength spills into higher-beta rotation.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bitcoin' })).toBeInTheDocument();
  });

  it('renders the full report link', async () => {
    installSuccessfulMock();

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: /Read full report/i })).toHaveAttribute('href', '/reports/report-1');
  });
});
