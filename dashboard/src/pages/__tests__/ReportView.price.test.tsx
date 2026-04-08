import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportView } from '../ReportView';

// ── Shared helpers ─────────────────────────────────────────────────────

function makeFullReport(overrides?: Record<string, unknown>) {
  return {
    id: 'report-price-1',
    date: '2026-04-07',
    type: 'daily',
    tldr: 'Crypto markets showing strength with BTC pushing past key levels.',
    sentiment: 0.5,
    deliveryStatus: 'delivered',
    createdAt: Date.now(),
    body: '{}',
    keyEvents: ['BTC broke $68K on strong spot demand.'],
    marketCatalysts: ['CPI data release tomorrow could set short-term direction.'],
    eventChains: [],
    chainDrilldowns: [],
    priceAlerts: [],
    entitySentiment: [{ name: 'Bitcoin', sentiment: 0.55, reason: 'Spot demand' }],
    sections: [{ title: 'Overview', body: 'Market structure remains bullish.' }],
    ...overrides,
  };
}

function buildReportFetchMock(
  report: ReturnType<typeof makeFullReport>,
  priceWatchOverview: {
    latestTimestamp: number | null;
    entries: Array<{
      entityId: string;
      entityName: string;
      timestamp: number;
      priceUsd: number;
      priceChange24h: number | null;
      priceChange7d: number | null;
      volume24h: number | null;
      marketCap: number | null;
      avgSentiment: number | null;
      momentum: number | null;
      contrarianSignal: 'price-up-sentiment-down' | 'price-down-sentiment-up' | null;
    }>;
  } | null = null,
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
      return new Response(
        JSON.stringify(
          priceWatchOverview ?? {
            latestTimestamp: null,
            entries: [],
          },
        ),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
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
      return new Response(JSON.stringify({ latestTimestamp: null, entries: [] }), {
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

    throw new Error(`Unhandled fetch ${path}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe('ReportView price alerts', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows Price Alerts section when priceAlerts are present', async () => {
    const report = makeFullReport({
      priceAlerts: ['BTC surged +5.2% in 24h, crossing the $68K resistance level.'],
    });

    vi.stubGlobal('fetch', buildReportFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Price Alerts');
    expect(screen.getByText('BTC surged +5.2% in 24h, crossing the $68K resistance level.')).toBeInTheDocument();
  });

  it('shows Price Watch snapshot on the latest report route when overview data exists', async () => {
    const report = makeFullReport();
    const priceWatchOverview = {
      latestTimestamp: Date.UTC(2026, 3, 8, 6, 0, 0),
      entries: [
        {
          entityId: 'ent-btc',
          entityName: 'Bitcoin',
          timestamp: Date.UTC(2026, 3, 8, 6, 0, 0),
          priceUsd: 68432.15,
          priceChange24h: 4.8,
          priceChange7d: 6.2,
          volume24h: 31_500_000_000,
          marketCap: 1_350_000_000_000,
          avgSentiment: -0.34,
          momentum: -0.12,
          contrarianSignal: 'price-up-sentiment-down' as const,
        },
      ],
    };

    vi.stubGlobal('fetch', buildReportFetchMock(report, priceWatchOverview, true));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Price Watch');
    expect(screen.getByText(report.tldr)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bitcoin' })).toBeInTheDocument();
    expect(screen.getByText('$68,432.15')).toBeInTheDocument();
    expect(screen.getByText('24h +4.8%')).toBeInTheDocument();
    expect(screen.getByText('7d +6.2%')).toBeInTheDocument();
    expect(screen.getByText('Contrarian')).toBeInTheDocument();
    expect(screen.getByText(/Price is pushing higher while tracked sentiment still leans bearish/)).toBeInTheDocument();
    expect(screen.getByText('vol $31.50B')).toBeInTheDocument();
    expect(screen.getByText('mcap $1.35T')).toBeInTheDocument();
  });

  it('shows Price Watch snapshot on direct report detail when overview data exists', async () => {
    const report = makeFullReport();
    const priceWatchOverview = {
      latestTimestamp: Date.UTC(2026, 3, 8, 6, 0, 0),
      entries: [
        {
          entityId: 'ent-btc',
          entityName: 'Bitcoin',
          timestamp: Date.UTC(2026, 3, 8, 6, 0, 0),
          priceUsd: 68432.15,
          priceChange24h: 4.8,
          priceChange7d: 6.2,
          volume24h: 31_500_000_000,
          marketCap: 1_350_000_000_000,
          avgSentiment: -0.34,
          momentum: -0.12,
          contrarianSignal: 'price-up-sentiment-down' as const,
        },
      ],
    };

    vi.stubGlobal('fetch', buildReportFetchMock(report, priceWatchOverview));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Price Watch');
    expect(screen.getByText(report.tldr)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bitcoin' })).toBeInTheDocument();
    expect(screen.getByText('$68,432.15')).toBeInTheDocument();
    expect(screen.getByText('24h +4.8%')).toBeInTheDocument();
    expect(screen.getByText('7d +6.2%')).toBeInTheDocument();
    expect(screen.getByText('Contrarian')).toBeInTheDocument();
    expect(screen.getByText(/Price is pushing higher while tracked sentiment still leans bearish/)).toBeInTheDocument();
  });

  it('does not show Price Alerts section when priceAlerts array is empty', async () => {
    const report = makeFullReport({
      priceAlerts: [],
    });

    vi.stubGlobal('fetch', buildReportFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    // Wait for the report to render (TL;DR is always present)
    await screen.findByText(report.tldr);

    // Price Alerts heading should NOT be in the document
    expect(screen.queryByText('Price Alerts')).not.toBeInTheDocument();
  });

  it('shows multiple price alerts when report contains several', async () => {
    const report = makeFullReport({
      priceAlerts: [
        'BTC surged +5.2% in 24h, crossing the $68K resistance level.',
        'ETH dropped -3.1% following whale sell-off on Binance.',
        'SOL hit all-time high at $245 with strong DEX volume.',
      ],
    });

    vi.stubGlobal('fetch', buildReportFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Price Alerts');
    expect(screen.getByText('BTC surged +5.2% in 24h, crossing the $68K resistance level.')).toBeInTheDocument();
    expect(screen.getByText('ETH dropped -3.1% following whale sell-off on Binance.')).toBeInTheDocument();
    expect(screen.getByText('SOL hit all-time high at $245 with strong DEX volume.')).toBeInTheDocument();
  });
});
