import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportView } from '../ReportView';

function makeFullReport(overrides?: Record<string, unknown>) {
  return {
    id: 'report-unusual-1',
    date: '2026-04-08',
    type: 'daily',
    tldr: 'Bitcoin held range highs while attention suddenly rotated into smaller names.',
    sentiment: 0.2,
    deliveryStatus: 'delivered',
    createdAt: Date.now(),
    body: '{}',
    keyEvents: ['BTC stayed firm while alt attention broadened.'],
    marketCatalysts: [],
    eventChains: [],
    priceAlerts: [],
    unusualActivity: [],
    macroAlerts: [],
    macroRegime: null,
    macroRegimeHistory: null,
    chainDrilldowns: [],
    entitySentiment: [{ name: 'Bitcoin', sentiment: 0.2, reason: 'Range resilience' }],
    sections: [{ title: 'Overview', body: 'The tape stayed stable, but crowd attention widened.' }],
    ...overrides,
  };
}

function buildReportFetchMock(
  report: ReturnType<typeof makeFullReport>,
  overview = { latestDate: null as string | null, entries: [] as Array<Record<string, unknown>> },
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
      return new Response(JSON.stringify(overview), {
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

describe('ReportView unusual activity', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the unusual-activity snapshot on the latest report route when watchlist entries are available', async () => {
    const report = makeFullReport();
    const overview = {
      latestDate: '2026-04-08',
      entries: [
        {
          entityId: 'ent-omni',
          entityName: 'Omni',
          date: '2026-04-08',
          mentionCount: 18,
          baselineMentionCount: 4.5,
          baselinePeakMentionCount: 7,
          baselineDays: 6,
          avgSentiment: 0.62,
          momentum: 0.31,
          spikeRatio: 4,
          relevanceScore: 1.4,
          lowRelevance: true,
          duplicateClusterSize: 3,
          duplicateAuthorCount: 3,
          duplicateSourceCount: 2,
        },
      ],
    };

    vi.stubGlobal('fetch', buildReportFetchMock(report, overview, true));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(
      'Latest daily mention spikes and copy-cluster breakouts. Full heuristic detail remains in Settings > Pipeline.',
    );
    expect(screen.getByText(report.tldr)).toBeInTheDocument();
    expect(screen.getByText('Omni')).toBeInTheDocument();
    expect(screen.getByText('4.0x baseline')).toBeInTheDocument();
    expect(screen.getByText('today 18 mentions')).toBeInTheDocument();
    expect(screen.getByText('low relevance 1.4')).toBeInTheDocument();
    expect(screen.getByText('copy cluster 3 posts')).toBeInTheDocument();
    expect(screen.getByText('sentiment +0.62')).toBeInTheDocument();
    expect(screen.getByText('2026-04-08')).toBeInTheDocument();
    expect(screen.getByText('1 flagged')).toBeInTheDocument();
  });

  it('shows Unusual Activity section when unusualActivity entries are present', async () => {
    const report = makeFullReport({
      unusualActivity: ['Omni attention spiked to 4.0x its recent baseline, putting the name on a crowding watchlist.'],
    });

    vi.stubGlobal('fetch', buildReportFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Unusual Activity');
    expect(
      screen.getByText('Omni attention spiked to 4.0x its recent baseline, putting the name on a crowding watchlist.'),
    ).toBeInTheDocument();
  });

  it('does not show Unusual Activity section when unusualActivity array is empty', async () => {
    const report = makeFullReport({
      unusualActivity: [],
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
    expect(screen.queryByText('Unusual Activity')).not.toBeInTheDocument();
  });
});
