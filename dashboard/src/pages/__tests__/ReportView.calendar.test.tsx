import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportView } from '../ReportView';

function makeFullReport(overrides?: Record<string, unknown>) {
  return {
    id: 'report-calendar-1',
    date: '2026-04-08',
    type: 'daily',
    tldr: 'Macro traders were already watching a dense catalyst slate into the next session.',
    sentiment: 0.18,
    deliveryStatus: 'delivered',
    createdAt: Date.now(),
    body: '{}',
    keyEvents: ['BTC stayed stable as traders looked ahead to the next scheduled macro catalysts.'],
    marketCatalysts: [],
    eventChains: [],
    firstMovers: [],
    priceAlerts: [],
    unusualActivity: [],
    macroAlerts: [],
    macroRegime: null,
    macroRegimeHistory: null,
    chainDrilldowns: [],
    entitySentiment: [{ name: 'Bitcoin', sentiment: 0.18, reason: 'Positioning stayed constructive.' }],
    sections: [{ title: 'Overview', body: 'Calendar risk stayed front of mind into the next session.' }],
    ...overrides,
  };
}

function buildReportFetchMock(
  report: ReturnType<typeof makeFullReport>,
  calendarEvents = [] as Array<Record<string, unknown>>,
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
      return new Response(JSON.stringify({ latestTimestamp: null, entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/calendar-events') {
      return new Response(JSON.stringify({ events: calendarEvents }), {
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

describe('ReportView catalyst watch', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the catalyst snapshot on the latest report route when calendar events are available', async () => {
    const report = makeFullReport();
    const calendarEvents = [
      {
        id: 'cal-1',
        name: 'US CPI',
        category: 'macro',
        description: 'Inflation data remains the next macro reset for crypto beta.',
        recurrenceRule: null,
        entityId: null,
        entityName: null,
        nextOccurrence: Date.UTC(2026, 3, 9, 12, 30, 0),
        createdAt: Date.UTC(2026, 3, 8, 9, 0, 0),
      },
      {
        id: 'cal-2',
        name: 'Arbitrum unlock',
        category: 'unlock',
        description: 'Scheduled token unlock that could reshape short-term positioning.',
        recurrenceRule: 'weekly',
        entityId: 'ent-arb',
        entityName: 'Arbitrum',
        nextOccurrence: Date.UTC(2026, 3, 10, 14, 0, 0),
        createdAt: Date.UTC(2026, 3, 8, 9, 5, 0),
      },
    ];

    vi.stubGlobal('fetch', buildReportFetchMock(report, calendarEvents, true));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Catalyst Watch');
    expect(screen.getByText(report.tldr)).toBeInTheDocument();
    expect(screen.getByText(/Next scheduled catalysts from the shared market calendar/)).toBeInTheDocument();
    expect(screen.getByText('US CPI')).toBeInTheDocument();
    expect(screen.getByText('Macro')).toBeInTheDocument();
    expect(screen.getByText('Inflation data remains the next macro reset for crypto beta.')).toBeInTheDocument();
    expect(screen.getByText('One-time')).toBeInTheDocument();
    expect(screen.getByText('Arbitrum unlock')).toBeInTheDocument();
    expect(screen.getByText('Unlock')).toBeInTheDocument();
    expect(screen.getByText('Arbitrum')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('2 scheduled')).toBeInTheDocument();
  });

  it('shows the catalyst snapshot on direct report detail routes when calendar events are available', async () => {
    const report = makeFullReport({
      id: 'report-calendar-2',
      marketCatalysts: ['US CPI remains the main macro catalyst in the generated report body.'],
    });
    const calendarEvents = [
      {
        id: 'cal-3',
        name: 'FOMC decision',
        category: 'macro',
        description: 'Rates guidance could reset the short-term macro tape.',
        recurrenceRule: null,
        entityId: null,
        entityName: null,
        nextOccurrence: Date.UTC(2026, 3, 11, 18, 0, 0),
        createdAt: Date.UTC(2026, 3, 8, 9, 0, 0),
      },
    ];

    vi.stubGlobal('fetch', buildReportFetchMock(report, calendarEvents));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Catalyst Watch');
    expect(screen.getByText(report.tldr)).toBeInTheDocument();
    expect(screen.getByText('FOMC decision')).toBeInTheDocument();
    expect(screen.getByText('Rates guidance could reset the short-term macro tape.')).toBeInTheDocument();
    expect(screen.getByText('1 scheduled')).toBeInTheDocument();
    expect(screen.getByText('Market Catalysts')).toBeInTheDocument();
    expect(
      screen.getByText('US CPI remains the main macro catalyst in the generated report body.'),
    ).toBeInTheDocument();
  });
});
