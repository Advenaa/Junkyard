import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportView } from '../ReportView';

vi.mock('../../components/StatusProvider', () => {
  const statusValue = {
    ready: true,
    status: null,
    disabledFeatures: [],
    isFeatureDisabled: () => false,
    getDisabledFeature: () => null,
    registerDisabledFeature: vi.fn(),
  };
  return { useStatus: () => statusValue };
});

function makeFullReport(overrides?: Record<string, unknown>) {
  return {
    id: 'report-macro-1',
    date: '2026-04-08',
    type: 'daily',
    tldr: 'Crypto sentiment stayed constructive, but the macro tape turned more defensive overnight.',
    sentiment: 0.2,
    deliveryStatus: 'delivered',
    createdAt: Date.now(),
    body: '{}',
    keyEvents: ['BTC held range highs despite a firmer dollar.'],
    marketCatalysts: ['US CPI tomorrow remains the next macro catalyst.'],
    eventChains: [],
    priceAlerts: [],
    macroAlerts: [],
    macroRegime: null,
    macroRegimeHistory: null,
    chainDrilldowns: [],
    entitySentiment: [{ name: 'Bitcoin', sentiment: 0.2, reason: 'Spot-led resilience' }],
    sections: [{ title: 'Overview', body: 'Positioning remains constructive, but the backdrop tightened.' }],
    ...overrides,
  };
}

function buildReportFetchMock(
  report: ReturnType<typeof makeFullReport>,
  macroOverview: {
    overallBias: 'risk-on' | 'risk-off' | 'mixed';
    latestDate: string | null;
    entries: Array<{
      indicator: 'vix' | 'dxy' | 'us10y' | 'spx' | 'gold';
      label: string;
      value: number;
      change1d: number | null;
      change7d: number | null;
      date: string;
      signal: 'risk-on' | 'risk-off' | 'neutral';
      narrative: string;
    }>;
  } | null = null,
  latestRoute = false,
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url, 'http://localhost');
    const path = requestUrl.pathname;

    if (path === '/api/v1/macro') {
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

    if (path === '/api/v1/price-watch') {
      return new Response(JSON.stringify({ latestTimestamp: null, entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/narratives') {
      return new Response(JSON.stringify({ latestDate: null, entries: [] }), {
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

describe('ReportView macro alerts', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows Macro Backdrop snapshot on the latest report route when macro data exists', async () => {
    const report = makeFullReport();
    const macroOverview = {
      overallBias: 'risk-off' as const,
      latestDate: '2026-04-08',
      entries: [
        {
          indicator: 'vix' as const,
          label: 'VIX',
          value: 21.9,
          change1d: 1.1,
          change7d: 3.9,
          date: '2026-04-08',
          signal: 'risk-off' as const,
          narrative: 'volatility rising',
        },
        {
          indicator: 'spx' as const,
          label: 'S&P 500',
          value: 5234,
          change1d: -35,
          change7d: -102,
          date: '2026-04-08',
          signal: 'risk-off' as const,
          narrative: 'equities fading',
        },
      ],
    };

    vi.stubGlobal('fetch', buildReportFetchMock(report, macroOverview, true));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Macro Backdrop');
    expect(screen.getByText(report.tldr)).toBeInTheDocument();
    expect(screen.getByText(/Latest FRED snapshots frame the broader tape/)).toBeInTheDocument();
    expect(screen.getByLabelText('Overall macro bias risk-off')).toBeInTheDocument();
    expect(screen.getByText('VIX')).toBeInTheDocument();
    expect(screen.getByText('volatility rising')).toBeInTheDocument();
    expect(screen.getByText('1d +1.10')).toBeInTheDocument();
    expect(screen.getByText('7d +3.90')).toBeInTheDocument();
    expect(screen.getByText('S&P 500')).toBeInTheDocument();
    expect(screen.getByText('equities fading')).toBeInTheDocument();
    expect(screen.getByText('2026-04-08')).toBeInTheDocument();
  });

  it('shows Macro Alerts section when macroAlerts are present', async () => {
    const report = makeFullReport({
      macroAlerts: ['Crypto stayed bid even as VIX and the dollar both pushed higher, raising squeeze-failure risk.'],
    });

    vi.stubGlobal('fetch', buildReportFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Macro Alerts');
    expect(
      screen.getByText(
        'Crypto stayed bid even as VIX and the dollar both pushed higher, raising squeeze-failure risk.',
      ),
    ).toBeInTheDocument();
  });

  it('does not show Macro Alerts section when macroAlerts array is empty', async () => {
    const report = makeFullReport({
      macroAlerts: [],
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
    expect(screen.queryByText('Macro Alerts')).not.toBeInTheDocument();
  });

  it('shows Macro Regime summary when macroRegime is present', async () => {
    const report = makeFullReport({
      macroRegime: {
        classification: 'risk-off',
        confidence: 0.82,
        rationale: 'Dollar, yields, and gold all leaned defensive while crypto breadth stayed mixed.',
      },
      macroRegimeHistory: {
        streakDays: 3,
        regimeStartedAt: '2026-04-06',
        previousClassification: 'risk-on',
      },
    });

    vi.stubGlobal('fetch', buildReportFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Macro Regime');
    expect(screen.getByText('Risk-off')).toBeInTheDocument();
    expect(screen.getByText('82% confidence')).toBeInTheDocument();
    expect(
      screen.getByText('Day 3 of current daily regime | since April 6, 2026 | previous Risk-on'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Dollar, yields, and gold all leaned defensive while crypto breadth stayed mixed.'),
    ).toBeInTheDocument();
  });

  it('does not show Macro Regime summary when macroRegime is null', async () => {
    const report = makeFullReport({
      macroRegime: null,
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
    expect(screen.queryByText('Macro Regime')).not.toBeInTheDocument();
    expect(screen.queryByText('Macro Backdrop')).not.toBeInTheDocument();
  });
});
