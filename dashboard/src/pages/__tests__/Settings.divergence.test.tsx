import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: 'divergence-viewer',
      avatar: null,
      role: 'admin' as const,
    },
    loading: false,
    logout: vi.fn(),
  }),
}));
vi.mock('../../components/StatusProvider', () => {
  const statusValue = {
    ready: true,
    status: { itemsReady: 0, itemsProcessing: 0, summariesToday: 0, costToday: 0, disabledFeatures: [] },
    disabledFeatures: [],
    isFeatureDisabled: () => false,
    getDisabledFeature: () => null,
    registerDisabledFeature: vi.fn(),
  };
  return { useStatus: () => statusValue };
});

// ── Shared mock data ───────────────────────────────────────────────────

const knownEntities = [
  { id: 'ent-btc', name: 'Bitcoin', matchedAlias: 'btc' },
  { id: 'ent-eth', name: 'Ethereum', matchedAlias: 'eth' },
];

interface DivergenceResponse {
  engSentiment: number;
  engMentions: number;
  indSentiment: number;
  indMentions: number;
  divergence: number;
}

function makeDivergenceResponse(overrides?: Partial<DivergenceResponse>): DivergenceResponse {
  return {
    engSentiment: 0.72,
    engMentions: 24,
    indSentiment: 0.18,
    indMentions: 15,
    divergence: 0.54,
    ...overrides,
  };
}

function makeEmptyDivergenceResponse(): DivergenceResponse {
  return {
    engSentiment: 0,
    engMentions: 0,
    indSentiment: 0,
    indMentions: 0,
    divergence: 0,
  };
}

/**
 * Build a fetch mock that handles all necessary Settings endpoints.
 * divergenceHandler can be overridden per test to return different divergence data.
 */
function buildFetchMock(divergenceHandler: (entityId: string, days: number) => DivergenceResponse) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url, 'http://localhost');
    const path = requestUrl.pathname;
    const method = init?.method ?? 'GET';

    // Sources
    if (path === '/api/v1/sources' && method === 'GET') {
      return new Response(JSON.stringify({ sources: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Discord tokens
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

    // Entity search
    if (path === '/api/v1/entities/search' && method === 'GET') {
      const q = requestUrl.searchParams.get('q')?.toLowerCase() ?? '';
      const entities = knownEntities.filter(
        (entity) => entity.name.toLowerCase().startsWith(q) || (entity.matchedAlias?.startsWith(q) ?? false),
      );
      return new Response(JSON.stringify({ entities }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Entity relationships
    const relationshipsMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/relationships$/);
    if (relationshipsMatch && method === 'GET') {
      return new Response(JSON.stringify({ relationships: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Entity graph
    const graphMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/graph$/);
    if (graphMatch && method === 'GET') {
      const entityId = graphMatch[1];
      const entity = knownEntities.find((e) => e.id === entityId);
      return new Response(
        JSON.stringify({
          rootEntityId: entityId,
          nodes: [{ id: entityId, name: entity?.name ?? entityId, depth: 0, isRoot: true }],
          relationships: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Entity competitors
    const competitorsMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/competitors$/);
    if (competitorsMatch && method === 'GET') {
      return new Response(JSON.stringify({ competitors: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Entity divergence
    const divergenceMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/divergence$/);
    if (divergenceMatch && method === 'GET') {
      const entityId = divergenceMatch[1];
      const days = Number(requestUrl.searchParams.get('days') ?? '7');
      const data = divergenceHandler(entityId, days);
      return new Response(JSON.stringify({ divergence: data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unhandled fetch ${method} ${path}${requestUrl.search}`);
  });
}

function countRequests(fetchMock: ReturnType<typeof vi.fn>, pattern: RegExp): number {
  return fetchMock.mock.calls.filter(([input]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return pattern.test(new URL(url, 'http://localhost').pathname);
  }).length;
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Settings entity divergence', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows Regional Divergence section with EN and ID sentiment data when an entity is selected', async () => {
    const divergenceData = makeDivergenceResponse({
      engSentiment: 0.72,
      engMentions: 24,
      indSentiment: 0.18,
      indMentions: 15,
      divergence: 0.54,
    });

    vi.stubGlobal(
      'fetch',
      buildFetchMock(() => divergenceData),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    // Navigate to Entities tab
    await user.click(screen.getByRole('button', { name: 'Entities' }));

    // Search and select an entity
    await user.type(screen.getByPlaceholderText('Search entities by name or alias'), 'Bit');
    await user.click(await screen.findByRole('button', { name: /Bitcoin/i }));

    // Wait for divergence section to appear
    await waitFor(() => {
      expect(screen.getByText('Regional Divergence')).toBeInTheDocument();
    });

    // Verify EN and ID sentiment labels are displayed
    expect(screen.getByText('EN sentiment')).toBeInTheDocument();
    expect(screen.getByText('ID sentiment')).toBeInTheDocument();

    // Verify sentiment values are shown (toFixed(2) format)
    expect(screen.getByText(/0\.72/)).toBeInTheDocument();
    expect(screen.getByText(/0\.18/)).toBeInTheDocument();

    // Verify mention counts are shown
    expect(screen.getByText(/24 mentions/)).toBeInTheDocument();
    expect(screen.getByText(/15 mentions/)).toBeInTheDocument();

    // Verify divergence badge — with divergence = 0.54 (> 0.3), should show "Divergent"
    expect(screen.getByText(/Divergent/i)).toBeInTheDocument();
    expect(screen.getByText(/0\.54/)).toBeInTheDocument();
  });

  it('shows Aligned badge when divergence is low', async () => {
    const divergenceData = makeDivergenceResponse({
      engSentiment: 0.45,
      engMentions: 10,
      indSentiment: 0.42,
      indMentions: 8,
      divergence: 0.03,
    });

    vi.stubGlobal(
      'fetch',
      buildFetchMock(() => divergenceData),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Entities' }));
    await user.type(screen.getByPlaceholderText('Search entities by name or alias'), 'Bit');
    await user.click(await screen.findByRole('button', { name: /Bitcoin/i }));

    await waitFor(() => {
      expect(screen.getByText('Regional Divergence')).toBeInTheDocument();
    });

    expect(screen.getByText(/Aligned/i)).toBeInTheDocument();
  });

  it('shows Moderate badge when divergence is between 0.15 and 0.3', async () => {
    const divergenceData = makeDivergenceResponse({
      engSentiment: 0.6,
      engMentions: 12,
      indSentiment: 0.35,
      indMentions: 9,
      divergence: 0.25,
    });

    vi.stubGlobal(
      'fetch',
      buildFetchMock(() => divergenceData),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Entities' }));
    await user.type(screen.getByPlaceholderText('Search entities by name or alias'), 'Bit');
    await user.click(await screen.findByRole('button', { name: /Bitcoin/i }));

    await waitFor(() => {
      expect(screen.getByText('Regional Divergence')).toBeInTheDocument();
    });

    expect(screen.getByText(/Moderate/i)).toBeInTheDocument();
  });

  it('shows empty state when both mention counts are zero', async () => {
    const emptyData = makeEmptyDivergenceResponse();

    vi.stubGlobal(
      'fetch',
      buildFetchMock(() => emptyData),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Entities' }));
    await user.type(screen.getByPlaceholderText('Search entities by name or alias'), 'Bit');
    await user.click(await screen.findByRole('button', { name: /Bitcoin/i }));

    await waitFor(() => {
      expect(screen.getByText('Regional Divergence')).toBeInTheDocument();
    });

    // When there are 0 mentions in both languages, the EmptyState component renders
    expect(screen.getByText('No regional data')).toBeInTheDocument();
    expect(screen.getByText(/no English or Indonesian mentions/i)).toBeInTheDocument();
  });

  it('changes lookback window when days selector is used', async () => {
    let lastRequestedDays: number | null = null;

    const fetchMock = buildFetchMock((_entityId, days) => {
      lastRequestedDays = days;
      return makeDivergenceResponse({
        engSentiment: 0.5,
        engMentions: days * 3,
        indSentiment: 0.4,
        indMentions: days * 2,
        divergence: 0.1,
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Entities' }));
    await user.type(screen.getByPlaceholderText('Search entities by name or alias'), 'Bit');
    await user.click(await screen.findByRole('button', { name: /Bitcoin/i }));

    await waitFor(() => {
      expect(screen.getByText('Regional Divergence')).toBeInTheDocument();
    });

    // Default is 7 days
    expect(lastRequestedDays).toBe(7);
    expect(countRequests(fetchMock, /^\/api\/v1\/entities\/[^/]+\/relationships$/)).toBe(1);
    expect(countRequests(fetchMock, /^\/api\/v1\/entities\/[^/]+\/competitors$/)).toBe(1);
    expect(countRequests(fetchMock, /^\/api\/v1\/entities\/[^/]+\/graph$/)).toBe(1);
    expect(countRequests(fetchMock, /^\/api\/v1\/entities\/[^/]+\/divergence$/)).toBe(1);

    // Click the "30d" button to change the lookback window
    const btn30 = screen.getByRole('button', { name: /30d/i });
    await user.click(btn30);

    // Verify the days parameter was updated to 30 in a subsequent fetch
    await waitFor(() => {
      expect(lastRequestedDays).toBe(30);
    });

    expect(countRequests(fetchMock, /^\/api\/v1\/entities\/[^/]+\/relationships$/)).toBe(1);
    expect(countRequests(fetchMock, /^\/api\/v1\/entities\/[^/]+\/competitors$/)).toBe(1);
    expect(countRequests(fetchMock, /^\/api\/v1\/entities\/[^/]+\/graph$/)).toBe(1);
    expect(countRequests(fetchMock, /^\/api\/v1\/entities\/[^/]+\/divergence$/)).toBe(2);
  });
});
