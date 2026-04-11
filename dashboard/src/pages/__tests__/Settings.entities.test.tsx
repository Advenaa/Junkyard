import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: 'entity-admin',
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

type RelationshipType =
  | 'competes_with'
  | 'built_on'
  | 'invested_in'
  | 'forked_from'
  | 'acquired'
  | 'founded'
  | 'advises'
  | 'partnered_with'
  | 'regulated_by';
type RelationshipSource = 'llm_inferred' | 'manual' | 'coingecko';

interface MockEntityRelationship {
  id: string;
  entityIdA: string;
  entityNameA: string;
  entityIdB: string;
  entityNameB: string;
  relationshipType: RelationshipType;
  confidence: number;
  source: RelationshipSource;
  summaryId: string | null;
  sinceAt: number | null;
  untilAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface CreateRelationshipPayload {
  entityIdA: string;
  entityIdB: string;
  relationshipType: RelationshipType;
  confidence: number;
  sinceAt: number | null;
  untilAt: number | null;
}

interface GraphNode {
  id: string;
  name: string;
  depth: number;
  isRoot: boolean;
}

interface GraphResponse {
  rootEntityId: string;
  nodes: GraphNode[];
  relationships: MockEntityRelationship[];
}

interface MockEntitySuggestion {
  id: string;
  name: string;
  matchedAlias: string | null;
  status: 'active' | 'archived';
  relevance: number;
  lastSeen: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createEntitySearchFetchMock(knownEntities: MockEntitySuggestion[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url, 'http://localhost');
    const path = requestUrl.pathname;
    const method = init?.method ?? 'GET';

    if (path === '/api/v1/sources' && method === 'GET') {
      return jsonResponse({ sources: [] });
    }

    if (path === '/api/v1/discord/tokens' && method === 'GET') {
      return jsonResponse({ tokens: [] });
    }

    if (path === '/api/v1/discord/tokens/health' && method === 'GET') {
      return jsonResponse({ states: [] });
    }

    if (path === '/api/v1/config' && method === 'GET') {
      return jsonResponse({ digestTime: '09:00', timezone: 'Asia/Jakarta', webhookUrl: '' });
    }

    if (path === '/api/v1/entities/search' && method === 'GET') {
      const q = requestUrl.searchParams.get('q')?.toLowerCase() ?? '';
      const status = requestUrl.searchParams.get('status') as MockEntitySuggestion['status'] | null;
      const entities = knownEntities.filter((entity) => {
        const matchesQuery =
          entity.name.toLowerCase().startsWith(q) || (entity.matchedAlias?.toLowerCase().startsWith(q) ?? false);
        const matchesStatus = status == null || entity.status === status;
        return matchesQuery && matchesStatus;
      });
      return jsonResponse({ entities });
    }

    throw new Error(`Unhandled fetch ${method} ${path}${requestUrl.search}`);
  });
}

describe('Settings entity relationships', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows active and archived lifecycle badges in entity search suggestions', async () => {
    const knownEntities: MockEntitySuggestion[] = [
      {
        id: 'ent-arb',
        name: 'Arbitrum',
        matchedAlias: 'arb',
        status: 'active',
        relevance: 1.4,
        lastSeen: Date.UTC(2026, 3, 10, 12, 0, 0),
      },
      {
        id: 'ent-arch',
        name: 'Archway',
        matchedAlias: 'arch',
        status: 'archived',
        relevance: 0.25,
        lastSeen: Date.UTC(2025, 11, 1, 9, 0, 0),
      },
    ];
    vi.stubGlobal('fetch', createEntitySearchFetchMock(knownEntities));

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Entities' }));
    await user.type(screen.getByPlaceholderText('Search entities by name or alias'), 'Ar');

    const suggestions = await screen.findByLabelText('Entity detail suggestions');
    expect(within(suggestions).getByText('active')).toBeInTheDocument();
    expect(within(suggestions).getByText('archived')).toBeInTheDocument();
  });

  it('requests archived-only entity suggestions when the Archived filter is selected', async () => {
    const knownEntities: MockEntitySuggestion[] = [
      {
        id: 'ent-arb',
        name: 'Arbitrum',
        matchedAlias: 'arb',
        status: 'active',
        relevance: 0.87,
        lastSeen: Date.UTC(2026, 3, 10, 12, 0, 0),
      },
      {
        id: 'ent-arch',
        name: 'Archway',
        matchedAlias: 'arch',
        status: 'archived',
        relevance: 0.25,
        lastSeen: Date.UTC(2025, 11, 1, 9, 0, 0),
      },
    ];
    const fetchMock = createEntitySearchFetchMock(knownEntities);
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Entities' }));
    await user.type(screen.getByPlaceholderText('Search entities by name or alias'), 'Ar');
    await screen.findByLabelText('Entity detail suggestions');

    await user.click(screen.getByRole('button', { name: 'Archived' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          const requestUrl = new URL(url, 'http://localhost');
          return (
            requestUrl.pathname === '/api/v1/entities/search' &&
            requestUrl.searchParams.get('q') === 'Ar' &&
            requestUrl.searchParams.get('status') === 'archived'
          );
        }),
      ).toBe(true);
    });
  });

  it('shows a clamped relevance indicator in entity search suggestions', async () => {
    const knownEntities: MockEntitySuggestion[] = [
      {
        id: 'ent-arb',
        name: 'Arbitrum',
        matchedAlias: 'arb',
        status: 'active',
        relevance: 1.4,
        lastSeen: Date.UTC(2026, 3, 10, 12, 0, 0),
      },
      {
        id: 'ent-arch',
        name: 'Archway',
        matchedAlias: 'arch',
        status: 'archived',
        relevance: 0.25,
        lastSeen: Date.UTC(2025, 11, 1, 9, 0, 0),
      },
    ];
    vi.stubGlobal('fetch', createEntitySearchFetchMock(knownEntities));

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Entities' }));
    await user.type(screen.getByPlaceholderText('Search entities by name or alias'), 'Ar');

    const suggestions = await screen.findByLabelText('Entity detail suggestions');
    expect(within(suggestions).getByText('100%')).toBeInTheDocument();
    expect(within(suggestions).getByText('25%')).toBeInTheDocument();
  });

  it('shows entity details and lets admins add and remove relationships from the Entities tab', async () => {
    const knownEntities: MockEntitySuggestion[] = [
      {
        id: 'ent-eth',
        name: 'Ethereum',
        matchedAlias: 'eth',
        status: 'active',
        relevance: 0.96,
        lastSeen: Date.UTC(2026, 3, 10, 12, 0, 0),
      },
      {
        id: 'ent-sol',
        name: 'Solana',
        matchedAlias: 'sol',
        status: 'active',
        relevance: 0.9,
        lastSeen: Date.UTC(2026, 3, 10, 11, 0, 0),
      },
      {
        id: 'ent-arb',
        name: 'Arbitrum',
        matchedAlias: 'arb',
        status: 'active',
        relevance: 0.73,
        lastSeen: Date.UTC(2026, 3, 9, 10, 0, 0),
      },
      {
        id: 'ent-base',
        name: 'Base',
        matchedAlias: 'base',
        status: 'archived',
        relevance: 0.32,
        lastSeen: Date.UTC(2025, 11, 25, 8, 0, 0),
      },
    ];
    const entityNameById = new Map(knownEntities.map((entity) => [entity.id, entity.name]));
    const relationships: MockEntityRelationship[] = [
      {
        id: 'rel-1',
        entityIdA: 'ent-eth',
        entityNameA: 'Ethereum',
        entityIdB: 'ent-sol',
        entityNameB: 'Solana',
        relationshipType: 'competes_with',
        confidence: 0.88,
        source: 'manual',
        summaryId: null,
        sinceAt: null,
        untilAt: null,
        createdAt: Date.UTC(2026, 3, 1, 0, 0, 0),
        updatedAt: Date.UTC(2026, 3, 6, 8, 0, 0),
      },
      {
        id: 'rel-2',
        entityIdA: 'ent-eth',
        entityNameA: 'Ethereum',
        entityIdB: 'ent-arb',
        entityNameB: 'Arbitrum',
        relationshipType: 'built_on',
        confidence: 0.72,
        source: 'llm_inferred',
        summaryId: 'summary-rel-2',
        sinceAt: Date.UTC(2026, 2, 1, 9, 0, 0),
        untilAt: null,
        createdAt: Date.UTC(2026, 3, 2, 0, 0, 0),
        updatedAt: Date.UTC(2026, 3, 6, 9, 0, 0),
      },
    ];
    const graphOnlyRelationships: MockEntityRelationship[] = [
      {
        id: 'rel-graph-1',
        entityIdA: 'ent-sol',
        entityNameA: 'Solana',
        entityIdB: 'ent-base',
        entityNameB: 'Base',
        relationshipType: 'built_on',
        confidence: 0.66,
        source: 'manual',
        summaryId: null,
        sinceAt: null,
        untilAt: null,
        createdAt: Date.UTC(2026, 3, 3, 0, 0, 0),
        updatedAt: Date.UTC(2026, 3, 6, 7, 0, 0),
      },
    ];
    let lastCreatePayload: CreateRelationshipPayload | null = null;

    function buildGraph(entityId: string): GraphResponse {
      const allRelationships = [...relationships, ...graphOnlyRelationships];
      const nodeDepths = new Map<string, number>([[entityId, 0]]);
      const frontier = new Set<string>([entityId]);
      const nextFrontier = new Set<string>();
      const includedRelationships = new Map<string, MockEntityRelationship>();

      for (let depth = 0; depth < 2; depth += 1) {
        nextFrontier.clear();
        const frontierIds = new Set(frontier);
        if (frontierIds.size === 0) break;

        for (const relationship of allRelationships) {
          const touchesA = frontierIds.has(relationship.entityIdA);
          const touchesB = frontierIds.has(relationship.entityIdB);
          if (!touchesA && !touchesB) continue;

          includedRelationships.set(relationship.id, relationship);

          if (touchesA && !nodeDepths.has(relationship.entityIdB)) {
            nodeDepths.set(relationship.entityIdB, depth + 1);
            nextFrontier.add(relationship.entityIdB);
          }
          if (touchesB && !nodeDepths.has(relationship.entityIdA)) {
            nodeDepths.set(relationship.entityIdA, depth + 1);
            nextFrontier.add(relationship.entityIdA);
          }
        }

        frontier.clear();
        for (const nextId of nextFrontier) frontier.add(nextId);
      }

      const nodes = Array.from(nodeDepths.entries())
        .map(([id, depth]) => ({
          id,
          name: entityNameById.get(id) ?? id,
          depth,
          isRoot: id === entityId,
        }))
        .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

      const includedNodeIds = new Set(nodes.map((node) => node.id));
      return {
        rootEntityId: entityId,
        nodes,
        relationships: Array.from(includedRelationships.values()).filter(
          (relationship) => includedNodeIds.has(relationship.entityIdA) && includedNodeIds.has(relationship.entityIdB),
        ),
      };
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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

      if (path === '/api/v1/config' && method === 'GET') {
        return new Response(JSON.stringify({ digestTime: '09:00', timezone: 'Asia/Jakarta', webhookUrl: '' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

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

      const relationshipsMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/relationships$/);
      if (relationshipsMatch && method === 'GET') {
        const entityId = relationshipsMatch[1];
        return new Response(
          JSON.stringify({
            relationships: relationships.filter(
              (relationship) => relationship.entityIdA === entityId || relationship.entityIdB === entityId,
            ),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      const graphMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/graph$/);
      if (graphMatch && method === 'GET') {
        return new Response(JSON.stringify(buildGraph(graphMatch[1])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const competitorsMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/competitors$/);
      if (competitorsMatch && method === 'GET') {
        const entityId = competitorsMatch[1];
        return new Response(
          JSON.stringify({
            competitors: relationships.filter(
              (relationship) =>
                (relationship.entityIdA === entityId || relationship.entityIdB === entityId) &&
                relationship.relationshipType === 'competes_with',
            ),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (path === '/api/v1/entities/relationships' && method === 'POST') {
        const payload = JSON.parse(String(init?.body ?? '{}')) as CreateRelationshipPayload;
        lastCreatePayload = payload;
        relationships.push({
          id: `rel-${relationships.length + 1}`,
          entityIdA: payload.entityIdA,
          entityNameA: entityNameById.get(payload.entityIdA) ?? payload.entityIdA,
          entityIdB: payload.entityIdB,
          entityNameB: entityNameById.get(payload.entityIdB) ?? payload.entityIdB,
          relationshipType: payload.relationshipType,
          confidence: payload.confidence,
          source: 'manual',
          summaryId: null,
          sinceAt: payload.sinceAt,
          untilAt: payload.untilAt,
          createdAt: Date.UTC(2026, 3, 7, 10, 0, 0),
          updatedAt: Date.UTC(2026, 3, 7, 10, 0, 0),
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (path === '/api/v1/entities/relationships/rel-3' && method === 'DELETE') {
        const index = relationships.findIndex((relationship) => relationship.id === 'rel-3');
        if (index !== -1) relationships.splice(index, 1);
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unhandled fetch ${method} ${path}${requestUrl.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Entities' }));
    await user.type(screen.getByPlaceholderText('Search entities by name or alias'), 'Eth');
    await user.click(await screen.findByRole('button', { name: /Ethereum/i }));

    await screen.findByText('Selected Entity');
    expect(screen.getAllByText('Ethereum').length).toBeGreaterThan(0);
    expect(screen.getByText('Relationship Graph')).toBeInTheDocument();
    expect(screen.getByText('2 connected entities')).toBeInTheDocument();
    expect(screen.getByText('2 active')).toBeInTheDocument();
    expect(screen.getByText('1 with evidence')).toBeInTheDocument();
    expect(screen.getByText('1 in 2-hop context')).toBeInTheDocument();
    expect(screen.getByText('2-Hop Context')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === 'Via Solana')).toBeInTheDocument();
    expect(screen.getAllByText('Base').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Solana').length).toBeGreaterThan(0);
    expect(screen.getByText('LLM inferred')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Arbitrum Built On relationship' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open evidence summary' })).toHaveAttribute(
      'href',
      '/summaries/summary-rel-2',
    );
    expect(screen.getByText(/Since /i)).toBeInTheDocument();
    const coverageCard = screen.getByText('Coverage').parentElement;
    expect(coverageCard).not.toBeNull();
    expect(coverageCard!).toHaveTextContent('1 competitor');
    expect(coverageCard!).toHaveTextContent('2 total relationships');

    await user.click(screen.getByRole('button', { name: 'Focus Arbitrum relationship list' }));
    expect(screen.getByText('Focused Connection')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 mapped relationship with Arbitrum.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Solana Competes With relationship' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect Arbitrum' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all relationships' }));
    await screen.findByRole('button', { name: 'Remove Solana Competes With relationship' });

    await user.type(screen.getByPlaceholderText('Search another entity to relate'), 'Ba');
    const relationshipSuggestions = await screen.findByLabelText('Relationship suggestions');
    await user.click(within(relationshipSuggestions).getByRole('button', { name: /Base/i }));

    const relationshipTypeSelect = screen.getByRole('combobox');
    await user.selectOptions(relationshipTypeSelect, 'partnered_with');

    const confidenceInput = screen.getByDisplayValue('0.70');
    await user.clear(confidenceInput);
    await user.type(confidenceInput, '0.55');
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2030-01-02T10:30' } });
    fireEvent.change(screen.getByLabelText('Until'), { target: { value: '2030-01-05T08:15' } });
    await user.click(screen.getByRole('button', { name: 'Save Relationship' }));

    await screen.findByRole('button', { name: 'Remove Base Partnered With relationship' });
    expect(screen.getAllByText('Base').length).toBeGreaterThan(0);
    expect(coverageCard!).toHaveTextContent('3 total relationships');
    expect(screen.getByText('3 connected entities')).toBeInTheDocument();
    expect(lastCreatePayload).not.toBeNull();
    if (lastCreatePayload == null) {
      throw new Error('Expected relationship create payload to be captured');
    }
    const createdPayload: CreateRelationshipPayload = lastCreatePayload;
    expect(createdPayload.sinceAt).not.toBeNull();
    expect(createdPayload.untilAt).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Remove Base Partnered With relationship' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Remove Base Partnered With relationship' })).not.toBeInTheDocument();
    });

    expect(coverageCard!).toHaveTextContent('2 total relationships');
    expect(screen.getByText('2 connected entities')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Focus Arbitrum relationship list' }));
    await user.click(screen.getByRole('button', { name: 'Inspect Arbitrum' }));

    await waitFor(() => {
      expect(screen.getAllByText('Arbitrum').length).toBeGreaterThan(0);
    });

    const inspectedCoverageCard = screen.getByText('Coverage').parentElement;
    expect(inspectedCoverageCard).not.toBeNull();
    expect(inspectedCoverageCard!).toHaveTextContent('0 competitors');
    expect(inspectedCoverageCard!).toHaveTextContent('1 total relationship');
    expect(screen.getByText('1 connected entity')).toBeInTheDocument();
  });
});
