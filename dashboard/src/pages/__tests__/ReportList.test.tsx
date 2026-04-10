import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportList } from '../ReportList';

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

const previewChains = [
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
];

function maybeNarrativesResponse(
  path: URL,
  payload: {
    latestDate: string | null;
    entries: Array<{
      id: string;
      name: string;
      date: string;
      memberCount: number;
      avgSentiment: number | null;
      signalStrength: 'new' | 'emerging' | 'strong' | 'stable' | 'fading';
    }>;
  } = { latestDate: null, entries: [] },
) {
  if (path.pathname !== '/api/v1/narratives') {
    return null;
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ReportList', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('renders event chain previews when the reports list includes them', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'http://localhost');
      const narrativeResponse = maybeNarrativesResponse(path);
      if (narrativeResponse) return narrativeResponse;

      if (path.pathname === '/api/v1/reports') {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: 'report-1',
                date: '2026-04-06',
                type: 'daily',
                tldr: 'Bitcoin held gains while traders watched follow-up risk around a live exploit story.',
                sentiment: 0.35,
                deliveryStatus: 'delivered',
                createdAt: Date.now(),
                eventChains: ['Bitcoin exploit chain: audit follow-up kept the remediation story active.'],
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
                hasMoreActiveChains: true,
                hiddenActiveChainCount: 3,
              },
            ],
            total: 1,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (path.pathname === '/api/v1/reports/report-1') {
        return new Response(
          JSON.stringify({
            report: {
              tldr: 'Chainlink took over the preview focus after the refreshed active-chain pull.',
              eventChains: ['Bitcoin exploit chain: refreshed active chains moved the lead story to Chainlink.'],
              chainDrilldowns: [
                {
                  rootId: 'chain-root-4',
                  entityName: 'Chainlink',
                  eventCount: 3,
                  firstEventTime: Date.UTC(2026, 3, 4, 7, 0, 0),
                  latestEventTime: Date.UTC(2026, 3, 6, 8, 30, 0),
                  eventTypes: ['partnership', 'governance', 'legal'],
                  latestSummaryId: 'summary-15',
                  latestEventType: 'legal',
                  latestEventDescription: 'Chainlink legal follow-through kept one more story active.',
                },
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
                {
                  rootId: 'chain-root-3',
                  entityName: 'Solana',
                  eventCount: 4,
                  firstEventTime: Date.UTC(2026, 3, 3, 12, 0, 0),
                  latestEventTime: Date.UTC(2026, 3, 6, 12, 15, 0),
                  eventTypes: ['exploit', 'audit', 'governance', 'audit'],
                  latestSummaryId: 'summary-14',
                  latestEventType: 'audit',
                  latestEventDescription: 'Audit follow-up kept Solana in the active-chain set.',
                },
                {
                  rootId: 'chain-root-5',
                  entityName: 'Aave',
                  eventCount: 2,
                  firstEventTime: Date.UTC(2026, 3, 5, 8, 0, 0),
                  latestEventTime: Date.UTC(2026, 3, 6, 9, 0, 0),
                  eventTypes: ['governance', 'audit'],
                  latestSummaryId: 'summary-16',
                  latestEventType: 'audit',
                  latestEventDescription: 'Aave added the last hidden active chain.',
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

      throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();

    await screen.findByText('Reports');
    expect(screen.getByText('Event Chain')).toBeInTheDocument();
    expect(
      screen.getByText('Bitcoin exploit chain: audit follow-up kept the remediation story active.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Bitcoin held gains while traders watched follow-up risk/i }),
    ).toHaveAttribute('href', '/reports/report-1?chain=chain-root-1');
    expect(screen.getByRole('button', { name: 'Active stories · 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead chain · Bitcoin · governance' })).toHaveAttribute(
      'href',
      '/summaries/summary-9?chain=chain-root-1',
    );
    expect(screen.getByRole('link', { name: 'Open focused report' })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-1',
    );
    expect(screen.getByText('Active chains | 2 stories')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bitcoin · governance · 3 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-9?chain=chain-root-1',
    );
    expect(screen.getByRole('link', { name: 'Ethereum · legal · 2 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-12?chain=chain-root-2',
    );
    await user.click(screen.getByRole('button', { name: 'Active stories · 2' }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('button', { name: 'Show 3 more active chains' })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Solana · audit · 4 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-14?chain=chain-root-3',
    );
    expect(screen.getByRole('link', { name: 'Chainlink · legal · 3 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-15?chain=chain-root-4',
    );
    expect(screen.getByRole('link', { name: 'Aave · audit · 2 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-16?chain=chain-root-5',
    );
    expect(screen.getByText('Active chains | 5 stories')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer chains' })).toBeInTheDocument();
    expect(
      screen.getByText('Bitcoin exploit chain: refreshed active chains moved the lead story to Chainlink.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: /Chainlink took over the preview focus after the refreshed active-chain pull/i,
      }),
    ).toHaveAttribute('href', '/reports/report-1?chain=chain-root-4');
    expect(screen.getByRole('button', { name: 'Active stories · 5' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead chain · Chainlink · legal' })).toHaveAttribute(
      'href',
      '/summaries/summary-15?chain=chain-root-4',
    );
    expect(screen.getByRole('link', { name: 'Open focused report' })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-4',
    );
    expect(screen.getByRole('button', { name: 'Refresh stories' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh stories' }));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(screen.getByRole('button', { name: 'Active stories · 5' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead chain · Chainlink · legal' })).toHaveAttribute(
      'href',
      '/summaries/summary-15?chain=chain-root-4',
    );

    await user.click(screen.getByRole('button', { name: 'Active stories · 5' }));

    expect(screen.queryByRole('link', { name: 'Solana · audit · 4 linked events' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 3 more active chains' })).toBeInTheDocument();
    expect(screen.getByText('Active chains | 2 stories')).toBeInTheDocument();
    expect(
      screen.getByText('Bitcoin exploit chain: audit follow-up kept the remediation story active.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: /Bitcoin held gains while traders watched follow-up risk around a live exploit story/i,
      }),
    ).toHaveAttribute('href', '/reports/report-1?chain=chain-root-1');
    expect(screen.getByRole('button', { name: 'Active stories · 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead chain · Bitcoin · governance' })).toHaveAttribute(
      'href',
      '/summaries/summary-9?chain=chain-root-1',
    );
    expect(screen.getByRole('link', { name: 'Open focused report' })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-1',
    );
    expect(screen.queryByRole('button', { name: 'Refresh stories' })).not.toBeInTheDocument();
  });

  it('shows a header loading label while the active-stories chip is expanding inline chains', async () => {
    let resolveFetch!: (value: Response) => void;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'http://localhost');
      const narrativeResponse = maybeNarrativesResponse(path);
      if (narrativeResponse) return narrativeResponse;

      if (path.pathname === '/api/v1/reports') {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: 'report-1',
                date: '2026-04-06',
                type: 'daily',
                tldr: 'Bitcoin held gains while traders watched follow-up risk around a live exploit story.',
                sentiment: 0.35,
                deliveryStatus: 'delivered',
                createdAt: Date.now(),
                eventChains: ['Bitcoin exploit chain: audit follow-up kept the remediation story active.'],
                chainDrilldowns: previewChains,
                hiddenActiveChainCount: 1,
              },
            ],
            total: 1,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (path.pathname === '/api/v1/reports/report-1') {
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      }

      throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();

    await screen.findByText('Reports');
    await user.click(screen.getByRole('button', { name: 'Active stories · 2' }));

    expect(screen.getByRole('button', { name: 'Loading stories...' })).toBeInTheDocument();

    resolveFetch(
      new Response(
        JSON.stringify({
          report: {
            chainDrilldowns: [
              ...previewChains,
              {
                rootId: 'chain-root-3',
                entityName: 'Solana',
                eventCount: 4,
                firstEventTime: Date.UTC(2026, 3, 3, 12, 0, 0),
                latestEventTime: Date.UTC(2026, 3, 6, 12, 15, 0),
                eventTypes: ['exploit', 'audit', 'governance', 'audit'],
                latestSummaryId: 'summary-14',
                latestEventType: 'audit',
                latestEventDescription: 'Audit follow-up kept Solana in the active-chain set.',
              },
            ],
            tldr: 'Bitcoin held gains while traders watched the audit response stay live.',
            eventChains: ['Bitcoin exploit chain: audit follow-up kept the remediation story active.'],
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    expect(await screen.findByRole('button', { name: 'Active stories · 3' })).toBeInTheDocument();
  });

  it('shows a header retry label when active-story expansion fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'http://localhost');
      const narrativeResponse = maybeNarrativesResponse(path);
      if (narrativeResponse) return narrativeResponse;

      if (path.pathname === '/api/v1/reports') {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: 'report-1',
                date: '2026-04-06',
                type: 'daily',
                tldr: 'Bitcoin held gains while traders watched follow-up risk around a live exploit story.',
                sentiment: 0.35,
                deliveryStatus: 'delivered',
                createdAt: Date.now(),
                eventChains: ['Bitcoin exploit chain: audit follow-up kept the remediation story active.'],
                chainDrilldowns: previewChains,
                hiddenActiveChainCount: 1,
              },
            ],
            total: 1,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (path.pathname === '/api/v1/reports/report-1') {
        throw new Error('expand failed');
      }

      throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();

    await screen.findByText('Reports');
    await user.click(screen.getByRole('button', { name: 'Active stories · 2' }));

    expect(await screen.findByRole('button', { name: 'Retry loading stories' })).toBeInTheDocument();
    expect(screen.getByText('Failed to load more active chains.')).toBeInTheDocument();
  });

  it('renders a macro alert preview when no active chain preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'http://localhost');
      const narrativeResponse = maybeNarrativesResponse(path);
      if (narrativeResponse) return narrativeResponse;

      if (path.pathname === '/api/v1/reports') {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: 'report-macro-1',
                date: '2026-04-08',
                type: 'daily',
                tldr: 'BTC held up even as the macro tape turned more defensive.',
                sentiment: 0.12,
                deliveryStatus: 'delivered',
                createdAt: Date.now(),
                macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
            total: 1,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Macro Alert');
    expect(
      screen.getByText('Crypto stayed resilient even as the dollar and rates both pushed higher.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Event Chain')).not.toBeInTheDocument();
  });

  it('renders an unusual activity preview ahead of macro alerts when no active chain preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'http://localhost');
      const narrativeResponse = maybeNarrativesResponse(path);
      if (narrativeResponse) return narrativeResponse;

      if (path.pathname === '/api/v1/reports') {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: 'report-unusual-1',
                date: '2026-04-08',
                type: 'daily',
                tldr: 'Small-cap chatter accelerated even while broad market direction stayed mixed.',
                sentiment: 0.08,
                deliveryStatus: 'delivered',
                createdAt: Date.now(),
                unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
                macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
            total: 1,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Unusual Activity');
    expect(screen.getByText('Copy-trade style overlap surged around a thinly traded token.')).toBeInTheDocument();
    expect(screen.queryByText('Macro Alert')).not.toBeInTheDocument();
  });

  it('renders a price alert preview ahead of unusual activity and macro alerts when no active chain preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'http://localhost');
      const narrativeResponse = maybeNarrativesResponse(path);
      if (narrativeResponse) return narrativeResponse;

      if (path.pathname === '/api/v1/reports') {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: 'report-price-1',
                date: '2026-04-08',
                type: 'daily',
                tldr: 'Bitcoin kept squeezing higher even while broader market chatter stayed selective.',
                sentiment: 0.11,
                deliveryStatus: 'delivered',
                createdAt: Date.now(),
                priceAlerts: ['Bitcoin pushed +4.8% in 24h even as tracked sentiment stayed net bearish.'],
                unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
                macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
            total: 1,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Price Alert');
    expect(
      screen.getByText('Bitcoin pushed +4.8% in 24h even as tracked sentiment stayed net bearish.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unusual Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Macro Alert')).not.toBeInTheDocument();
  });

  it('renders a market catalyst preview ahead of unusual activity and macro alerts when no active chain preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'http://localhost');
      const narrativeResponse = maybeNarrativesResponse(path);
      if (narrativeResponse) return narrativeResponse;

      if (path.pathname === '/api/v1/reports') {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: 'report-catalyst-1',
                date: '2026-04-08',
                type: 'daily',
                tldr: 'Traders stayed cautious into the next macro event window.',
                sentiment: 0.04,
                deliveryStatus: 'delivered',
                createdAt: Date.now(),
                marketCatalysts: ['US CPI lands tomorrow and remains the clearest scheduled volatility catalyst.'],
                unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
                macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
            total: 1,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Market Catalyst');
    expect(
      screen.getByText('US CPI lands tomorrow and remains the clearest scheduled volatility catalyst.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unusual Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Macro Alert')).not.toBeInTheDocument();
  });

  it('renders a narrative shift preview ahead of unusual activity and macro alerts when no higher-priority preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'http://localhost');
      const narrativeResponse = maybeNarrativesResponse(path);
      if (narrativeResponse) return narrativeResponse;

      if (path.pathname === '/api/v1/reports') {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: 'report-narrative-shift-1',
                date: '2026-04-08',
                type: 'daily',
                tldr: 'Capital rotated into a narrower set of higher-quality beta themes.',
                sentiment: 0.09,
                deliveryStatus: 'delivered',
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
            total: 1,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Narrative Shift');
    expect(
      screen.getByText('Stablecoin rotation broadened from macro hedging into a wider alt-liquidity narrative.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unusual Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Macro Alert')).not.toBeInTheDocument();
  });

  it('renders a regional divergence preview ahead of narrative shifts and softer heuristics when no higher-priority preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'http://localhost');
      const narrativeResponse = maybeNarrativesResponse(path);
      if (narrativeResponse) return narrativeResponse;

      if (path.pathname === '/api/v1/reports') {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: 'report-regional-divergence-1',
                date: '2026-04-08',
                type: 'daily',
                tldr: 'Cross-language positioning split more than the headline move suggested.',
                sentiment: 0.07,
                deliveryStatus: 'delivered',
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
            total: 1,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Regional Divergence');
    expect(
      screen.getByText('Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Narrative Shift')).not.toBeInTheDocument();
    expect(screen.queryByText('Unusual Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Macro Alert')).not.toBeInTheDocument();
  });

  it('renders a first-mover preview ahead of unusual activity and macro alerts when no active chain preview is present', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'http://localhost');
      const narrativeResponse = maybeNarrativesResponse(path);
      if (narrativeResponse) return narrativeResponse;

      if (path.pathname === '/api/v1/reports') {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: 'report-first-mover-1',
                date: '2026-04-08',
                type: 'daily',
                tldr: 'One monitored voice surfaced the setup before broader copy-trade behavior appeared.',
                sentiment: 0.11,
                deliveryStatus: 'delivered',
                createdAt: Date.now(),
                firstMovers: ['Ethereum was first tracked by DeFi Dad roughly 4h before the next monitored call.'],
                unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
                macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
            total: 1,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('First Mover');
    expect(
      screen.getByText('Ethereum was first tracked by DeFi Dad roughly 4h before the next monitored call.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unusual Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Macro Alert')).not.toBeInTheDocument();
  });

  it('renders a macro regime chip when report previews include regime history', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'http://localhost');
      const narrativeResponse = maybeNarrativesResponse(path);
      if (narrativeResponse) return narrativeResponse;

      if (path.pathname === '/api/v1/reports') {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: 'report-regime-1',
                date: '2026-04-08',
                type: 'daily',
                tldr: 'Rates stayed firm while crypto sentiment stabilized.',
                sentiment: -0.08,
                deliveryStatus: 'delivered',
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
            total: 1,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Macro regime · Risk-off · Day 3')).toBeInTheDocument();
  });

  it('renders a compact narrative snapshot above the report cards when latest narratives exist', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'http://localhost');
      const narrativeResponse = maybeNarrativesResponse(path, {
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
      });
      if (narrativeResponse) return narrativeResponse;

      if (path.pathname === '/api/v1/reports') {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: 'report-1',
                date: '2026-04-08',
                type: 'daily',
                tldr: 'BTC held gains while traders watched new sector rotation themes.',
                sentiment: 0.19,
                deliveryStatus: 'delivered',
                createdAt: Date.now(),
                eventChains: [],
                chainDrilldowns: [],
              },
            ],
            total: 1,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Narrative Snapshot');
    expect(screen.getByText(/Detailed evidence remains in Settings/)).toBeInTheDocument();
    expect(screen.getByText('Solana fee rebound')).toBeInTheDocument();
    expect(screen.getByText('Emerging')).toBeInTheDocument();
    expect(screen.getByText('6 summaries')).toBeInTheDocument();
    expect(screen.getByText('sentiment +0.42')).toBeInTheDocument();
    expect(screen.getByText('BTC treasury chatter')).toBeInTheDocument();
    expect(screen.getByText('Fading')).toBeInTheDocument();
    expect(screen.getByText('2026-04-08')).toBeInTheDocument();
  });
});
