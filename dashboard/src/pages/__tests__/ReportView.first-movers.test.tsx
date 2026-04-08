import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportView } from '../ReportView';

function makeFullReport(overrides?: Record<string, unknown>) {
  return {
    id: 'report-first-movers-1',
    date: '2026-04-08',
    type: 'daily',
    tldr: 'Ethereum chatter broadened after one monitored voice surfaced the setup early.',
    sentiment: 0.22,
    deliveryStatus: 'delivered',
    createdAt: Date.now(),
    body: '{}',
    keyEvents: ['Ethereum regained attention after audit chatter accelerated.'],
    marketCatalysts: [],
    eventChains: [],
    firstMovers: [],
    priceAlerts: [],
    unusualActivity: [],
    macroAlerts: [],
    macroRegime: null,
    macroRegimeHistory: null,
    chainDrilldowns: [],
    entitySentiment: [{ name: 'Ethereum', sentiment: 0.22, reason: 'L2 adoption optimism improved.' }],
    sections: [{ title: 'Overview', body: 'One early monitored call shaped the follow-on discussion.' }],
    ...overrides,
  };
}

function buildReportFetchMock(
  report: ReturnType<typeof makeFullReport>,
  watchlist = { latestTimestamp: null as number | null, entries: [] as Array<Record<string, unknown>> },
  latestRoute = false,
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url, 'http://localhost');
    const path = requestUrl.pathname;

    if (path === '/api/v1/narratives') {
      return new Response(JSON.stringify({ latestDate: null, entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/macro') {
      return new Response(JSON.stringify({ error: 'No macro data available yet' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/price-watch') {
      return new Response(JSON.stringify({ latestTimestamp: null, entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/unusual-activity') {
      return new Response(JSON.stringify({ latestDate: null, entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/divergence') {
      return new Response(JSON.stringify({ divergences: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/first-movers') {
      return new Response(JSON.stringify(watchlist), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/alpha-watch') {
      return new Response(JSON.stringify({ latestTimestamp: null, entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/calendar-events') {
      return new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (latestRoute && path === '/api/v1/reports') {
      return new Response(JSON.stringify({ reports: [{ id: report.id }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === `/api/v1/reports/${report.id}`) {
      return new Response(JSON.stringify({ report }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unhandled fetch ${path}${requestUrl.search}`);
  });
}

describe('ReportView first movers', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows First Mover Watch on the latest report route when tracked entries are available', async () => {
    const report = makeFullReport();
    const watchlist = {
      latestTimestamp: Date.UTC(2026, 3, 8, 9, 30, 0),
      entries: [
        {
          entityId: 'eth',
          entityName: 'Ethereum',
          authorId: 'auth-1',
          platform: 'twitter',
          handle: 'defidad',
          displayName: 'DeFi Dad',
          claimType: 'bullish',
          claimText: 'ETH breakout likely if ETF chatter sticks.',
          sourceItemId: 'item-1',
          timestamp: Date.UTC(2026, 3, 8, 9, 30, 0),
          nextTrackedCallTime: Date.UTC(2026, 3, 8, 13, 30, 0),
          leadWindowMs: 4 * 60 * 60 * 1000,
          credibilityScore: 0.8,
          totalCalls: 5,
          correctCalls: 4,
        },
      ],
    };

    vi.stubGlobal('fetch', buildReportFetchMock(report, watchlist, true));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('First Mover Watch');
    expect(screen.getByText(report.tldr)).toBeInTheDocument();
    expect(screen.getByText(/Detailed author timing and review history remain in Settings/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ethereum' })).toBeInTheDocument();
    expect(screen.getByText('First tracked by DeFi Dad (defidad).')).toBeInTheDocument();
    expect(screen.getByText('bullish')).toBeInTheDocument();
    expect(screen.getByText('"ETH breakout likely if ETF chatter sticks."')).toBeInTheDocument();
    expect(screen.getByText('lead 4h')).toBeInTheDocument();
    expect(screen.getByText('4/5 reviewed correct')).toBeInTheDocument();
    expect(screen.getByText('1 recent')).toBeInTheDocument();
  });

  it('shows First Movers section when firstMovers entries are present', async () => {
    const report = makeFullReport({
      firstMovers: ['Ethereum was first tracked by DeFi Dad roughly 4h before the next monitored call.'],
    });

    vi.stubGlobal('fetch', buildReportFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('First Movers');
    expect(
      screen.getByText('Ethereum was first tracked by DeFi Dad roughly 4h before the next monitored call.'),
    ).toBeInTheDocument();
  });

  it('does not show First Movers section when firstMovers array is empty', async () => {
    const report = makeFullReport({
      firstMovers: [],
    });

    vi.stubGlobal('fetch', buildReportFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(report.tldr);
    expect(screen.queryByText('First Movers')).not.toBeInTheDocument();
  });
});
