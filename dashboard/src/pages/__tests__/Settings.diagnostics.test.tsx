import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { StatusProvider } from '../../components/StatusProvider';
import { Settings } from '../Settings';

let mockRole: 'admin' | 'viewer' = 'admin';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: mockRole === 'admin' ? 'pipeline-admin' : 'pipeline-viewer',
      avatar: null,
      role: mockRole,
    },
    loading: false,
    logout: vi.fn(),
  }),
}));

interface DiagnosticsFixtures {
  status?: {
    itemsReady?: number;
    itemsProcessing?: number;
    summariesToday?: number;
    costToday?: number;
  };
  backpressure?: {
    readyCount: number;
    processingCount: number;
    oldestReadyAgeMs: number;
  };
  stuckItems?: {
    thresholdMs: number;
    stuckCount: number;
    oldestAgeMs: number;
    sample: Array<{
      id: string;
      source: string;
      sourceId: string;
      createdAt: string;
    }>;
  };
  haltedSources?: {
    haltedSources: Array<{
      source: string;
      sourceId: string;
      status: string;
      errorCount: number | null;
      lastError: string | null;
      lastFetchedAt: string | null;
    }>;
  };
  healthEvents?: {
    sinceMs: number;
    limit: number;
    events: Array<{
      id: string;
      category: string;
      severity: string;
      message: string;
      metadata: unknown;
      acknowledged: boolean;
      createdAt: string;
    }>;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createFetchMock(fixtures: DiagnosticsFixtures = {}) {
  const defaultStatus = {
    itemsReady: 4,
    itemsProcessing: 1,
    summariesToday: 9,
    costToday: 1.42,
    disabledFeatures: [
      { feature: 'macro', missingEnv: 'FRED_API_KEY', disables: ['macro snapshots'] },
      { feature: 'embeddings', missingEnv: 'GEMINI_API_KEY', disables: ['narrative clustering'] },
    ],
  };
  const defaultBackpressure = {
    readyCount: 7,
    processingCount: 2,
    oldestReadyAgeMs: 5_400_000,
  };
  const defaultStuckItems = {
    thresholdMs: 3_600_000,
    stuckCount: 0,
    oldestAgeMs: 0,
    sample: [],
  };
  const defaultHaltedSources = {
    haltedSources: [],
  };
  const defaultHealthEvents = {
    sinceMs: Date.UTC(2026, 3, 10, 0, 0, 0),
    limit: 10,
    events: [],
  };

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url, 'http://localhost');
    const path = requestUrl.pathname;
    const method = init?.method ?? 'GET';

    if (path === '/api/v1/status' && method === 'GET') {
      return jsonResponse({
        ...defaultStatus,
        ...fixtures.status,
      });
    }

    if (path === '/api/v1/sources' && method === 'GET') {
      return jsonResponse({ sources: [] });
    }

    if (path === '/api/v1/discord/tokens' && method === 'GET') {
      return jsonResponse({ tokens: [] });
    }

    if (path === '/api/v1/discord/tokens/health' && method === 'GET') {
      return jsonResponse({ states: [] });
    }

    if (path === '/api/v1/health' && method === 'GET') {
      return jsonResponse({
        status: 'ok',
        checks: [{ name: 'db', status: 'ok', message: 'healthy' }],
      });
    }

    if (path === '/api/v1/calendar-events' && method === 'GET') {
      return jsonResponse({ events: [] });
    }

    if (path === '/api/v1/unusual-activity' && method === 'GET') {
      return jsonResponse({ latestDate: '2026-04-08', entries: [] });
    }

    if (path === '/api/v1/diag/backpressure' && method === 'GET') {
      return jsonResponse(fixtures.backpressure ?? defaultBackpressure);
    }

    if (path === '/api/v1/diag/stuck-items' && method === 'GET') {
      return jsonResponse(fixtures.stuckItems ?? defaultStuckItems);
    }

    if (path === '/api/v1/diag/halted-sources' && method === 'GET') {
      return jsonResponse(fixtures.haltedSources ?? defaultHaltedSources);
    }

    if (path === '/api/v1/diag/health-events' && method === 'GET') {
      return jsonResponse(fixtures.healthEvents ?? defaultHealthEvents);
    }

    throw new Error(`Unhandled fetch ${method} ${path}${requestUrl.search}`);
  });
}

function sawPath(fetchMock: ReturnType<typeof vi.fn>, path: string): boolean {
  return fetchMock.mock.calls.some(([input]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return new URL(url, 'http://localhost').pathname === path;
  });
}

function renderSettings() {
  return render(
    <MemoryRouter>
      <StatusProvider>
        <Settings />
      </StatusProvider>
    </MemoryRouter>,
  );
}

async function openPipelineDiagnostics(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByText('Sources');
  await user.click(screen.getByRole('button', { name: 'Pipeline' }));
  await screen.findByText('System Health');
  await user.click(screen.getByRole('button', { name: /Diagnostics/ }));
}

describe('Settings diagnostics', () => {
  beforeEach(() => {
    mockRole = 'admin';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders diagnostics for admin users and fetches all four diagnostic endpoints', async () => {
    const fetchMock = createFetchMock({
      backpressure: {
        readyCount: 11,
        processingCount: 3,
        oldestReadyAgeMs: 7_200_000,
      },
      stuckItems: {
        thresholdMs: 3_600_000,
        stuckCount: 1,
        oldestAgeMs: 8_400_000,
        sample: [
          {
            id: 'item-1',
            source: 'twitter',
            sourceId: 'solana',
            createdAt: '2026-04-10T08:00:00.000Z',
          },
        ],
      },
      haltedSources: {
        haltedSources: [
          {
            source: 'discord',
            sourceId: 'channel-42',
            status: 'halted',
            errorCount: 3,
            lastError: 'Discord API returned repeated 429 responses for this channel.',
            lastFetchedAt: '2026-04-10T09:15:00.000Z',
          },
        ],
      },
      healthEvents: {
        sinceMs: Date.UTC(2026, 3, 10, 0, 0, 0),
        limit: 10,
        events: [
          {
            id: 'evt-1',
            category: 'db',
            severity: 'critical',
            message: 'Connection pool exhausted',
            metadata: { max: 10 },
            acknowledged: false,
            createdAt: '2026-04-10T10:30:00.000Z',
          },
        ],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderSettings();

    await openPipelineDiagnostics(user);

    await waitFor(() => {
      expect(sawPath(fetchMock, '/api/v1/diag/backpressure')).toBe(true);
      expect(sawPath(fetchMock, '/api/v1/diag/stuck-items')).toBe(true);
      expect(sawPath(fetchMock, '/api/v1/diag/halted-sources')).toBe(true);
      expect(sawPath(fetchMock, '/api/v1/diag/health-events')).toBe(true);
    });

    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('channel-42')).toBeInTheDocument();
    expect(screen.getByText('Connection pool exhausted')).toBeInTheDocument();
    expect(screen.getByText('twitter')).toBeInTheDocument();
  });

  it('hides diagnostics for non-admin users', async () => {
    mockRole = 'viewer';
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderSettings();

    await screen.findByText('Pipeline Status');
    expect(screen.queryByRole('button', { name: /Diagnostics/ })).not.toBeInTheDocument();
    expect(sawPath(fetchMock, '/api/v1/diag/backpressure')).toBe(false);
    expect(sawPath(fetchMock, '/api/v1/diag/stuck-items')).toBe(false);
    expect(sawPath(fetchMock, '/api/v1/diag/halted-sources')).toBe(false);
    expect(sawPath(fetchMock, '/api/v1/diag/health-events')).toBe(false);
  });

  it('shows the stuck items table when stuck items are present', async () => {
    const fetchMock = createFetchMock({
      stuckItems: {
        thresholdMs: 3_600_000,
        stuckCount: 2,
        oldestAgeMs: 9_000_000,
        sample: [
          {
            id: 'item-1',
            source: 'discord',
            sourceId: 'alpha-room',
            createdAt: '2026-04-10T06:30:00.000Z',
          },
          {
            id: 'item-2',
            source: 'rss',
            sourceId: 'feed-7',
            createdAt: '2026-04-10T07:00:00.000Z',
          },
        ],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderSettings();

    await openPipelineDiagnostics(user);

    const stuckTable = screen.getByRole('table');
    expect(within(stuckTable).getByText('alpha-room')).toBeInTheDocument();
    expect(within(stuckTable).getByText('feed-7')).toBeInTheDocument();
    expect(screen.queryByText('No stuck items above the current threshold.')).not.toBeInTheDocument();
  });

  it('shows the stuck items empty state when there are no stuck items', async () => {
    const fetchMock = createFetchMock({
      stuckItems: {
        thresholdMs: 3_600_000,
        stuckCount: 0,
        oldestAgeMs: 0,
        sample: [],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderSettings();

    await openPipelineDiagnostics(user);

    expect(screen.getByText('No stuck items above the current threshold.')).toBeInTheDocument();
    expect(screen.queryByText('alpha-room')).not.toBeInTheDocument();
  });
});
