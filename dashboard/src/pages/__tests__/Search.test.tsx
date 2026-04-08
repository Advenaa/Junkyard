import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Search } from '../Search';

const previewChains = [
  {
    rootId: 'chain-root-1',
    entityName: 'Bridge',
    eventCount: 3,
    firstEventTime: Date.UTC(2026, 3, 4, 8, 0, 0),
    latestEventTime: Date.UTC(2026, 3, 6, 9, 30, 0),
    eventTypes: ['exploit', 'audit', 'governance'],
    latestSummaryId: 'summary-9',
    latestEventType: 'governance',
    latestEventDescription: 'Governance response kept the chain active.',
  },
  {
    rootId: 'chain-root-2',
    entityName: 'L2',
    eventCount: 2,
    firstEventTime: Date.UTC(2026, 3, 5, 10, 0, 0),
    latestEventTime: Date.UTC(2026, 3, 6, 11, 0, 0),
    eventTypes: ['audit', 'legal'],
    latestSummaryId: 'summary-11',
    latestEventType: 'legal',
    latestEventDescription: 'Legal response created a second active chain.',
  },
];

describe('Search', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('renders report and summary hits with detail links from all-scope search', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/search') {
        expect(parsed.searchParams.get('scope')).toBe('all');
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'summary-1',
                resultType: 'summary',
                source: 'discord',
                sourceId: 'guild:1234',
                body: 'Bridge watchers flagged new follow-up chatter right after the governance post.',
                createdAt: Date.now() - 1000,
              },
              {
                id: 'report-1',
                resultType: 'report',
                reportType: 'daily',
                date: '2026-04-06',
                body: 'Exploit remediation stayed in focus as traders watched for the next governance response.',
                createdAt: Date.now(),
                eventChains: ['Bridge exploit chain: governance response kept the story active into the close.'],
                chainDrilldowns: [
                  {
                    rootId: 'chain-root-1',
                    entityName: 'Bridge',
                    eventCount: 3,
                    firstEventTime: Date.UTC(2026, 3, 4, 8, 0, 0),
                    latestEventTime: Date.UTC(2026, 3, 6, 9, 30, 0),
                    eventTypes: ['exploit', 'audit', 'governance'],
                    latestSummaryId: 'summary-9',
                    latestEventType: 'governance',
                    latestEventDescription: 'Governance response kept the chain active.',
                  },
                  {
                    rootId: 'chain-root-2',
                    entityName: 'L2',
                    eventCount: 2,
                    firstEventTime: Date.UTC(2026, 3, 5, 10, 0, 0),
                    latestEventTime: Date.UTC(2026, 3, 6, 11, 0, 0),
                    eventTypes: ['audit', 'legal'],
                    latestSummaryId: 'summary-11',
                    latestEventType: 'legal',
                    latestEventDescription: 'Legal response created a second active chain.',
                  },
                ],
                hasMoreActiveChains: true,
                hiddenActiveChainCount: 1,
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (parsed.pathname === '/api/v1/reports/report-1') {
        return new Response(
          JSON.stringify({
            report: {
              tldr: 'Macro spillover took over the refreshed report preview after the latest chain pull.',
              eventChains: ['Bridge exploit chain: refreshed chain focus shifted to macro spillover.'],
              chainDrilldowns: [
                {
                  rootId: 'chain-root-3',
                  entityName: 'Macro',
                  eventCount: 4,
                  firstEventTime: Date.UTC(2026, 3, 3, 9, 0, 0),
                  latestEventTime: Date.UTC(2026, 3, 6, 12, 0, 0),
                  eventTypes: ['macro', 'legal', 'governance', 'macro'],
                  latestSummaryId: 'summary-13',
                  latestEventType: 'macro',
                  latestEventDescription: 'Macro spillover created the hidden third active chain.',
                },
                {
                  rootId: 'chain-root-1',
                  entityName: 'Bridge',
                  eventCount: 3,
                  firstEventTime: Date.UTC(2026, 3, 4, 8, 0, 0),
                  latestEventTime: Date.UTC(2026, 3, 6, 9, 30, 0),
                  eventTypes: ['exploit', 'audit', 'governance'],
                  latestSummaryId: 'summary-9',
                  latestEventType: 'governance',
                  latestEventDescription: 'Governance response kept the chain active.',
                },
                {
                  rootId: 'chain-root-2',
                  entityName: 'L2',
                  eventCount: 2,
                  firstEventTime: Date.UTC(2026, 3, 5, 10, 0, 0),
                  latestEventTime: Date.UTC(2026, 3, 6, 11, 0, 0),
                  eventTypes: ['audit', 'legal'],
                  latestSummaryId: 'summary-11',
                  latestEventType: 'legal',
                  latestEventDescription: 'Legal response created a second active chain.',
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search summaries and reports...'), 'exploit');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('Event Chain');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('report')).toBeInTheDocument();
    expect(screen.getByText('guild:1234')).toBeInTheDocument();
    expect(
      screen.getByText('Bridge exploit chain: governance response kept the story active into the close.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: /exploit remediation stayed in focus as traders watched for the next governance response/i,
      }),
    ).toHaveAttribute('href', '/reports/report-1?chain=chain-root-1');
    expect(screen.getByRole('button', { name: 'Active stories · 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead chain · Bridge · governance' })).toHaveAttribute(
      'href',
      '/summaries/summary-9?chain=chain-root-1',
    );
    expect(screen.getByRole('link', { name: 'Open focused report' })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-1',
    );
    expect(screen.getByText('Active chains | 2 stories')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bridge · governance · 3 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-9?chain=chain-root-1',
    );
    expect(screen.getByRole('link', { name: 'L2 · legal · 2 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-11?chain=chain-root-2',
    );
    await user.click(screen.getByRole('button', { name: 'Active stories · 2' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Show 1 more active chain' })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Macro · macro · 4 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-13?chain=chain-root-3',
    );
    expect(screen.getByText('Active chains | 3 stories')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer chains' })).toBeInTheDocument();
    expect(
      screen.getByText('Bridge exploit chain: refreshed chain focus shifted to macro spillover.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: /Macro spillover took over the refreshed report preview after the latest chain pull/i,
      }),
    ).toHaveAttribute('href', '/reports/report-1?chain=chain-root-3');
    expect(screen.getByRole('button', { name: 'Active stories · 3' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead chain · Macro · macro' })).toHaveAttribute(
      'href',
      '/summaries/summary-13?chain=chain-root-3',
    );
    expect(screen.getByRole('link', { name: 'Open focused report' })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-3',
    );
    expect(screen.getByRole('button', { name: 'Refresh stories' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh stories' }));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: 'Active stories · 3' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead chain · Macro · macro' })).toHaveAttribute(
      'href',
      '/summaries/summary-13?chain=chain-root-3',
    );

    await user.click(screen.getByRole('button', { name: 'Active stories · 3' }));
    expect(screen.queryByRole('link', { name: 'Macro · macro · 4 linked events' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 1 more active chain' })).toBeInTheDocument();
    expect(screen.getByText('Active chains | 2 stories')).toBeInTheDocument();
    expect(
      screen.getByText('Bridge exploit chain: governance response kept the story active into the close.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: /exploit remediation stayed in focus as traders watched for the next governance response/i,
      }),
    ).toHaveAttribute('href', '/reports/report-1?chain=chain-root-1');
    expect(screen.getByRole('button', { name: 'Active stories · 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead chain · Bridge · governance' })).toHaveAttribute(
      'href',
      '/summaries/summary-9?chain=chain-root-1',
    );
    expect(screen.getByRole('link', { name: 'Open focused report' })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-1',
    );
    expect(screen.queryByRole('button', { name: 'Refresh stories' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /follow-up chatter right after the governance post/i })).toHaveAttribute(
      'href',
      '/summaries/summary-1',
    );
  });

  it('shows a header loading label while the refresh chip is refetching expanded chains', async () => {
    let reportFetchCount = 0;
    let resolveRefreshFetch!: (value: Response) => void;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/search') {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'report-1',
                resultType: 'report',
                reportType: 'daily',
                date: '2026-04-06',
                body: 'Exploit remediation stayed in focus as traders watched for the next governance response.',
                createdAt: Date.now(),
                eventChains: ['Bridge exploit chain: governance response kept the story active into the close.'],
                chainDrilldowns: [
                  {
                    rootId: 'chain-root-1',
                    entityName: 'Bridge',
                    eventCount: 3,
                    firstEventTime: Date.UTC(2026, 3, 4, 8, 0, 0),
                    latestEventTime: Date.UTC(2026, 3, 6, 9, 30, 0),
                    eventTypes: ['exploit', 'audit', 'governance'],
                    latestSummaryId: 'summary-9',
                    latestEventType: 'governance',
                    latestEventDescription: 'Governance response kept the chain active.',
                  },
                  {
                    rootId: 'chain-root-2',
                    entityName: 'L2',
                    eventCount: 2,
                    firstEventTime: Date.UTC(2026, 3, 5, 10, 0, 0),
                    latestEventTime: Date.UTC(2026, 3, 6, 11, 0, 0),
                    eventTypes: ['audit', 'legal'],
                    latestSummaryId: 'summary-11',
                    latestEventType: 'legal',
                    latestEventDescription: 'Legal response created a second active chain.',
                  },
                ],
                hiddenActiveChainCount: 1,
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (parsed.pathname === '/api/v1/reports/report-1') {
        reportFetchCount += 1;

        if (reportFetchCount === 1) {
          return new Response(
            JSON.stringify({
              report: {
                tldr: 'Macro spillover took over the refreshed report preview after the latest chain pull.',
                eventChains: ['Bridge exploit chain: refreshed chain focus shifted to macro spillover.'],
                chainDrilldowns: [
                  {
                    rootId: 'chain-root-3',
                    entityName: 'Macro',
                    eventCount: 4,
                    firstEventTime: Date.UTC(2026, 3, 3, 9, 0, 0),
                    latestEventTime: Date.UTC(2026, 3, 6, 12, 0, 0),
                    eventTypes: ['macro', 'legal', 'governance', 'macro'],
                    latestSummaryId: 'summary-13',
                    latestEventType: 'macro',
                    latestEventDescription: 'Macro spillover created the hidden third active chain.',
                  },
                  {
                    rootId: 'chain-root-1',
                    entityName: 'Bridge',
                    eventCount: 3,
                    firstEventTime: Date.UTC(2026, 3, 4, 8, 0, 0),
                    latestEventTime: Date.UTC(2026, 3, 6, 9, 30, 0),
                    eventTypes: ['exploit', 'audit', 'governance'],
                    latestSummaryId: 'summary-9',
                    latestEventType: 'governance',
                    latestEventDescription: 'Governance response kept the chain active.',
                  },
                  {
                    rootId: 'chain-root-2',
                    entityName: 'L2',
                    eventCount: 2,
                    firstEventTime: Date.UTC(2026, 3, 5, 10, 0, 0),
                    latestEventTime: Date.UTC(2026, 3, 6, 11, 0, 0),
                    eventTypes: ['audit', 'legal'],
                    latestSummaryId: 'summary-11',
                    latestEventType: 'legal',
                    latestEventDescription: 'Legal response created a second active chain.',
                  },
                ],
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        return new Promise<Response>((resolve) => {
          resolveRefreshFetch = resolve;
        });
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search summaries and reports...'), 'exploit');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByRole('button', { name: 'Active stories · 2' });
    await user.click(screen.getByRole('button', { name: 'Active stories · 2' }));
    expect(await screen.findByRole('button', { name: 'Refresh stories' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh stories' }));

    expect(screen.getByRole('button', { name: 'Refreshing stories...' })).toBeInTheDocument();

    resolveRefreshFetch(
      new Response(
        JSON.stringify({
          report: {
            tldr: 'Macro spillover stayed in focus after the refresh completed.',
            eventChains: ['Bridge exploit chain: refreshed chain focus stayed with macro spillover.'],
            chainDrilldowns: [
              {
                rootId: 'chain-root-3',
                entityName: 'Macro',
                eventCount: 4,
                firstEventTime: Date.UTC(2026, 3, 3, 9, 0, 0),
                latestEventTime: Date.UTC(2026, 3, 6, 12, 30, 0),
                eventTypes: ['macro', 'legal', 'governance', 'macro'],
                latestSummaryId: 'summary-13',
                latestEventType: 'macro',
                latestEventDescription: 'Macro spillover remained the lead active chain.',
              },
              {
                rootId: 'chain-root-1',
                entityName: 'Bridge',
                eventCount: 3,
                firstEventTime: Date.UTC(2026, 3, 4, 8, 0, 0),
                latestEventTime: Date.UTC(2026, 3, 6, 9, 30, 0),
                eventTypes: ['exploit', 'audit', 'governance'],
                latestSummaryId: 'summary-9',
                latestEventType: 'governance',
                latestEventDescription: 'Governance response kept the chain active.',
              },
              {
                rootId: 'chain-root-2',
                entityName: 'L2',
                eventCount: 2,
                firstEventTime: Date.UTC(2026, 3, 5, 10, 0, 0),
                latestEventTime: Date.UTC(2026, 3, 6, 11, 0, 0),
                eventTypes: ['audit', 'legal'],
                latestSummaryId: 'summary-11',
                latestEventType: 'legal',
                latestEventDescription: 'Legal response created a second active chain.',
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    expect(await screen.findByRole('button', { name: 'Refresh stories' })).toBeInTheDocument();
  });

  it('shows a header retry label when the refresh chip refetch fails', async () => {
    let refreshAttempt = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/search') {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'report-1',
                resultType: 'report',
                body: 'Bridge exploit chain kept the report preview focused on governance follow-through.',
                createdAt: Date.UTC(2026, 3, 6, 12, 0, 0),
                reportType: 'daily',
                date: '2026-04-06',
                eventChains: ['Bridge exploit chain: governance follow-through kept the story active.'],
                chainDrilldowns: previewChains,
                hiddenActiveChainCount: 1,
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (parsed.pathname === '/api/v1/reports/report-1') {
        refreshAttempt += 1;

        if (refreshAttempt === 1) {
          return new Response(
            JSON.stringify({
              report: {
                tldr: 'Bridge exploit chain stayed expanded in the active-story set.',
                eventChains: ['Bridge exploit chain: macro spillover expanded the active story set.'],
                chainDrilldowns: [
                  {
                    rootId: 'chain-root-3',
                    entityName: 'Macro',
                    eventCount: 4,
                    firstEventTime: Date.UTC(2026, 3, 3, 9, 0, 0),
                    latestEventTime: Date.UTC(2026, 3, 6, 12, 30, 0),
                    eventTypes: ['macro', 'legal', 'governance', 'macro'],
                    latestSummaryId: 'summary-13',
                    latestEventType: 'macro',
                    latestEventDescription: 'Macro spillover remained the lead active chain.',
                  },
                  ...previewChains,
                ],
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        throw new Error('refresh failed');
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search summaries and reports...'), 'exploit');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByRole('button', { name: 'Active stories · 2' });
    await user.click(screen.getByRole('button', { name: 'Active stories · 2' }));
    expect(await screen.findByRole('button', { name: 'Refresh stories' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh stories' }));

    expect(await screen.findByRole('button', { name: 'Retry refresh stories' })).toBeInTheDocument();
    expect(screen.getByText('Failed to refresh active chains.')).toBeInTheDocument();
  });

  it('renders a macro alert preview on report hits when no active chain preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/search') {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'report-macro-1',
                resultType: 'report',
                reportType: 'daily',
                date: '2026-04-08',
                body: 'BTC held up even as the macro tape turned more defensive.',
                createdAt: Date.now(),
                macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search summaries and reports...'), 'macro');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('Macro Alert');
    expect(
      screen.getByText('Crypto stayed resilient even as the dollar and rates both pushed higher.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Event Chain')).not.toBeInTheDocument();
  });

  it('renders an unusual activity preview ahead of macro alerts on report hits when no active chain preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/search') {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'report-unusual-1',
                resultType: 'report',
                reportType: 'daily',
                date: '2026-04-08',
                body: 'Small-cap chatter accelerated even while broad market direction stayed mixed.',
                createdAt: Date.now(),
                unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
                macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search summaries and reports...'), 'copy trade');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('Unusual Activity');
    expect(screen.getByText('Copy-trade style overlap surged around a thinly traded token.')).toBeInTheDocument();
    expect(screen.queryByText('Macro Alert')).not.toBeInTheDocument();
  });

  it('renders a price alert preview ahead of unusual activity and macro alerts on report hits when no active chain preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/search') {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'report-price-1',
                resultType: 'report',
                reportType: 'daily',
                date: '2026-04-08',
                body: 'Bitcoin kept squeezing higher even while broader market chatter stayed selective.',
                createdAt: Date.now(),
                priceAlerts: ['Bitcoin pushed +4.8% in 24h even as tracked sentiment stayed net bearish.'],
                unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
                macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search summaries and reports...'), 'contrarian');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('Price Alert');
    expect(
      screen.getByText('Bitcoin pushed +4.8% in 24h even as tracked sentiment stayed net bearish.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unusual Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Macro Alert')).not.toBeInTheDocument();
  });

  it('renders a market catalyst preview ahead of unusual activity and macro alerts on report hits when no active chain preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/search') {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'report-catalyst-1',
                resultType: 'report',
                reportType: 'daily',
                date: '2026-04-08',
                body: 'Traders stayed cautious into the next macro event window.',
                createdAt: Date.now(),
                marketCatalysts: ['US CPI lands tomorrow and remains the clearest scheduled volatility catalyst.'],
                unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
                macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search summaries and reports...'), 'cpi');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('Market Catalyst');
    expect(
      screen.getByText('US CPI lands tomorrow and remains the clearest scheduled volatility catalyst.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unusual Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Macro Alert')).not.toBeInTheDocument();
  });

  it('renders a narrative shift preview ahead of unusual activity and macro alerts on report hits when no higher-priority preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/search') {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'report-narrative-shift-1',
                resultType: 'report',
                reportType: 'daily',
                date: '2026-04-08',
                body: 'Capital rotated into a narrower set of higher-quality beta themes.',
                createdAt: Date.now(),
                narrativeShifts: [
                  'Stablecoin rotation broadened from macro hedging into a wider alt-liquidity narrative.',
                ],
                unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
                macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search summaries and reports...'), 'narrative shift');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('Narrative Shift');
    expect(
      screen.getByText('Stablecoin rotation broadened from macro hedging into a wider alt-liquidity narrative.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unusual Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Macro Alert')).not.toBeInTheDocument();
  });

  it('renders a regional divergence preview ahead of narrative shifts and softer heuristics on report hits when no higher-priority preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/search') {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'report-regional-divergence-1',
                resultType: 'report',
                reportType: 'daily',
                date: '2026-04-08',
                body: 'Cross-language positioning split more than the headline move suggested.',
                createdAt: Date.now(),
                regionalDivergence: [
                  'Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.',
                ],
                narrativeShifts: [
                  'Stablecoin rotation broadened from macro hedging into a wider alt-liquidity narrative.',
                ],
                unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
                macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search summaries and reports...'), 'regional divergence');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('Regional Divergence');
    expect(
      screen.getByText('Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Narrative Shift')).not.toBeInTheDocument();
    expect(screen.queryByText('Unusual Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Macro Alert')).not.toBeInTheDocument();
  });

  it('renders a first-mover preview ahead of unusual activity and macro alerts on report hits when no active chain preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/search') {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'report-first-mover-1',
                resultType: 'report',
                reportType: 'daily',
                date: '2026-04-08',
                body: 'One monitored voice surfaced the setup before broader copy-trade behavior appeared.',
                createdAt: Date.now(),
                firstMovers: ['Ethereum was first tracked by DeFi Dad roughly 4h before the next monitored call.'],
                unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
                macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search summaries and reports...'), 'first mover');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('First Mover');
    expect(
      screen.getByText('Ethereum was first tracked by DeFi Dad roughly 4h before the next monitored call.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unusual Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Macro Alert')).not.toBeInTheDocument();
  });

  it('renders a macro regime chip on report hits when previews include regime history', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/search') {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'report-regime-1',
                resultType: 'report',
                reportType: 'daily',
                date: '2026-04-08',
                body: 'Macro pressure stayed elevated into the close.',
                createdAt: Date.now(),
                macroRegime: {
                  classification: 'risk-off',
                  confidence: 0.82,
                  rationale: 'Higher yields and a stronger dollar kept the tape defensive.',
                },
                macroRegimeHistory: {
                  streakDays: 3,
                  regimeStartedAt: '2026-04-06',
                  previousClassification: 'risk-on',
                },
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search summaries and reports...'), 'macro');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Macro regime · Risk-off · Day 3')).toBeInTheDocument();
  });
});
