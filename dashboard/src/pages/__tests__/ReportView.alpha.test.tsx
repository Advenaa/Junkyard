import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportView } from '../ReportView';

function makeFullReport(overrides?: Record<string, unknown>) {
  return {
    id: 'report-alpha-watch-1',
    date: '2026-04-08',
    type: 'daily',
    tldr: 'Higher-tier chatter surfaced early interest in Ethereum before the discussion broadened.',
    sentiment: 0.24,
    deliveryStatus: 'delivered',
    createdAt: Date.now(),
    body: '{}',
    keyEvents: ['Ethereum regained attention after ETF and L2 chatter overlapped.'],
    marketCatalysts: [],
    eventChains: [],
    firstMovers: [],
    alphaSignals: [],
    priceAlerts: [],
    unusualActivity: [],
    macroAlerts: [],
    macroRegime: null,
    macroRegimeHistory: null,
    chainDrilldowns: [],
    entitySentiment: [{ name: 'Ethereum', sentiment: 0.24, reason: 'ETF speculation held up.' }],
    sections: [{ title: 'Overview', body: 'Higher-tier desks appeared to front-run the broader conversation.' }],
    ...overrides,
  };
}

function buildReportFetchMock(
  report: ReturnType<typeof makeFullReport>,
  alphaWatch = { latestTimestamp: null as number | null, entries: [] as Array<Record<string, unknown>> },
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
      return new Response(JSON.stringify({ latestTimestamp: null, entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/alpha-watch') {
      return new Response(JSON.stringify(alphaWatch), {
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

describe('ReportView alpha watch', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows Alpha Watch on the latest report route when propagation entries are available', async () => {
    const report = makeFullReport({
      alphaSignals: [
        'Ethereum stayed mostly in alpha channels before mainstream chatter caught up roughly 4.5h later.',
      ],
    });
    const alphaWatch = {
      latestTimestamp: Date.UTC(2026, 3, 8, 10, 30, 0),
      entries: [
        {
          entityId: 'eth',
          entityName: 'Ethereum',
          firstSignalTier: 'alpha',
          firstSignalTime: Date.UTC(2026, 3, 8, 6, 0, 0),
          latestTier: 'mainstream',
          latestMentionTime: Date.UTC(2026, 3, 8, 10, 30, 0),
          propagationLagMs: 4.5 * 60 * 60 * 1000,
          tierCount: 3,
          sourceCount: 4,
        },
      ],
    };

    vi.stubGlobal('fetch', buildReportFetchMock(report, alphaWatch, true));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Alpha Watch');
    expect(screen.getByText(report.tldr)).toBeInTheDocument();
    expect(screen.getByText(/Detailed per-entity tier timelines remain in Settings/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ethereum' })).toBeInTheDocument();
    expect(screen.getByText('Moved from alpha to mainstream in 4.5h.')).toBeInTheDocument();
    expect(screen.getByText('first Alpha')).toBeInTheDocument();
    expect(screen.getByText('now Mainstream')).toBeInTheDocument();
    expect(screen.getByText('spread 4.5h')).toBeInTheDocument();
    expect(screen.getByText('3 tiers')).toBeInTheDocument();
    expect(screen.getByText('4 sources')).toBeInTheDocument();
    expect(screen.getByText('1 tracked')).toBeInTheDocument();
    expect(screen.getByText('Alpha Signals')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ethereum stayed mostly in alpha channels before mainstream chatter caught up roughly 4.5h later.',
      ),
    ).toBeInTheDocument();
  });

  it('shows Alpha Watch on direct report detail routes when propagation entries are available', async () => {
    const report = makeFullReport({
      id: 'report-alpha-watch-2',
      alphaSignals: [
        'Ethereum stayed mostly in alpha channels before mainstream chatter caught up roughly 4.5h later.',
      ],
      priceAlerts: ['Ethereum stayed firm even as the first signal came from higher-tier chatter.'],
    });
    const alphaWatch = {
      latestTimestamp: Date.UTC(2026, 3, 8, 10, 30, 0),
      entries: [
        {
          entityId: 'eth',
          entityName: 'Ethereum',
          firstSignalTier: 'alpha',
          firstSignalTime: Date.UTC(2026, 3, 8, 6, 0, 0),
          latestTier: 'mainstream',
          latestMentionTime: Date.UTC(2026, 3, 8, 10, 30, 0),
          propagationLagMs: 4.5 * 60 * 60 * 1000,
          tierCount: 3,
          sourceCount: 4,
        },
      ],
    };

    vi.stubGlobal('fetch', buildReportFetchMock(report, alphaWatch));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Alpha Watch');
    expect(screen.getByText(report.tldr)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ethereum' })).toBeInTheDocument();
    expect(screen.getByText('Moved from alpha to mainstream in 4.5h.')).toBeInTheDocument();
    expect(screen.getByText('first Alpha')).toBeInTheDocument();
    expect(screen.getByText('now Mainstream')).toBeInTheDocument();
    expect(screen.getByText('spread 4.5h')).toBeInTheDocument();
    expect(screen.getByText('Alpha Signals')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ethereum stayed mostly in alpha channels before mainstream chatter caught up roughly 4.5h later.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Price Alerts')).toBeInTheDocument();
    expect(
      screen.getByText('Ethereum stayed firm even as the first signal came from higher-tier chatter.'),
    ).toBeInTheDocument();
  });

  it('shows overflow control when more than 3 alpha watch entries exist', async () => {
    const report = makeFullReport();
    const entries = Array.from({ length: 5 }, (_, i) => ({
      entityId: `entity-${i}`,
      entityName: `Token ${i}`,
      firstSignalTier: 'alpha',
      firstSignalTime: Date.UTC(2026, 3, 8, 6, 0, 0) - i * 3600000,
      latestTier: 'mainstream',
      latestMentionTime: Date.UTC(2026, 3, 8, 10, 30, 0) - i * 3600000,
      propagationLagMs: 4.5 * 60 * 60 * 1000,
      tierCount: 3,
      sourceCount: 4,
    }));
    const alphaWatch = { latestTimestamp: entries[0].latestMentionTime, entries };

    vi.stubGlobal('fetch', buildReportFetchMock(report, alphaWatch));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();

    await screen.findByText('Alpha Watch');
    expect(screen.getByText('5 tracked')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Token 0' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Token 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Token 2' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Token 3' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Token 4' })).not.toBeInTheDocument();

    const moreButton = screen.getByRole('button', { name: '+2 more' });
    expect(moreButton).toBeInTheDocument();

    await user.click(moreButton);

    expect(screen.getByRole('heading', { name: 'Token 3' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Token 4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show fewer' }));

    expect(screen.queryByRole('heading', { name: 'Token 3' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+2 more' })).toBeInTheDocument();
  });

  it('does not show Alpha Watch when the watchlist is empty', async () => {
    const report = makeFullReport();

    vi.stubGlobal('fetch', buildReportFetchMock(report, { latestTimestamp: null, entries: [] }));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(report.tldr);
    expect(screen.queryByText('Alpha Watch')).not.toBeInTheDocument();
  });
});
