import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: 'influencer-admin',
      avatar: null,
      role: 'admin' as const,
    },
    loading: false,
    logout: vi.fn(),
  }),
}));

interface EntitySuggestion {
  id: string;
  name: string;
  matchedAlias: string | null;
}

interface EntityAuthor {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
  credibilityScore: number | null;
  totalCalls: number;
  correctCalls: number;
  createdAt: number;
  entityMentionCount: number;
  firstEntityCallTime: number | null;
  firstMover: boolean;
  firstMoverLagMs: number | null;
}

type AuthorClaimType = 'bullish' | 'bearish' | 'event' | 'neutral';
type AuthorCallOutcome = 'correct' | 'incorrect' | 'unresolved';

interface AuthorCall {
  id: string;
  authorId: string;
  entityId: string;
  entityName: string | null;
  claimType: AuthorClaimType;
  claimText: string;
  confidence: number;
  sourceItemId: string | null;
  timestamp: number;
  resolved: boolean;
  outcome: AuthorCallOutcome | null;
  resolvedAt: number | null;
  createdAt: number;
}

interface AuthorProfile {
  author: Omit<EntityAuthor, 'entityMentionCount'>;
  calls: AuthorCall[];
}

const knownEntities: EntitySuggestion[] = [{ id: 'ent-eth', name: 'Ethereum', matchedAlias: 'eth' }];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeAuthor(overrides: Partial<EntityAuthor> = {}): EntityAuthor {
  return {
    id: 'author-1',
    platform: 'twitter',
    handle: 'defidad',
    displayName: 'DeFi Dad',
    firstSeen: Date.UTC(2026, 2, 15, 12, 0, 0),
    lastSeen: Date.UTC(2026, 3, 8, 9, 0, 0),
    mentionCount: 18,
    credibilityScore: null,
    totalCalls: 4,
    correctCalls: 3,
    createdAt: Date.UTC(2026, 2, 15, 12, 0, 0),
    entityMentionCount: 6,
    firstEntityCallTime: Date.UTC(2026, 3, 6, 10, 0, 0),
    firstMover: true,
    firstMoverLagMs: 0,
    ...overrides,
  };
}

function makeCall(overrides: Partial<AuthorCall> = {}): AuthorCall {
  return {
    id: 'call-1',
    authorId: 'author-1',
    entityId: 'ent-eth',
    entityName: 'Ethereum',
    claimType: 'bullish',
    claimText: 'DeFi Dad said the clean audit should accelerate Ethereum L2 adoption.',
    confidence: 0.81,
    sourceItemId: 'item-1',
    timestamp: Date.UTC(2026, 3, 8, 8, 0, 0),
    resolved: false,
    outcome: null,
    resolvedAt: null,
    createdAt: Date.UTC(2026, 3, 8, 8, 0, 0),
    ...overrides,
  };
}

function cloneProfile(profile: AuthorProfile): AuthorProfile {
  return {
    author: { ...profile.author },
    calls: profile.calls.map((call) => ({ ...call })),
  };
}

function buildFetchMock(
  authorsByEntity: Record<string, EntityAuthor[]>,
  profilesByAuthor: Record<string, AuthorProfile>,
) {
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

    if (path === '/api/v1/entities/search' && method === 'GET') {
      const q = requestUrl.searchParams.get('q')?.toLowerCase() ?? '';
      const entities = knownEntities.filter(
        (entity) => entity.name.toLowerCase().startsWith(q) || (entity.matchedAlias?.startsWith(q) ?? false),
      );
      return jsonResponse({ entities });
    }

    const relationshipsMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/relationships$/);
    if (relationshipsMatch && method === 'GET') {
      return jsonResponse({ relationships: [] });
    }

    const graphMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/graph$/);
    if (graphMatch && method === 'GET') {
      const entityId = graphMatch[1];
      const entity = knownEntities.find((candidate) => candidate.id === entityId);
      return jsonResponse({
        rootEntityId: entityId,
        nodes: [{ id: entityId, name: entity?.name ?? entityId, depth: 0, isRoot: true }],
        relationships: [],
      });
    }

    const competitorsMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/competitors$/);
    if (competitorsMatch && method === 'GET') {
      return jsonResponse({ competitors: [] });
    }

    const divergenceMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/divergence$/);
    if (divergenceMatch && method === 'GET') {
      return jsonResponse({
        divergence: {
          engSentiment: 0.62,
          engMentions: 12,
          indSentiment: 0.48,
          indMentions: 7,
          divergence: 0.14,
        },
      });
    }

    const priceMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/price$/);
    if (priceMatch && method === 'GET') {
      return jsonResponse({ error: 'No price data' }, 404);
    }

    const alphaMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/alpha$/);
    if (alphaMatch && method === 'GET') {
      return jsonResponse({ error: 'No alpha data' }, 404);
    }

    const authorsMatch = path.match(/^\/api\/v1\/entities\/([^/]+)\/authors$/);
    if (authorsMatch && method === 'GET') {
      const entityId = authorsMatch[1];
      return jsonResponse({
        authors: (authorsByEntity[entityId] ?? []).map((author) => ({ ...author })),
      });
    }

    const authorMatch = path.match(/^\/api\/v1\/authors\/([^/]+)$/);
    if (authorMatch && method === 'GET') {
      const authorId = authorMatch[1];
      const profile = profilesByAuthor[authorId];
      if (!profile) {
        return jsonResponse({ error: 'Author not found' }, 404);
      }
      return jsonResponse(cloneProfile(profile));
    }

    const resolveMatch = path.match(/^\/api\/v1\/author-calls\/([^/]+)$/);
    if (resolveMatch && method === 'PATCH') {
      const callId = resolveMatch[1];
      const payload = JSON.parse(String(init?.body ?? '{}')) as { outcome?: AuthorCallOutcome };
      const outcome = payload.outcome;
      if (outcome == null) {
        return jsonResponse({ error: 'Missing outcome' }, 400);
      }

      for (const profile of Object.values(profilesByAuthor)) {
        const call = profile.calls.find((candidate) => candidate.id === callId);
        if (!call) continue;

        call.resolved = true;
        call.outcome = outcome;
        call.resolvedAt = Date.UTC(2026, 3, 8, 12, 0, 0);
        if (outcome !== 'unresolved') {
          profile.author.totalCalls += 1;
          if (outcome === 'correct') {
            profile.author.correctCalls += 1;
          }
          profile.author.credibilityScore =
            profile.author.totalCalls >= 5 ? profile.author.correctCalls / profile.author.totalCalls : null;
        }

        for (const authors of Object.values(authorsByEntity)) {
          const author = authors.find((candidate) => candidate.id === profile.author.id);
          if (!author) continue;
          author.totalCalls = profile.author.totalCalls;
          author.correctCalls = profile.author.correctCalls;
          author.credibilityScore = profile.author.credibilityScore;
        }

        return new Response(null, { status: 204 });
      }

      return jsonResponse({ error: 'Author call not found' }, 404);
    }

    throw new Error(`Unhandled fetch ${method} ${path}${requestUrl.search}`);
  });
}

describe('Settings influencer tracking', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows top authors for the selected entity and lets users inspect another author profile', async () => {
    const authorsByEntity: Record<string, EntityAuthor[]> = {
      'ent-eth': [
        makeAuthor({ id: 'author-1', handle: 'defidad', displayName: 'DeFi Dad', entityMentionCount: 8 }),
        makeAuthor({
          id: 'author-2',
          platform: 'discord',
          handle: 'chainwatcher',
          displayName: null,
          entityMentionCount: 3,
          mentionCount: 9,
          totalCalls: 1,
          correctCalls: 1,
          credibilityScore: null,
          firstEntityCallTime: Date.UTC(2026, 3, 6, 14, 0, 0),
          firstMover: false,
          firstMoverLagMs: 14_400_000,
        }),
      ],
    };

    const profilesByAuthor: Record<string, AuthorProfile> = {
      'author-1': {
        author: { ...authorsByEntity['ent-eth'][0] },
        calls: [
          makeCall(),
          makeCall({
            id: 'call-2',
            claimType: 'event',
            claimText: 'DeFi Dad reported the Ethereum client release had shipped.',
            sourceItemId: 'item-2',
            resolved: true,
            outcome: 'correct',
            resolvedAt: Date.UTC(2026, 3, 7, 18, 0, 0),
          }),
        ],
      },
      'author-2': {
        author: { ...authorsByEntity['ent-eth'][1] },
        calls: [
          makeCall({
            id: 'call-3',
            authorId: 'author-2',
            claimType: 'neutral',
            claimText: 'chainwatcher said validator chatter stayed cautious after the upgrade.',
            sourceItemId: null,
            resolved: true,
            outcome: 'unresolved',
            resolvedAt: Date.UTC(2026, 3, 7, 16, 0, 0),
          }),
        ],
      },
    };

    vi.stubGlobal('fetch', buildFetchMock(authorsByEntity, profilesByAuthor));

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Entities' }));
    await user.type(screen.getByPlaceholderText('Search entities by name or alias'), 'Eth');
    await user.click(await screen.findByRole('button', { name: /Ethereum/i }));

    await screen.findByText('Top Authors');
    const topAuthors = screen.getByLabelText('Entity top authors');
    expect(within(topAuthors).getByRole('button', { name: /DeFi Dad/i })).toBeInTheDocument();
    expect(within(topAuthors).getByRole('button', { name: /chainwatcher/i })).toBeInTheDocument();

    await screen.findByText(/clean audit should accelerate Ethereum L2 adoption/i);
    expect(screen.getAllByText('First mover').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Open source item' })[0]).toHaveAttribute('href', '/items/item-1');

    await user.click(screen.getByRole('button', { name: /chainwatcher/i }));

    await screen.findByText(/validator chatter stayed cautious after the upgrade/i);
    expect(screen.getAllByText(/Discord \| chainwatcher/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('+4h after lead').length).toBeGreaterThan(0);
    expect(screen.getByText('Dismissed')).toBeInTheDocument();
  });

  it('lets admins resolve an unresolved author claim and refreshes credibility data', async () => {
    const authorsByEntity: Record<string, EntityAuthor[]> = {
      'ent-eth': [makeAuthor({ id: 'author-1', entityMentionCount: 8, totalCalls: 4, correctCalls: 3 })],
    };
    const profilesByAuthor: Record<string, AuthorProfile> = {
      'author-1': {
        author: { ...authorsByEntity['ent-eth'][0] },
        calls: [makeCall()],
      },
    };

    const fetchMock = buildFetchMock(authorsByEntity, profilesByAuthor);
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

    await screen.findByText(/clean audit should accelerate Ethereum L2 adoption/i);
    await user.click(screen.getByRole('button', { name: /Mark claim correct:/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Mark claim correct:/i })).not.toBeInTheDocument();
    });

    expect(screen.getAllByText('4/5 reviewed correct').length).toBeGreaterThan(0);
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return url.includes('/api/v1/author-calls/call-1') && init?.method === 'PATCH';
      }),
    ).toBe(true);
  });
});
