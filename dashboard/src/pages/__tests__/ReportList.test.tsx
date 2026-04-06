import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportList } from '../ReportList';

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

    vi.stubGlobal(
      'fetch',
      fetchMock,
    );

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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
      screen.getByRole('link', { name: /Chainlink took over the preview focus after the refreshed active-chain pull/i }),
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

    expect(fetchMock).toHaveBeenCalledTimes(3);
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
      screen.getByRole('link', { name: /Bitcoin held gains while traders watched follow-up risk around a live exploit story/i }),
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
});
