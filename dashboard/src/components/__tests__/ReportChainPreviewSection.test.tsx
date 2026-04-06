import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ReportChainPreviewSection } from '../ReportChainPreviewSection';
import type { ReportChainRefreshAction, ReportChainToggleAction } from '../../lib/reportChains';
import type { ReportChainDrilldown } from '../../lib/types';

const previewChains: ReportChainDrilldown[] = [
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

const expandedChains: ReportChainDrilldown[] = [
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
];

const refreshedExpandedChains: ReportChainDrilldown[] = [
  {
    rootId: 'chain-root-4',
    entityName: 'Chainlink',
    eventCount: 3,
    firstEventTime: Date.UTC(2026, 3, 4, 7, 0, 0),
    latestEventTime: Date.UTC(2026, 3, 6, 8, 30, 0),
    eventTypes: ['partnership', 'governance', 'legal'],
    latestSummaryId: 'summary-18',
    latestEventType: 'legal',
    latestEventDescription: 'Chainlink replaced the previously cached hidden chain on refresh.',
  },
  ...previewChains,
];

const alternatePreviewChains: ReportChainDrilldown[] = [
  previewChains[0],
  {
    rootId: 'chain-root-9',
    entityName: 'Avalanche',
    eventCount: 2,
    firstEventTime: Date.UTC(2026, 3, 5, 11, 30, 0),
    latestEventTime: Date.UTC(2026, 3, 6, 10, 30, 0),
    eventTypes: ['audit', 'governance'],
    latestSummaryId: 'summary-22',
    latestEventType: 'audit',
    latestEventDescription: 'Avalanche replaced the second visible preview chain.',
  },
];

function ReportChainPreviewHarness({
  initialPreviewBody,
  initialLeadChainLabel,
  initialLeadChainHref,
  initialFocusedReportHref = null,
  initialVisibleChainCount,
  ...props
}: {
  initialPreviewBody: string;
  initialLeadChainLabel: string;
  initialLeadChainHref: string | null;
  initialFocusedReportHref?: string | null;
  initialVisibleChainCount: number;
  reportId: string;
  chainDrilldowns: ReportChainDrilldown[];
  hiddenActiveChainCount?: number;
  previewSummary?: string;
}) {
  const [currentPreviewBody, setCurrentPreviewBody] = useState<string | null>(initialPreviewBody);
  const [currentLeadChainLabel, setCurrentLeadChainLabel] = useState<string | null>(initialLeadChainLabel);
  const [currentLeadChainHref, setCurrentLeadChainHref] = useState<string | null>(initialLeadChainHref);
  const [currentFocusedReportHref, setCurrentFocusedReportHref] = useState<string | null>(initialFocusedReportHref);
  const [currentVisibleChainCount, setCurrentVisibleChainCount] = useState(initialVisibleChainCount);
  const [currentStoryAction, setCurrentStoryAction] = useState<ReportChainToggleAction>({
    mode: 'none',
    controlLabel: null,
    disabled: false,
  });
  const [currentRefreshAction, setCurrentRefreshAction] = useState<ReportChainRefreshAction>({
    visible: false,
    controlLabel: null,
    disabled: false,
  });
  const [toggleVisibleChainsRequest, setToggleVisibleChainsRequest] = useState<number | undefined>(undefined);
  const [refreshVisibleChainsRequest, setRefreshVisibleChainsRequest] = useState<number | undefined>(undefined);

  return (
    <>
      <p>{currentPreviewBody ?? ''}</p>
      <p>{currentLeadChainLabel ?? ''}</p>
      {currentLeadChainHref ? <a href={currentLeadChainHref}>Lead chain route</a> : <p>No lead chain route</p>}
      {currentFocusedReportHref ? (
        <a href={currentFocusedReportHref}>Focused report route</a>
      ) : (
        <p>No focused report route</p>
      )}
      <p>
        {currentStoryAction.controlLabel
          ? `Header action · ${currentStoryAction.controlLabel}`
          : 'Header action · none'}
      </p>
      <button
        type="button"
        onClick={() => setToggleVisibleChainsRequest((prev) => (prev ?? 0) + 1)}
        disabled={currentStoryAction.mode === 'none' || currentStoryAction.disabled}
      >
        Header active stories
      </button>
      <p>
        {currentRefreshAction.controlLabel
          ? `Header refresh · ${currentRefreshAction.controlLabel}`
          : 'Header refresh · none'}
      </p>
      <button
        type="button"
        onClick={() => setRefreshVisibleChainsRequest((prev) => (prev ?? 0) + 1)}
        disabled={!currentRefreshAction.visible || currentRefreshAction.disabled}
      >
        Header refresh stories
      </button>
      <p>Visible chains · {currentVisibleChainCount}</p>
      <ReportChainPreviewSection
        {...props}
        previewBody={initialPreviewBody}
        onFocusedReportHrefChange={setCurrentFocusedReportHref}
        onPreviewBodyChange={setCurrentPreviewBody}
        onLeadChainLabelChange={setCurrentLeadChainLabel}
        onLeadChainHrefChange={setCurrentLeadChainHref}
        onVisibleChainCountChange={setCurrentVisibleChainCount}
        onHeaderStoryActionChange={setCurrentStoryAction}
        onHeaderRefreshActionChange={setCurrentRefreshAction}
        toggleVisibleChainsRequest={toggleVisibleChainsRequest}
        refreshVisibleChainsRequest={refreshVisibleChainsRequest}
      />
    </>
  );
}

describe('ReportChainPreviewSection', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('keeps expanded chain links sticky across remounts for the same report preview', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/reports/report-1') {
        return new Response(
          JSON.stringify({
            report: {
              chainDrilldowns: expandedChains,
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

    const user = userEvent.setup();
    const firstRender = render(
      <MemoryRouter>
        <ReportChainPreviewSection
          reportId="report-1"
          chainDrilldowns={previewChains}
          hiddenActiveChainCount={1}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Active chains | 2 stories')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 1 more active chain' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('link', { name: 'Solana · audit · 4 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-14?chain=chain-root-3',
    );
    expect(screen.getByText('Active chains | 3 stories')).toBeInTheDocument();

    firstRender.unmount();

    render(
      <MemoryRouter>
        <ReportChainPreviewSection
          reportId="report-1"
          chainDrilldowns={previewChains}
          hiddenActiveChainCount={1}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Show fewer chains' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show 1 more active chain' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Solana · audit · 4 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-14?chain=chain-root-3',
    );
    expect(screen.getByText('Active chains | 3 stories')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets users collapse sticky expanded chains back to the preview set', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/reports/report-1') {
        return new Response(
          JSON.stringify({
            report: {
              chainDrilldowns: expandedChains,
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

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ReportChainPreviewSection
          reportId="report-1"
          chainDrilldowns={previewChains}
          hiddenActiveChainCount={1}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Show 1 more active chain' }));
    expect(await screen.findByRole('link', { name: 'Solana · audit · 4 linked events' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show fewer chains' }));

    expect(screen.queryByRole('link', { name: 'Solana · audit · 4 linked events' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 1 more active chain' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show fewer chains' })).not.toBeInTheDocument();
    expect(screen.getByText('Active chains | 2 stories')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('podders:report-chain-preview:report-1')).toBeNull();
  });

  it('drops stale cached expansions when the current preview chains change', () => {
    window.sessionStorage.setItem(
      'podders:report-chain-preview:report-1',
      JSON.stringify({
        previewRootIds: previewChains.map((chain) => chain.rootId),
        expandedChains,
      }),
    );

    render(
      <MemoryRouter>
        <ReportChainPreviewSection
          reportId="report-1"
          chainDrilldowns={alternatePreviewChains}
          hiddenActiveChainCount={1}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Active chains | 2 stories')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Solana · audit · 4 linked events' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Avalanche · audit · 2 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-22?chain=chain-root-9',
    );
    expect(screen.getByRole('button', { name: 'Show 1 more active chain' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show fewer chains' })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('podders:report-chain-preview:report-1')).toBeNull();
  });

  it('keeps show-more visible when cached expansion covers only part of the current overflow', () => {
    window.sessionStorage.setItem(
      'podders:report-chain-preview:report-1',
      JSON.stringify({
        previewRootIds: previewChains.map((chain) => chain.rootId),
        expandedChains,
      }),
    );

    render(
      <MemoryRouter>
        <ReportChainPreviewSection
          reportId="report-1"
          chainDrilldowns={previewChains}
          hiddenActiveChainCount={2}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Active chains | 3 stories')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Solana · audit · 4 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-14?chain=chain-root-3',
    );
    expect(screen.getByRole('button', { name: 'Show 1 more active chain' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer chains' })).toBeInTheDocument();
  });

  it('drops cached expansions that exceed the current hidden-chain count', () => {
    window.sessionStorage.setItem(
      'podders:report-chain-preview:report-1',
      JSON.stringify({
        previewRootIds: previewChains.map((chain) => chain.rootId),
        expandedChains,
      }),
    );

    render(
      <MemoryRouter>
        <ReportChainPreviewSection
          reportId="report-1"
          chainDrilldowns={previewChains}
          hiddenActiveChainCount={0}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Active chains | 2 stories')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Solana · audit · 4 linked events' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show fewer chains' })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('podders:report-chain-preview:report-1')).toBeNull();
  });

  it('lets header-level story controls expand and collapse the inline chain preview', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/reports/report-1') {
        return new Response(
          JSON.stringify({
            report: {
              chainDrilldowns: expandedChains,
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

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ReportChainPreviewHarness
          initialPreviewBody="Bitcoin held gains while traders watched follow-up risk around a live exploit story."
          initialLeadChainLabel="Bitcoin · governance"
          initialLeadChainHref="/summaries/summary-9?chain=chain-root-1"
          initialVisibleChainCount={2}
          reportId="report-1"
          chainDrilldowns={previewChains}
          hiddenActiveChainCount={1}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Header action · Show 1 more active chain')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Header active stories' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('link', { name: 'Solana · audit · 4 linked events' })).toBeInTheDocument();
    expect(await screen.findByText('Header action · Show fewer chains')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Header active stories' }));

    expect(screen.queryByRole('link', { name: 'Solana · audit · 4 linked events' })).not.toBeInTheDocument();
    expect(screen.getByText('Header action · Show 1 more active chain')).toBeInTheDocument();
  });

  it('publishes a loading label to the header while story expansion is pending', async () => {
    let resolveFetch!: (value: Response) => void;

    const fetchMock = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ReportChainPreviewHarness
          initialPreviewBody="Bitcoin held gains while traders watched follow-up risk around a live exploit story."
          initialLeadChainLabel="Bitcoin · governance"
          initialLeadChainHref="/summaries/summary-9?chain=chain-root-1"
          initialVisibleChainCount={2}
          reportId="report-1"
          chainDrilldowns={previewChains}
          hiddenActiveChainCount={1}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Header active stories' }));

    expect(screen.getByText('Header action · Loading stories...')).toBeInTheDocument();

    resolveFetch(
      new Response(
        JSON.stringify({
          report: {
            chainDrilldowns: expandedChains,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    expect(await screen.findByRole('link', { name: 'Solana · audit · 4 linked events' })).toBeInTheDocument();
    expect(await screen.findByText('Header action · Show fewer chains')).toBeInTheDocument();
  });

  it('publishes a retry label to the header after story expansion fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/reports/report-1') {
        throw new Error('expand failed');
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ReportChainPreviewHarness
          initialPreviewBody="Bitcoin held gains while traders watched follow-up risk around a live exploit story."
          initialLeadChainLabel="Bitcoin · governance"
          initialLeadChainHref="/summaries/summary-9?chain=chain-root-1"
          initialVisibleChainCount={2}
          reportId="report-1"
          chainDrilldowns={previewChains}
          hiddenActiveChainCount={1}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Header active stories' }));

    expect(await screen.findByText('Header action · Retry loading stories')).toBeInTheDocument();
    expect(screen.getByText('Failed to load more active chains.')).toBeInTheDocument();
  });

  it('refreshes fully expanded chains in place without forcing a collapse', async () => {
    let reportFetchCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/reports/report-1') {
        reportFetchCount += 1;
        const nextChains = reportFetchCount === 1 ? expandedChains : refreshedExpandedChains;
        return new Response(
          JSON.stringify({
            report: {
              chainDrilldowns: nextChains,
              tldr:
                reportFetchCount === 1
                  ? 'Bitcoin held gains while traders watched the audit response stay live.'
                  : 'Chainlink took over the preview focus after the refreshed active-chain pull.',
              eventChains: [
                reportFetchCount === 1
                  ? 'Bitcoin exploit chain: audit follow-up kept the remediation story active.'
                  : 'Bitcoin exploit chain: legal follow-up moved the latest active story set to Chainlink.',
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

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ReportChainPreviewHarness
          initialPreviewBody="Bitcoin held gains while traders watched follow-up risk around a live exploit story."
          initialLeadChainLabel="Bitcoin · governance"
          initialLeadChainHref="/summaries/summary-9?chain=chain-root-1"
          initialVisibleChainCount={2}
          reportId="report-1"
          chainDrilldowns={previewChains}
          hiddenActiveChainCount={1}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText('Bitcoin exploit chain: audit follow-up kept the remediation story active.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Bitcoin held gains while traders watched follow-up risk around a live exploit story.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Bitcoin · governance')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead chain route' })).toHaveAttribute(
      'href',
      '/summaries/summary-9?chain=chain-root-1',
    );
    expect(screen.getByRole('link', { name: 'Open focused report' })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-1',
    );
    expect(screen.getByText('Visible chains · 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 1 more active chain' }));
    expect(await screen.findByRole('link', { name: 'Solana · audit · 4 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-14?chain=chain-root-3',
    );
    expect(screen.getByRole('button', { name: 'Refresh chains' })).toBeInTheDocument();
    expect(
      screen.getByText('Bitcoin held gains while traders watched the audit response stay live.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Bitcoin · governance')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead chain route' })).toHaveAttribute(
      'href',
      '/summaries/summary-9?chain=chain-root-1',
    );
    expect(screen.getByRole('link', { name: 'Open focused report' })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-1',
    );
    expect(screen.getByText('Visible chains · 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh chains' }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('link', { name: 'Chainlink · legal · 3 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-18?chain=chain-root-4',
    );
    expect(
      screen.getByText('Bitcoin exploit chain: legal follow-up moved the latest active story set to Chainlink.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Chainlink took over the preview focus after the refreshed active-chain pull.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Chainlink · legal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead chain route' })).toHaveAttribute(
      'href',
      '/summaries/summary-18?chain=chain-root-4',
    );
    expect(screen.getByRole('link', { name: 'Open focused report' })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-4',
    );
    expect(
      screen.queryByText('Bitcoin exploit chain: audit follow-up kept the remediation story active.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Bitcoin held gains while traders watched follow-up risk around a live exploit story.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Bitcoin · governance')).not.toBeInTheDocument();
    expect(screen.getByText('Visible chains · 3')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Solana · audit · 4 linked events' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer chains' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh chains' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show fewer chains' }));

    expect(
      screen.getByText('Bitcoin held gains while traders watched follow-up risk around a live exploit story.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Bitcoin · governance')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead chain route' })).toHaveAttribute(
      'href',
      '/summaries/summary-9?chain=chain-root-1',
    );
    expect(screen.getByRole('link', { name: 'Open focused report' })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-1',
    );
    expect(screen.getByText('Visible chains · 2')).toBeInTheDocument();
    expect(
      screen.queryByText('Chainlink took over the preview focus after the refreshed active-chain pull.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Chainlink · legal')).not.toBeInTheDocument();
  });

  it('lets header-level refresh controls refetch fully expanded chains in place', async () => {
    let reportFetchCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/reports/report-1') {
        reportFetchCount += 1;
        const nextChains = reportFetchCount === 1 ? expandedChains : refreshedExpandedChains;
        return new Response(
          JSON.stringify({
            report: {
              chainDrilldowns: nextChains,
              tldr:
                reportFetchCount === 1
                  ? 'Bitcoin held gains while traders watched the audit response stay live.'
                  : 'Chainlink took over the preview focus after the refreshed active-chain pull.',
              eventChains: [
                reportFetchCount === 1
                  ? 'Bitcoin exploit chain: audit follow-up kept the remediation story active.'
                  : 'Bitcoin exploit chain: legal follow-up moved the latest active story set to Chainlink.',
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

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ReportChainPreviewHarness
          initialPreviewBody="Bitcoin held gains while traders watched follow-up risk around a live exploit story."
          initialLeadChainLabel="Bitcoin · governance"
          initialLeadChainHref="/summaries/summary-9?chain=chain-root-1"
          initialVisibleChainCount={2}
          reportId="report-1"
          chainDrilldowns={previewChains}
          hiddenActiveChainCount={1}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Header active stories' }));
    expect(await screen.findByRole('link', { name: 'Solana · audit · 4 linked events' })).toBeInTheDocument();
    expect(screen.getByText('Header refresh · Refresh stories')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Header refresh stories' }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('link', { name: 'Chainlink · legal · 3 linked events' })).toHaveAttribute(
      'href',
      '/summaries/summary-18?chain=chain-root-4',
    );
    expect(
      screen.getByText('Chainlink took over the preview focus after the refreshed active-chain pull.'),
    ).toBeInTheDocument();
  });

  it('publishes a loading label to the header while refresh is pending', async () => {
    let reportFetchCount = 0;
    let resolveRefreshFetch!: (value: Response) => void;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/reports/report-1') {
        reportFetchCount += 1;

        if (reportFetchCount === 1) {
          return new Response(
            JSON.stringify({
              report: {
                chainDrilldowns: expandedChains,
                tldr: 'Bitcoin held gains while traders watched the audit response stay live.',
                eventChains: ['Bitcoin exploit chain: audit follow-up kept the remediation story active.'],
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

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ReportChainPreviewHarness
          initialPreviewBody="Bitcoin held gains while traders watched follow-up risk around a live exploit story."
          initialLeadChainLabel="Bitcoin · governance"
          initialLeadChainHref="/summaries/summary-9?chain=chain-root-1"
          initialVisibleChainCount={2}
          reportId="report-1"
          chainDrilldowns={previewChains}
          hiddenActiveChainCount={1}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Header active stories' }));
    expect(await screen.findByRole('link', { name: 'Solana · audit · 4 linked events' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Header refresh stories' }));

    expect(screen.getByText('Header refresh · Refreshing stories...')).toBeInTheDocument();

    resolveRefreshFetch(
      new Response(
        JSON.stringify({
          report: {
            chainDrilldowns: refreshedExpandedChains,
            tldr: 'Chainlink took over the preview focus after the refreshed active-chain pull.',
            eventChains: ['Bitcoin exploit chain: legal follow-up moved the latest active story set to Chainlink.'],
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    expect(await screen.findByRole('link', { name: 'Chainlink · legal · 3 linked events' })).toBeInTheDocument();
    expect(await screen.findByText('Header refresh · Refresh stories')).toBeInTheDocument();
  });

  it('publishes a retry label to the header after refresh fails', async () => {
    let reportFetchCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/reports/report-1') {
        reportFetchCount += 1;

        if (reportFetchCount === 1) {
          return new Response(
            JSON.stringify({
              report: {
                chainDrilldowns: expandedChains,
                tldr: 'Bitcoin held gains while traders watched the audit response stay live.',
                eventChains: ['Bitcoin exploit chain: audit follow-up kept the remediation story active.'],
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

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ReportChainPreviewHarness
          initialPreviewBody="Bitcoin held gains while traders watched follow-up risk around a live exploit story."
          initialLeadChainLabel="Bitcoin · governance"
          initialLeadChainHref="/summaries/summary-9?chain=chain-root-1"
          initialVisibleChainCount={2}
          reportId="report-1"
          chainDrilldowns={previewChains}
          hiddenActiveChainCount={1}
          previewSummary="Bitcoin exploit chain: audit follow-up kept the remediation story active."
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Header active stories' }));
    expect(await screen.findByRole('link', { name: 'Solana · audit · 4 linked events' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Header refresh stories' }));

    expect(await screen.findByText('Header refresh · Retry refresh stories')).toBeInTheDocument();
    expect(screen.getByText('Failed to refresh active chains.')).toBeInTheDocument();
  });
});
