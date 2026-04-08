import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportView } from '../ReportView';

function makeFullReport(overrides?: Record<string, unknown>) {
  return {
    id: 'report-divergence-1',
    date: '2026-04-08',
    type: 'daily',
    tldr: 'Regional crypto sentiment split more sharply than the headline market move suggested.',
    sentiment: 0.12,
    deliveryStatus: 'delivered',
    createdAt: Date.now(),
    body: '{}',
    keyEvents: ['Bitcoin stayed resilient, but regional tone diverged beneath the surface.'],
    marketCatalysts: [],
    regionalDivergence: [],
    eventChains: [],
    firstMovers: [],
    priceAlerts: [],
    unusualActivity: [],
    macroAlerts: [],
    macroRegime: null,
    macroRegimeHistory: null,
    chainDrilldowns: [],
    entitySentiment: [{ name: 'Bitcoin', sentiment: 0.12, reason: 'The headline tape stayed mixed.' }],
    sections: [{ title: 'Overview', body: 'Cross-language conviction split enough to matter.' }],
    ...overrides,
  };
}

function buildReportFetchMock(
  report: ReturnType<typeof makeFullReport>,
  divergences = [] as Array<Record<string, unknown>>,
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
      return new Response(JSON.stringify({ divergences }), {
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

    throw new Error(`Unhandled fetch ${path}${requestUrl.search}`);
  });
}

describe('ReportView regional divergence snapshot', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows Regional Divergence on the latest report route when cross-language gaps are available', async () => {
    const report = makeFullReport();
    const divergences = [
      {
        entityId: 'ent-btc',
        entityName: 'Bitcoin',
        engSentiment: 0.72,
        engMentions: 24,
        indSentiment: 0.18,
        indMentions: 15,
        divergence: 0.54,
      },
      {
        entityId: 'ent-sol',
        entityName: 'Solana',
        engSentiment: 0.56,
        engMentions: 11,
        indSentiment: 0.34,
        indMentions: 9,
        divergence: 0.22,
      },
    ];

    vi.stubGlobal('fetch', buildReportFetchMock(report, divergences, true));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Regional Divergence');
    expect(screen.getByText(report.tldr)).toBeInTheDocument();
    expect(screen.getByText(/Largest EN vs ID sentiment gaps from the trailing 7d window/)).toBeInTheDocument();
    expect(screen.getByText('7d window')).toBeInTheDocument();
    expect(screen.getByText('2 tracked')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bitcoin' })).toBeInTheDocument();
    expect(
      screen.getAllByText('EN sources stayed bullish while ID sources leaned bearish over the trailing 7d window.'),
    ).toHaveLength(2);
    expect(screen.getByText('Divergent')).toBeInTheDocument();
    expect(screen.getByText('EN +0.72 (24)')).toBeInTheDocument();
    expect(screen.getByText('ID +0.18 (15)')).toBeInTheDocument();
    expect(screen.getByText('gap 0.54')).toBeInTheDocument();
    expect(screen.getAllByText('EN bullish / ID bearish')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Solana' })).toBeInTheDocument();
    expect(screen.getByText('Moderate')).toBeInTheDocument();
  });

  it('shows Cross-Language Signals on the latest report route when the newest report includes regional divergence lines', async () => {
    const report = makeFullReport({
      id: 'report-divergence-latest',
      regionalDivergence: [
        'Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.',
        'Solana: ID momentum improved while EN chatter stayed cautious into the next catalyst window.',
      ],
    });
    const divergences = [
      {
        entityId: 'ent-btc',
        entityName: 'Bitcoin',
        engSentiment: 0.72,
        engMentions: 24,
        indSentiment: 0.18,
        indMentions: 15,
        divergence: 0.54,
      },
    ];

    vi.stubGlobal('fetch', buildReportFetchMock(report, divergences, true));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Cross-Language Signals');
    expect(
      screen.getByText('Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Solana: ID momentum improved while EN chatter stayed cautious into the next catalyst window.'),
    ).toBeInTheDocument();
  });

  it('shows Regional Divergence on direct report detail routes when cross-language gaps are available', async () => {
    const report = makeFullReport({
      id: 'report-divergence-2',
      regionalDivergence: ['Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.'],
      priceAlerts: ['Bitcoin stayed firm even as the cross-language tone split sharply.'],
    });
    const divergences = [
      {
        entityId: 'ent-btc',
        entityName: 'Bitcoin',
        engSentiment: 0.68,
        engMentions: 18,
        indSentiment: 0.41,
        indMentions: 12,
        divergence: 0.27,
      },
    ];

    vi.stubGlobal('fetch', buildReportFetchMock(report, divergences));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Regional Divergence');
    expect(screen.getByText(report.tldr)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bitcoin' })).toBeInTheDocument();
    expect(
      screen.getByText('EN sources stayed bullish while ID sources leaned bearish over the trailing 7d window.'),
    ).toBeInTheDocument();
    expect(screen.getByText('EN +0.68 (18)')).toBeInTheDocument();
    expect(screen.getByText('ID +0.41 (12)')).toBeInTheDocument();
    expect(screen.getByText('gap 0.27')).toBeInTheDocument();
    expect(screen.getByText('Moderate')).toBeInTheDocument();
    expect(screen.getByText('Cross-Language Signals')).toBeInTheDocument();
    expect(
      screen.getByText('Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Price Alerts')).toBeInTheDocument();
    expect(screen.getByText('Bitcoin stayed firm even as the cross-language tone split sharply.')).toBeInTheDocument();
  });

  it('does not show Regional Divergence when the watchlist is empty', async () => {
    const report = makeFullReport();

    vi.stubGlobal('fetch', buildReportFetchMock(report, []));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(report.tldr);
    expect(screen.queryByText('Regional Divergence')).not.toBeInTheDocument();
    expect(screen.queryByText('Cross-Language Signals')).not.toBeInTheDocument();
  });
});
