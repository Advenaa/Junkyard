import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: 'price-admin',
      avatar: null,
      role: 'admin' as const,
    },
    loading: false,
    logout: vi.fn(),
  }),
}));

// ── Shared mock data ───────────────────────────────────────────────────

const knownEntities = [
  { id: 'ent-btc', name: 'Bitcoin', matchedAlias: 'btc' },
  { id: 'ent-eth', name: 'Ethereum', matchedAlias: 'eth' },
];

interface PriceSnapshot {
  id: string;
  entityId: string;
  timestamp: number;
  priceUsd: number;
  priceChange24h: number | null;
  priceChange7d: number | null;
  volume24h: number | null;
  marketCap: number | null;
  source: string;
  createdAt: number;
}

interface PriceData {
  latest: PriceSnapshot | null;
  history: PriceSnapshot[];
}

function makeSnapshot(overrides?: Partial<PriceSnapshot>): PriceSnapshot {
  return {
    id: 'snap-1',
    entityId: 'ent-btc',
    timestamp: Date.UTC(2026, 3, 7, 12, 0, 0),
    priceUsd: 68432.15,
    priceChange24h: 2.4,
    priceChange7d: -1.8,
    volume24h: 31_500_000_000,
    marketCap: 1_350_000_000_000,
    source: 'coingecko',
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeHistorySnapshots(): PriceSnapshot[] {
  const base = Date.UTC(2026, 3, 7, 12, 0, 0);
  const DAY = 86_400_000;
  return [
    makeSnapshot({ id: 'snap-1', timestamp: base, priceUsd: 68432.15, priceChange24h: 2.4 }),
    makeSnapshot({ id: 'snap-2', timestamp: base - DAY, priceUsd: 66800.0, priceChange24h: -0.5 }),
    makeSnapshot({ id: 'snap-3', timestamp: base - DAY * 2, priceUsd: 67100.5, priceChange24h: 1.1 }),
  ];
}

interface DivergenceResponse {
  engSentiment: number;
  engMentions: number;
  indSentiment: number;
  indMentions: number;
  divergence: number;
}

/**
 * Build a fetch mock that handles all necessary Settings endpoints.
 * priceHandler controls what the price endpoint returns per entity.
 */
function buildFetchMock(priceHandler: (entityId: string) => PriceData | null) {
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
      const data: DivergenceResponse = {
        engSentiment: 0.5,
        engMentions: 10,
        indSentiment: 0.4,
        indMentions: 8,
        divergence: 0.1,
      };
      return new Response(JSON.stringify({ divergence: data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Entity price
    const priceMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/price$/);
    if (priceMatch && method === 'GET') {
      const entityId = priceMatch[1];
      const data = priceHandler(entityId);
      if (data === null) {
        return new Response(JSON.stringify({ error: 'No price data' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unhandled fetch ${method} ${path}${requestUrl.search}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Settings entity price card', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows price card with price, 24h change, and market cap when price data exists', async () => {
    const latest = makeSnapshot({
      priceUsd: 68432.15,
      priceChange24h: 2.4,
      priceChange7d: -1.8,
      marketCap: 1_350_000_000_000,
      volume24h: 31_500_000_000,
    });
    const priceData: PriceData = { latest, history: [latest] };

    vi.stubGlobal(
      'fetch',
      buildFetchMock(() => priceData),
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

    // Wait for price card to appear
    await waitFor(() => {
      expect(screen.getByText('Price Data')).toBeInTheDocument();
    });

    // Verify price is displayed
    expect(screen.getByText(/68,432\.15/)).toBeInTheDocument();

    // Verify 24h change
    expect(screen.getByText(/\+2\.4% 24h/)).toBeInTheDocument();

    // Verify market cap
    expect(screen.getByText('Market Cap')).toBeInTheDocument();
    expect(screen.getByText(/1350\.00B/)).toBeInTheDocument();
  });

  it('does not show price card when price endpoint returns 404', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock(() => null),
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

    // Wait for entity details to finish loading (divergence should appear)
    await waitFor(() => {
      expect(screen.getByText('Regional Divergence')).toBeInTheDocument();
    });

    // Price card should NOT be present
    expect(screen.queryByText('Price Data')).not.toBeInTheDocument();
  });

  it('shows price history entries when multiple snapshots exist', async () => {
    const history = makeHistorySnapshots();
    const priceData: PriceData = { latest: history[0], history };

    vi.stubGlobal(
      'fetch',
      buildFetchMock(() => priceData),
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

    // Wait for price card
    await waitFor(() => {
      expect(screen.getByText('Price Data')).toBeInTheDocument();
    });

    // Verify "Recent History" label appears (shown when history.length > 1)
    expect(screen.getByText('Recent History')).toBeInTheDocument();

    // Verify individual history entries render with prices
    expect(screen.getByText(/66,800\.00/)).toBeInTheDocument();
    expect(screen.getByText(/67,100\.50/)).toBeInTheDocument();
  });

  it('does not show price card when latest is null', async () => {
    const priceData: PriceData = { latest: null, history: [] };

    vi.stubGlobal(
      'fetch',
      buildFetchMock(() => priceData),
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

    // Wait for entity details to finish loading
    await waitFor(() => {
      expect(screen.getByText('Regional Divergence')).toBeInTheDocument();
    });

    // Price card should NOT appear since latest is null
    expect(screen.queryByText('Price Data')).not.toBeInTheDocument();
  });
});
