import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

import { registerEntityRoutes } from '../../src/server-entity-routes.js';
import { fakeConfig, fakeRequest, makeMockLogger, makeMockPool } from '../helpers/factories.js';

interface RouteUser {
  discordId: string;
  username: string;
  role: string;
}

const ADMIN_USER = fakeRequest({
  user: {
    discordId: '123456789012345678',
    username: 'entity-admin',
    role: 'admin',
  },
}).user as RouteUser;

const VIEWER_USER = fakeRequest({
  user: {
    discordId: '123456789012345678',
    username: 'entity-viewer',
    role: 'viewer',
  },
}).user as RouteUser;

const RELATIONSHIP = {
  id: 'rel-1',
  entityIdA: 'ent-btc',
  entityNameA: 'Bitcoin',
  entityIdB: 'ent-eth',
  entityNameB: 'Ethereum',
  relationshipType: 'competes_with',
  confidence: 0.8,
  source: 'manual',
  summaryId: null,
  sinceAt: null,
  untilAt: null,
  createdAt: Date.UTC(2026, 3, 10, 8, 0, 0),
  updatedAt: Date.UTC(2026, 3, 10, 9, 0, 0),
};

function createLogger() {
  return Object.assign(makeMockLogger(), {
    trace: (..._args: unknown[]) => {},
  });
}

function authedPreHandler(user: RouteUser = ADMIN_USER) {
  return async (request: FastifyRequest) => {
    request.user = { ...user };
  };
}

async function noAuthPreHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.code(401).send({ error: 'Unauthorized' });
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.user?.role !== 'admin') {
    return reply.code(403).send({ error: 'Admin required' });
  }
}

function buildApp(
  options: {
    authPreHandler?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
    requireAdminHandler?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
    config?: ReturnType<typeof fakeConfig>;
    pool?: ReturnType<typeof makeMockPool>;
  } = {},
) {
  const pool = options.pool ?? makeMockPool();
  const app = fastify({ loggerInstance: createLogger() as never });
  app.decorateRequest('user', null);

  registerEntityRoutes({
    app,
    authPreHandler: options.authPreHandler ?? authedPreHandler(),
    config: options.config ?? fakeConfig(),
    pool: pool as never,
    requireAdmin: options.requireAdminHandler ?? requireAdmin,
  });

  return { app, pool };
}

describe('registerEntityRoutes', () => {
  it('rejects unauthenticated requests', async () => {
    const { app, pool } = buildApp({ authPreHandler: noAuthPreHandler });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/search?q=bitcoin',
      });

      assert.equal(response.statusCode, 401);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Unauthorized' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('validates entity search query parameters', async () => {
    const { app, pool } = buildApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/search?q=b',
      });

      assert.equal(response.statusCode, 400);
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('returns entity search suggestions', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT id, name, matched_alias, status, relevance, last_seen')) {
        return {
          rows: [
            {
              id: 'ent-btc',
              name: 'Bitcoin',
              matched_alias: 'btc',
              status: 'active',
              relevance: 10,
              last_seen: Date.UTC(2026, 3, 13, 10, 0, 0),
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/search?q=Bit&limit=5&status=active',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        entities: [
          {
            id: 'ent-btc',
            name: 'Bitcoin',
            matchedAlias: 'btc',
            status: 'active',
            relevance: 10,
            lastSeen: Date.UTC(2026, 3, 13, 10, 0, 0),
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('returns 404 when an entity drilldown is missing', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT * FROM entities WHERE id = $1')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-missing',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Entity not found' });
    } finally {
      await app.close();
    }
  });

  it('returns entity drilldowns with mention counts and aliases', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT * FROM entities WHERE id = $1')) {
        return {
          rows: [
            {
              id: 'ent-btc',
              name: 'Bitcoin',
              type: 'token',
              status: 'active',
              relevance: 10,
              first_seen: 1_700_000_000_000,
              last_seen: 1_700_000_100_000,
            },
          ],
        };
      }

      if (sql.includes('SELECT COUNT(*) AS count FROM entity_mentions')) {
        return { rows: [{ count: '12' }] };
      }

      if (sql.includes('SELECT alias FROM entity_aliases WHERE entity_id = $1 ORDER BY alias')) {
        return { rows: [{ alias: 'btc' }, { alias: 'bitcoin' }] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        entity: {
          id: 'ent-btc',
          name: 'Bitcoin',
          type: 'token',
          status: 'active',
          relevance: 10,
          firstSeen: 1_700_000_000_000,
          lastSeen: 1_700_000_100_000,
          mentionCount: 12,
          aliases: ['btc', 'bitcoin'],
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns entity mentions with pagination metadata', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('FROM entity_mentions') && sql.includes('LIMIT $2 OFFSET $3')) {
        return {
          rows: [
            {
              id: 'mention-1',
              summary_id: 'summary-1',
              sentiment: 0.5,
              mention_count: 4,
              created_at: 1_700_000_200_000,
              source: 'discord',
            },
          ],
        };
      }

      if (sql.includes('SELECT COUNT(*) AS count FROM entity_mentions WHERE entity_id = $1')) {
        return { rows: [{ count: '1' }] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/mentions?limit=10&offset=0',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        mentions: [
          {
            id: 'mention-1',
            summaryId: 'summary-1',
            sentiment: 0.5,
            mentionCount: 4,
            createdAt: 1_700_000_200_000,
            source: 'discord',
          },
        ],
        total: 1,
      });
    } finally {
      await app.close();
    }
  });

  it('lists aliases with camelCase keys', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('FROM entity_aliases') && sql.includes('WHERE entity_id = $1')) {
        return {
          rows: [
            {
              id: 'alias-1',
              entity_id: 'ent-btc',
              alias: 'btc',
              origin: 'manual',
              created_at: 1_700_000_300_000,
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/aliases',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        aliases: [
          {
            id: 'alias-1',
            entityId: 'ent-btc',
            alias: 'btc',
            origin: 'manual',
            createdAt: 1_700_000_300_000,
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('requires admin access to create aliases', async () => {
    const { app, pool } = buildApp({ authPreHandler: authedPreHandler(VIEWER_USER) });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/entities/ent-btc/aliases',
        payload: { alias: 'btc' },
      });

      assert.equal(response.statusCode, 403);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Admin required' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('rejects aliases that normalize to an empty string', async () => {
    const { app, pool } = buildApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/entities/ent-btc/aliases',
        payload: { alias: '   ' },
      });

      assert.equal(response.statusCode, 400);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Alias cannot be empty' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('returns 409 when creating a duplicate alias for the same entity', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('FROM entity_aliases') && sql.includes('WHERE entity_id = $1')) {
        return {
          rows: [
            {
              id: 'alias-1',
              entity_id: 'ent-btc',
              alias: 'btc',
              origin: 'manual',
              created_at: 1_700_000_300_000,
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/entities/ent-btc/aliases',
        payload: { alias: 'BTC' },
      });

      assert.equal(response.statusCode, 409);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Alias already exists for this entity' });
    } finally {
      await app.close();
    }
  });

  it('creates aliases for valid admin requests', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('FROM entity_aliases') && sql.includes('WHERE entity_id = $1')) {
        return { rows: [] };
      }

      if (sql.includes('INSERT INTO entity_aliases')) {
        return {
          rows: [
            {
              id: 'alias-2',
              entity_id: 'ent-btc',
              alias: 'xbt',
              origin: 'manual',
              created_at: 1_700_000_400_000,
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/entities/ent-btc/aliases',
        payload: { alias: 'XBT' },
      });

      assert.equal(response.statusCode, 201);
      assert.deepStrictEqual(JSON.parse(response.body), {
        alias: {
          id: 'alias-2',
          entityId: 'ent-btc',
          alias: 'xbt',
          origin: 'manual',
          createdAt: 1_700_000_400_000,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns 404 when deleting a missing alias', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('DELETE FROM entity_aliases')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/entities/ent-btc/aliases/alias-missing',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Alias not found' });
    } finally {
      await app.close();
    }
  });

  it('deletes aliases and returns the removed row', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('DELETE FROM entity_aliases')) {
        return {
          rows: [
            {
              id: 'alias-1',
              entity_id: 'ent-btc',
              alias: 'btc',
              origin: 'manual',
              created_at: 1_700_000_300_000,
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/entities/ent-btc/aliases/alias-1',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        alias: {
          id: 'alias-1',
          entityId: 'ent-btc',
          alias: 'btc',
          origin: 'manual',
          createdAt: 1_700_000_300_000,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns relationships and competitor views', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('FROM entity_relationships er') && sql.includes("er.relationship_type = 'competes_with'")) {
        return { rows: [RELATIONSHIP] };
      }

      if (sql.includes('FROM entity_relationships er')) {
        return { rows: [RELATIONSHIP] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const relationshipsResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/relationships',
      });
      const competitorsResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/competitors',
      });

      assert.equal(relationshipsResponse.statusCode, 200);
      assert.equal(competitorsResponse.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(relationshipsResponse.body), { relationships: [RELATIONSHIP] });
      assert.deepStrictEqual(JSON.parse(competitorsResponse.body), { competitors: [RELATIONSHIP] });
    } finally {
      await app.close();
    }
  });

  it('returns 404 when an entity graph root is missing', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT id, name') && sql.includes('FROM entities')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-missing/graph',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Entity not found' });
    } finally {
      await app.close();
    }
  });

  it('returns entity relationship graphs', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT id, name') && sql.includes('FROM entities')) {
        return { rows: [{ id: 'ent-btc', name: 'Bitcoin' }] };
      }

      if (sql.includes('FROM entity_relationships er') && sql.includes('ANY($1::text[])')) {
        return { rows: [RELATIONSHIP] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/graph?depth=1&limit=10',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        rootEntityId: 'ent-btc',
        nodes: [
          { id: 'ent-btc', name: 'Bitcoin', depth: 0, isRoot: true },
          { id: 'ent-eth', name: 'Ethereum', depth: 1, isRoot: false },
        ],
        relationships: [RELATIONSHIP],
      });
    } finally {
      await app.close();
    }
  });

  it('requires admin access to create entity relationships', async () => {
    const { app, pool } = buildApp({ authPreHandler: authedPreHandler(VIEWER_USER) });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/entities/relationships',
        payload: {
          entityIdA: 'ent-btc',
          entityIdB: 'ent-eth',
          relationshipType: 'competes_with',
        },
      });

      assert.equal(response.statusCode, 403);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Admin required' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('validates relationship creation business rules', async () => {
    const { app, pool } = buildApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/entities/relationships',
        payload: {
          entityIdA: 'ent-btc',
          entityIdB: 'ent-btc',
          relationshipType: 'competes_with',
        },
      });

      assert.equal(response.statusCode, 400);
      assert.deepStrictEqual(JSON.parse(response.body), {
        error: 'entityIdA and entityIdB must be different',
      });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('creates entity relationships for valid admin requests', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('INSERT INTO entity_relationships')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/entities/relationships',
        payload: {
          entityIdA: 'ent-btc',
          entityIdB: 'ent-eth',
          relationshipType: 'competes_with',
          confidence: 0.9,
          source: 'manual',
        },
      });

      assert.equal(response.statusCode, 201);
      assert.deepStrictEqual(JSON.parse(response.body), { ok: true });
    } finally {
      await app.close();
    }
  });

  it('returns 404 when deleting a missing relationship', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('DELETE FROM entity_relationships WHERE id = $1')) {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/entities/relationships/rel-missing',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Relationship not found' });
    } finally {
      await app.close();
    }
  });

  it('deletes relationships for valid admin requests', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('DELETE FROM entity_relationships WHERE id = $1')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/entities/relationships/rel-1',
      });

      assert.equal(response.statusCode, 204);
      assert.equal(response.body, '');
    } finally {
      await app.close();
    }
  });

  it('returns divergence leaderboards', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('FROM per_lang eng') && sql.includes('ORDER BY divergence DESC')) {
        return {
          rows: [
            {
              entity_id: 'ent-btc',
              entity_name: 'Bitcoin',
              eng_sentiment: 0.6,
              eng_mentions: 10,
              ind_sentiment: -0.1,
              ind_mentions: 8,
              divergence: 0.7,
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/divergence?days=7&limit=5',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        divergences: [
          {
            entityId: 'ent-btc',
            entityName: 'Bitcoin',
            engSentiment: 0.6,
            engMentions: 10,
            indSentiment: -0.1,
            indMentions: 8,
            divergence: 0.7,
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('returns 404 when no entity divergence data exists', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('WITH per_lang AS (') && sql.includes('COALESCE((SELECT mention_count FROM per_lang')) {
        return {
          rows: [
            {
              eng_sentiment: null,
              eng_mentions: 0,
              ind_sentiment: null,
              ind_mentions: 0,
              divergence: null,
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/divergence',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'No divergence data for this entity' });
    } finally {
      await app.close();
    }
  });

  it('returns entity divergence drilldowns', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('WITH per_lang AS (') && sql.includes('COALESCE((SELECT mention_count FROM per_lang')) {
        return {
          rows: [
            {
              eng_sentiment: 0.5,
              eng_mentions: 9,
              ind_sentiment: -0.2,
              ind_mentions: 7,
              divergence: 0.7,
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/divergence?days=14',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        divergence: {
          engSentiment: 0.5,
          engMentions: 9,
          indSentiment: -0.2,
          indMentions: 7,
          divergence: 0.7,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns 503 when price APIs are disabled', async () => {
    const { app } = buildApp({ config: fakeConfig() });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/price',
      });

      assert.equal(response.statusCode, 503);
      assert.equal(JSON.parse(response.body).feature, 'prices');
    } finally {
      await app.close();
    }
  });

  it('returns 404 when no price data exists for an entity', async () => {
    const pool = makeMockPool((sql) => {
      if (
        sql.includes('SELECT * FROM price_snapshots') &&
        sql.includes('ORDER BY timestamp DESC') &&
        sql.includes('LIMIT 1')
      ) {
        return { rows: [] };
      }

      if (sql.includes('SELECT * FROM price_snapshots') && sql.includes('AND timestamp >= $2')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({
      config: fakeConfig({ coingeckoApiKey: 'coingecko-key' }),
      pool,
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/price',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'No price data for this entity' });
    } finally {
      await app.close();
    }
  });

  it('returns price snapshots when data is available', async () => {
    const pool = makeMockPool((sql) => {
      if (
        sql.includes('SELECT * FROM price_snapshots') &&
        sql.includes('ORDER BY timestamp DESC') &&
        sql.includes('LIMIT 1')
      ) {
        return {
          rows: [
            {
              id: 'snap-1',
              entity_id: 'ent-btc',
              timestamp: 1_700_000_500_000,
              price_usd: 65_000,
              price_change_24h: 2.5,
              price_change_7d: 8.1,
              volume_24h: 10_000_000_000,
              market_cap: 1_200_000_000_000,
              source: 'coingecko',
              created_at: 1_700_000_500_100,
            },
          ],
        };
      }

      if (sql.includes('SELECT * FROM price_snapshots') && sql.includes('AND timestamp >= $2')) {
        return {
          rows: [
            {
              id: 'snap-1',
              entity_id: 'ent-btc',
              timestamp: 1_700_000_500_000,
              price_usd: 65_000,
              price_change_24h: 2.5,
              price_change_7d: 8.1,
              volume_24h: 10_000_000_000,
              market_cap: 1_200_000_000_000,
              source: 'coingecko',
              created_at: 1_700_000_500_100,
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({
      config: fakeConfig({ coingeckoApiKey: 'coingecko-key' }),
      pool,
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/price?days=30&limit=10',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        latest: {
          id: 'snap-1',
          entityId: 'ent-btc',
          timestamp: 1_700_000_500_000,
          priceUsd: 65_000,
          priceChange24h: 2.5,
          priceChange7d: 8.1,
          volume24h: 10_000_000_000,
          marketCap: 1_200_000_000_000,
          source: 'coingecko',
          createdAt: 1_700_000_500_100,
        },
        history: [
          {
            id: 'snap-1',
            entityId: 'ent-btc',
            timestamp: 1_700_000_500_000,
            priceUsd: 65_000,
            priceChange24h: 2.5,
            priceChange7d: 8.1,
            volume24h: 10_000_000_000,
            marketCap: 1_200_000_000_000,
            source: 'coingecko',
            createdAt: 1_700_000_500_100,
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('returns 404 when no alpha propagation data exists', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT DISTINCT ON (tier)')) {
        return { rows: [] };
      }

      if (sql.includes('SELECT * FROM alpha_propagation')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/alpha',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'No alpha propagation data for this entity' });
    } finally {
      await app.close();
    }
  });

  it('returns alpha propagation summaries and records', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT DISTINCT ON (tier)')) {
        return {
          rows: [
            {
              tier: 'alpha',
              first_mention_time: 1_700_000_600_000,
              source: 'discord',
              source_id: 'guild:1',
            },
          ],
        };
      }

      if (sql.includes('SELECT * FROM alpha_propagation')) {
        return {
          rows: [
            {
              id: 'alpha-1',
              entity_id: 'ent-btc',
              event_id: null,
              tier: 'alpha',
              source: 'discord',
              source_id: 'guild:1',
              first_mention_time: 1_700_000_600_000,
              item_id: 'item-1',
              created_at: 1_700_000_600_100,
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/alpha?days=14',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        summary: [
          {
            tier: 'alpha',
            firstMentionTime: 1_700_000_600_000,
            source: 'discord',
            sourceId: 'guild:1',
          },
        ],
        records: [
          {
            id: 'alpha-1',
            entityId: 'ent-btc',
            eventId: null,
            tier: 'alpha',
            source: 'discord',
            sourceId: 'guild:1',
            firstMentionTime: 1_700_000_600_000,
            itemId: 'item-1',
            createdAt: 1_700_000_600_100,
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('returns entity author leaderboards', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('WITH mention_counts AS (')) {
        return {
          rows: [
            {
              id: 'author-1',
              platform: 'twitter',
              handle: 'macroalpha',
              display_name: 'Macro Alpha',
              first_seen: 1_700_000_000_000,
              last_seen: 1_700_000_700_000,
              mention_count: 30,
              created_at: 1_700_000_000_000,
              entity_mention_count: 12,
              first_entity_call_time: 1_700_000_100_000,
              first_mover: true,
              first_mover_lag_ms: 0,
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/entities/ent-btc/authors?limit=5',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        authors: [
          {
            id: 'author-1',
            platform: 'twitter',
            handle: 'macroalpha',
            displayName: 'Macro Alpha',
            firstSeen: 1_700_000_000_000,
            lastSeen: 1_700_000_700_000,
            mentionCount: 30,
            createdAt: 1_700_000_000_000,
            entityMentionCount: 12,
            firstEntityCallTime: 1_700_000_100_000,
            firstMover: true,
            firstMoverLagMs: 0,
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('returns 404 when an author drilldown is missing', async () => {
    const pool = makeMockPool((sql) => {
      if (
        sql.includes(
          'SELECT id, platform, handle, display_name, first_seen, last_seen, mention_count, created_at FROM authors WHERE id = $1',
        )
      ) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/authors/author-missing',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Author not found' });
    } finally {
      await app.close();
    }
  });

  it('returns author drilldowns with call histories', async () => {
    const pool = makeMockPool((sql) => {
      if (
        sql.includes(
          'SELECT id, platform, handle, display_name, first_seen, last_seen, mention_count, created_at FROM authors WHERE id = $1',
        )
      ) {
        return {
          rows: [
            {
              id: 'author-1',
              platform: 'twitter',
              handle: 'macroalpha',
              display_name: 'Macro Alpha',
              first_seen: 1_700_000_000_000,
              last_seen: 1_700_000_700_000,
              mention_count: 30,
              created_at: 1_700_000_000_000,
            },
          ],
        };
      }

      if (sql.includes('FROM author_calls ac')) {
        return {
          rows: [
            {
              id: 'call-1',
              author_id: 'author-1',
              entity_id: 'ent-btc',
              claim_type: 'call',
              claim_text: 'Bitcoin breakout ahead',
              confidence: 0.8,
              source_item_id: 'item-1',
              timestamp: 1_700_000_650_000,
              created_at: 1_700_000_650_100,
              entity_name: 'Bitcoin',
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/authors/author-1?callLimit=5',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        author: {
          id: 'author-1',
          platform: 'twitter',
          handle: 'macroalpha',
          displayName: 'Macro Alpha',
          firstSeen: 1_700_000_000_000,
          lastSeen: 1_700_000_700_000,
          mentionCount: 30,
          createdAt: 1_700_000_000_000,
        },
        calls: [
          {
            id: 'call-1',
            authorId: 'author-1',
            entityId: 'ent-btc',
            claimType: 'call',
            claimText: 'Bitcoin breakout ahead',
            confidence: 0.8,
            sourceItemId: 'item-1',
            timestamp: 1_700_000_650_000,
            createdAt: 1_700_000_650_100,
            entityName: 'Bitcoin',
          },
        ],
      });
    } finally {
      await app.close();
    }
  });
});
