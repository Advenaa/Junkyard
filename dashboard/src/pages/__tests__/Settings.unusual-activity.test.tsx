import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: 'activity-admin',
      avatar: null,
      role: 'admin' as const,
    },
    loading: false,
    logout: vi.fn(),
  }),
}));

interface UnusualActivityOverview {
  latestDate: string | null;
  entries: Array<{
    entityId: string;
    entityName: string;
    date: string;
    mentionCount: number;
    baselineMentionCount: number | null;
    baselinePeakMentionCount: number | null;
    baselineDays: number;
    avgSentiment: number | null;
    momentum: number | null;
    spikeRatio: number | null;
    relevanceScore: number | null;
    lowRelevance: boolean;
    duplicateClusterSize: number | null;
    duplicateAuthorCount: number | null;
    duplicateSourceCount: number | null;
  }>;
}

function buildFetchMock(unusualActivity: UnusualActivityOverview) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url, 'http://localhost');
    const path = requestUrl.pathname;
    const method = init?.method ?? 'GET';

    if (path === '/api/v1/sources' && method === 'GET') {
      return new Response(JSON.stringify({ sources: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/discord/tokens' && method === 'GET') {
      return new Response(JSON.stringify({ tokens: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/discord/tokens/health' && method === 'GET') {
      return new Response(JSON.stringify({ states: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/status' && method === 'GET') {
      return new Response(JSON.stringify({ itemsReady: 4, itemsProcessing: 1, summariesToday: 9, costToday: 1.42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/health' && method === 'GET') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          checks: [{ name: 'db', status: 'ok', message: 'healthy' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    if (path === '/api/v1/calendar-events' && method === 'GET') {
      return new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/macro' && method === 'GET') {
      return new Response(JSON.stringify({ error: 'No macro data available yet' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/unusual-activity' && method === 'GET') {
      return new Response(JSON.stringify(unusualActivity), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/narratives' && method === 'GET') {
      return new Response(JSON.stringify({ latestDate: '2026-04-08', entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unhandled fetch ${method} ${path}`);
  });
}

describe('Settings unusual activity card', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows unusual activity entries in the Pipeline tab when spikes are present', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock({
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
          {
            entityId: 'ent-sonic',
            entityName: 'Sonic',
            date: '2026-04-08',
            mentionCount: 14,
            baselineMentionCount: null,
            baselinePeakMentionCount: null,
            baselineDays: 0,
            avgSentiment: 0.58,
            momentum: null,
            spikeRatio: null,
            relevanceScore: 18.5,
            lowRelevance: false,
            duplicateClusterSize: null,
            duplicateAuthorCount: null,
            duplicateSourceCount: null,
          },
        ],
      }),
    );

    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole('button', { name: 'Pipeline' }));

    await screen.findByText('Unusual Activity');
    expect(screen.getByText('2026-04-08')).toBeInTheDocument();
    expect(screen.getByText('Omni')).toBeInTheDocument();
    expect(screen.getByText('4.0x baseline')).toBeInTheDocument();
    expect(screen.getByText('today 18 mentions')).toBeInTheDocument();
    expect(screen.getByText('baseline 4.5/day')).toBeInTheDocument();
    expect(screen.getByText('prior peak 7')).toBeInTheDocument();
    expect(screen.getByText('low relevance 1.4')).toBeInTheDocument();
    expect(screen.getByText('copy cluster 3 posts')).toBeInTheDocument();
    expect(screen.getByText('3 authors')).toBeInTheDocument();
    expect(screen.getByText('momentum +0.31')).toBeInTheDocument();
    expect(screen.getByText('sentiment 0.62')).toBeInTheDocument();
    expect(screen.getByText('Sonic')).toBeInTheDocument();
    expect(screen.getByText('New breakout')).toBeInTheDocument();
  });

  it('shows an empty state when nothing clears the unusual-activity heuristic', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ latestDate: '2026-04-08', entries: [] }));

    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole('button', { name: 'Pipeline' }));

    await screen.findByText('No unusual activity on the latest rollup');
    expect(
      screen.getByText(
        'Entities with outsized daily mention spikes or strong same-day copy clusters will appear here once Podders has enough history to compare against a recent baseline.',
      ),
    ).toBeInTheDocument();
  });
});
