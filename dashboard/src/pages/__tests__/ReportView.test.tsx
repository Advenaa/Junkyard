import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportView } from '../ReportView';

function createReportViewFetchStub(reportResponse: Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const { pathname, searchParams } = new URL(url, 'http://localhost');
    const path = searchParams.size > 0 ? `${pathname}?${searchParams.toString()}` : pathname;

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

    if (path === '/api/v1/divergence?days=30&limit=4') {
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

    if (path === '/api/v1/reports/report-404') {
      return reportResponse;
    }

    throw new Error(`Unhandled fetch ${path}`);
  });
}

describe('ReportView', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders market catalysts when the report includes them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const path = new URL(url, 'http://localhost').pathname;

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
          return new Response(JSON.stringify({ events: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/reports/report-1') {
          return new Response(
            JSON.stringify({
              report: {
                id: 'report-1',
                date: '2026-04-06',
                type: 'daily',
                tldr: 'Macro risk is elevated ahead of a dense catalyst window.',
                sentiment: 0.4,
                deliveryStatus: 'delivered',
                createdAt: Date.now(),
                body: '{}',
                keyEvents: ['BTC broke higher on ETF flow chatter.'],
                marketCatalysts: [
                  'FOMC tomorrow is the main macro reset for crypto beta.',
                  'Friday BTC options expiry could sharpen short-term volatility.',
                ],
                eventChains: ['Bitcoin exploit chain: audit follow-up kept traders focused on remediation progress.'],
                chainDrilldowns: [
                  {
                    rootId: 'chain-root-1',
                    entityName: 'Bitcoin',
                    eventCount: 3,
                    firstEventTime: Date.UTC(2026, 3, 4, 8, 0, 0),
                    latestEventTime: Date.UTC(2026, 3, 6, 9, 30, 0),
                    eventTypes: ['exploit', 'audit', 'governance'],
                    latestSummaryId: 'summary-9',
                    latestEventType: 'governance',
                    latestEventDescription: 'Governance follow-through kept the remediation timeline active.',
                  },
                ],
                entitySentiment: [{ name: 'Bitcoin', sentiment: 0.6, reason: 'ETF flows' }],
                sections: [{ title: 'Macro', body: 'Traders are watching catalysts closely.' }],
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        throw new Error(`Unhandled fetch ${path}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/reports/report-1']}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Market Catalysts');
    expect(screen.getByText('FOMC tomorrow is the main macro reset for crypto beta.')).toBeInTheDocument();
    expect(screen.getByText('Friday BTC options expiry could sharpen short-term volatility.')).toBeInTheDocument();
    expect(screen.getByText('Event Chains')).toBeInTheDocument();
    expect(
      screen.getByText('Bitcoin exploit chain: audit follow-up kept traders focused on remediation progress.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Chain Drilldowns')).toBeInTheDocument();
    expect(screen.getByText('Governance follow-through kept the remediation timeline active.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open latest linked summary' })).toHaveAttribute(
      'href',
      '/summaries/summary-9?chain=chain-root-1',
    );
  });

  it('renders the empty state when the requested report returns 404', async () => {
    vi.stubGlobal(
      'fetch',
      createReportViewFetchStub(
        new Response(JSON.stringify({ error: 'Not Found' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    render(
      <MemoryRouter initialEntries={['/reports/report-404']}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Report not found');
    expect(screen.getByText('This report may have been removed or the link is stale.')).toBeInTheDocument();
    expect(screen.queryByText(/Error: API 404: Not Found/)).not.toBeInTheDocument();
  });

  it('renders the error block when the requested report returns 500', async () => {
    vi.stubGlobal(
      'fetch',
      createReportViewFetchStub(
        new Response(JSON.stringify({ error: 'Internal Server Error' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    render(
      <MemoryRouter initialEntries={['/reports/report-404']}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Error: API 500: Internal Server Error — Internal Server Error');
    expect(screen.queryByText('Report not found')).not.toBeInTheDocument();
  });

  it('focuses a requested chain on the report route and keeps other chains switchable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const path = new URL(url, 'http://localhost').pathname;

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
          return new Response(JSON.stringify({ events: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/reports/report-1') {
          return new Response(
            JSON.stringify({
              report: {
                id: 'report-1',
                date: '2026-04-06',
                type: 'daily',
                tldr: 'Macro risk is elevated ahead of a dense catalyst window.',
                sentiment: 0.4,
                deliveryStatus: 'delivered',
                createdAt: Date.now(),
                body: '{}',
                keyEvents: ['BTC broke higher on ETF flow chatter.'],
                marketCatalysts: [],
                eventChains: [
                  'Bitcoin exploit chain: audit follow-up kept traders focused on remediation progress.',
                  'Ethereum legal chain: the court timeline kept traders watching follow-through risk.',
                ],
                chainDrilldowns: [
                  {
                    rootId: 'chain-root-1',
                    entityName: 'Bitcoin',
                    eventCount: 3,
                    firstEventTime: Date.UTC(2026, 3, 4, 8, 0, 0),
                    latestEventTime: Date.UTC(2026, 3, 6, 9, 30, 0),
                    eventTypes: ['exploit', 'audit', 'governance'],
                    latestSummaryId: 'summary-9',
                    latestEventType: 'governance',
                    latestEventDescription: 'Governance follow-through kept the remediation timeline active.',
                  },
                  {
                    rootId: 'chain-root-2',
                    entityName: 'Ethereum',
                    eventCount: 2,
                    firstEventTime: Date.UTC(2026, 3, 5, 11, 0, 0),
                    latestEventTime: Date.UTC(2026, 3, 6, 10, 0, 0),
                    eventTypes: ['legal', 'governance'],
                    latestSummaryId: 'summary-12',
                    latestEventType: 'legal',
                    latestEventDescription: 'Legal follow-through kept traders watching Ethereum headlines.',
                  },
                ],
                entitySentiment: [],
                sections: [],
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        throw new Error(`Unhandled fetch ${path}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/reports/report-1?chain=chain-root-2']}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Chain Drilldowns');
    expect(screen.getByText('Focused chain | Ethereum | legal')).toBeInTheDocument();
    expect(screen.getByText('Focused chain summary')).toBeInTheDocument();
    const chainSummaries = screen.getAllByText(/chain:/);
    expect(chainSummaries[0]).toHaveTextContent(
      'Ethereum legal chain: the court timeline kept traders watching follow-through risk.',
    );
    expect(chainSummaries[1]).toHaveTextContent(
      'Bitcoin exploit chain: audit follow-up kept traders focused on remediation progress.',
    );
    expect(screen.getByRole('link', { name: 'Show all chains' })).toHaveAttribute('href', '/reports/report-1');
    expect(screen.getByRole('link', { name: 'Focus chain' })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-1',
    );

    const summaryLinks = screen.getAllByRole('link', { name: 'Open latest linked summary' });
    expect(summaryLinks[0]).toHaveAttribute('href', '/summaries/summary-12?chain=chain-root-2');
    expect(summaryLinks[1]).toHaveAttribute('href', '/summaries/summary-9?chain=chain-root-1');
    expect(screen.getByText('Focused chain')).toBeInTheDocument();
  });
});
