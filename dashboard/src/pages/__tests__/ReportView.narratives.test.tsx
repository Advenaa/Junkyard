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
    id: 'report-narratives-1',
    date: '2026-04-08',
    type: 'daily',
    tldr: 'Solana held trader attention as narratives broadened across the latest daily digest.',
    sentiment: 0.24,
    deliveryStatus: 'delivered',
    createdAt: Date.now(),
    body: '{}',
    keyEvents: ['Solana held momentum while traders watched narrative breadth expand.'],
    marketCatalysts: [],
    narrativeShifts: [],
    eventChains: [],
    firstMovers: [],
    priceAlerts: [],
    unusualActivity: [],
    macroAlerts: [],
    macroRegime: null,
    macroRegimeHistory: null,
    chainDrilldowns: [],
    entitySentiment: [{ name: 'Solana', sentiment: 0.24, reason: 'Breadth improved across active themes.' }],
    sections: [{ title: 'Overview', body: 'Narratives stayed constructive across the latest daily read.' }],
    ...overrides,
  };
}

function buildFetchMock(
  report: ReturnType<typeof makeFullReport>,
  narratives = { latestDate: null as string | null, entries: [] as Array<Record<string, unknown>> },
  latestRoute = false,
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url, 'http://localhost');
    const path = requestUrl.pathname;

    if (path === '/api/v1/narratives') {
      return new Response(JSON.stringify(narratives), {
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

describe('ReportView narrative snapshot', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows Narrative Snapshot on the latest report route when narratives are available', async () => {
    const report = makeFullReport();
    const narratives = {
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
    };

    vi.stubGlobal('fetch', buildFetchMock(report, narratives, true));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Narrative Snapshot');
    expect(screen.getByText(report.tldr)).toBeInTheDocument();
    expect(screen.getByText(/Detailed evidence remains in Settings/)).toBeInTheDocument();
    expect(screen.getByText('Solana fee rebound')).toBeInTheDocument();
    expect(screen.getByText('Emerging')).toBeInTheDocument();
    expect(screen.getByText('6 summaries')).toBeInTheDocument();
    expect(screen.getByText('sentiment +0.42')).toBeInTheDocument();
    expect(screen.getByText('BTC treasury chatter')).toBeInTheDocument();
    expect(screen.getByText('Fading')).toBeInTheDocument();
    expect(screen.getByText('2026-04-08')).toBeInTheDocument();
  });

  it('does not show Narrative Snapshot when the watchlist is empty', async () => {
    const report = makeFullReport();

    vi.stubGlobal('fetch', buildFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(report.tldr);
    expect(screen.queryByText('Narrative Snapshot')).not.toBeInTheDocument();
    expect(screen.queryByText('Narrative Shifts')).not.toBeInTheDocument();
  });

  it('shows Narrative Shifts when the report includes narrative shift lines', async () => {
    const report = makeFullReport({
      narrativeShifts: [
        'Solana fee rebound broadened from a niche trading theme into a wider alt rotation watch.',
        'BTC treasury chatter faded after fresh follow-through failed to expand beyond the early cluster.',
      ],
    });

    vi.stubGlobal('fetch', buildFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Narrative Shifts');
    expect(
      screen.getByText('Solana fee rebound broadened from a niche trading theme into a wider alt rotation watch.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'BTC treasury chatter faded after fresh follow-through failed to expand beyond the early cluster.',
      ),
    ).toBeInTheDocument();
  });

  it('shows Narrative Shifts on the latest report route when the newest report includes them', async () => {
    const report = makeFullReport({
      narrativeShifts: [
        'Stablecoin rotation broadened from macro hedging into a wider alt-liquidity narrative.',
        'Meme-beta chatter faded after the latest burst failed to recruit fresh follow-through.',
      ],
    });

    vi.stubGlobal('fetch', buildFetchMock(report, undefined, true));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Narrative Shifts');
    expect(
      screen.getByText('Stablecoin rotation broadened from macro hedging into a wider alt-liquidity narrative.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Meme-beta chatter faded after the latest burst failed to recruit fresh follow-through.'),
    ).toBeInTheDocument();
  });
});
