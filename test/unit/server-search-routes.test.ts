import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

import type { ItemRow, ReportRow, SummaryRow } from '../../src/db/queries.js';
import { registerSearchRoutes } from '../../src/server-search-routes.js';
import { fakeConfig, fakeRequest, fakeSummary, makeMockLogger, makeMockPool } from '../helpers/factories.js';

interface RouteUser {
  discordId: string;
  username: string;
  role: string;
}

const ADMIN_USER = fakeRequest({
  user: {
    discordId: '123456789012345678',
    username: 'search-admin',
    role: 'admin',
  },
}).user as RouteUser;

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

function createItem(overrides: Partial<ItemRow> = {}): ItemRow {
  const timestamp = Date.UTC(2026, 3, 13, 10, 0, 0);

  return {
    id: 'item-1',
    source: 'discord',
    source_id: 'guild:1',
    author: 'alice',
    content: 'Item content',
    timestamp,
    url: null,
    engagement: 3,
    attachments: JSON.stringify([{ url: 'https://cdn.discordapp.com/file.png' }]),
    content_hash: 'hash-1',
    content_anchor: null,
    original_language: 'eng',
    translated: false,
    filter_reason: null,
    status: 'processed',
    batch_id: null,
    created_at: timestamp + 1,
    ...overrides,
  };
}

function createReport(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 'report-1',
    date: '2026-04-13',
    type: 'daily',
    body: JSON.stringify({ sections: [{ heading: 'Flows', body: 'Risk appetite firmed.' }] }),
    tldr: 'ETF appetite improved',
    sentiment: 0.2,
    delivery_status: 'sent',
    delivered_at: null,
    created_at: Date.UTC(2026, 3, 13, 9, 0, 0),
    ...overrides,
  };
}

function buildApp(
  options: {
    authPreHandler?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
    chatHandler?: { handle(query: string, conversationId: string, userId: string): Promise<Record<string, unknown>> };
    config?: ReturnType<typeof fakeConfig>;
    pool?: ReturnType<typeof makeMockPool>;
  } = {},
) {
  const pool = options.pool ?? makeMockPool();
  const app = fastify({ loggerInstance: createLogger() as never });
  app.decorateRequest('user', null);

  registerSearchRoutes({
    app,
    authPreHandler: options.authPreHandler ?? authedPreHandler(),
    chatHandler: options.chatHandler as never,
    config: options.config ?? fakeConfig(),
    pool: pool as never,
  });

  return { app, pool };
}

describe('registerSearchRoutes', () => {
  it('rejects unauthenticated requests', async () => {
    const { app, pool } = buildApp({ authPreHandler: noAuthPreHandler });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search?q=bitcoin',
      });

      assert.equal(response.statusCode, 401);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Unauthorized' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('validates search query parameters', async () => {
    const { app, pool } = buildApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search',
      });

      assert.equal(response.statusCode, 400);
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('returns 503 for semantic search when embeddings are disabled', async () => {
    const { app } = buildApp({ config: fakeConfig() });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search?q=bitcoin&mode=semantic',
      });

      assert.equal(response.statusCode, 503);
      assert.equal(JSON.parse(response.body).feature, 'embeddings');
    } finally {
      await app.close();
    }
  });

  it('returns keyword search results for summaries and reports', async () => {
    const summary = fakeSummary({
      id: 'summary-1',
      source_id: 'guild:1',
      body: JSON.stringify({ summary: 'Bitcoin broke resistance on ETF demand' }),
      created_at: Date.UTC(2026, 3, 13, 10, 0, 0),
    });
    const report = createReport();
    const pool = makeMockPool((sql) => {
      if (sql.includes('FROM summaries WHERE body ILIKE')) {
        return { rows: [summary as SummaryRow] };
      }

      if (sql.includes('FROM reports')) {
        return { rows: [report] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search?q=ETF&scope=all&limit=5',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        results: [
          {
            id: 'summary-1',
            source: summary.source,
            sourceId: 'guild:1',
            windowStart: summary.window_start,
            windowEnd: summary.window_end,
            body: 'Bitcoin broke resistance on ETF demand',
            sentiment: summary.sentiment,
            urgency: summary.urgency,
            itemCount: summary.item_count,
            createdAt: summary.created_at,
            resultType: 'summary',
          },
          {
            id: 'report-1',
            date: '2026-04-13',
            reportType: 'daily',
            body: 'ETF appetite improved',
            createdAt: report.created_at,
            resultType: 'report',
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('returns 404 when an item drilldown is missing', async () => {
    const { app } = buildApp({
      pool: makeMockPool((sql) => {
        if (sql.includes('SELECT * FROM items WHERE id = $1 LIMIT 1')) {
          return { rows: [] };
        }

        return { rows: [], rowCount: 0 };
      }),
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/items/item-missing',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Item not found' });
    } finally {
      await app.close();
    }
  });

  it('returns item drilldowns with older and newer context', async () => {
    const target = createItem({
      id: 'item-target',
      attachments: JSON.stringify([{ url: 'https://cdn.discordapp.com/a.png' }]),
    });
    const older = createItem({
      id: 'item-older',
      timestamp: target.timestamp - 1_000,
      created_at: target.created_at - 1_000,
      attachments: null,
    });
    const newer = createItem({
      id: 'item-newer',
      timestamp: target.timestamp + 1_000,
      created_at: target.created_at + 1_000,
      attachments: JSON.stringify([{ url: 'https://cdn.discordapp.com/b.png' }]),
    });
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT * FROM items WHERE id = $1 LIMIT 1')) {
        return { rows: [target] };
      }

      if (sql.includes('ORDER BY timestamp DESC, created_at DESC, id DESC')) {
        return { rows: [older] };
      }

      if (sql.includes('ORDER BY timestamp ASC, created_at ASC, id ASC')) {
        return { rows: [newer] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/items/item-target?context=1',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        item: {
          id: 'item-target',
          source: 'discord',
          sourceId: 'guild:1',
          author: 'alice',
          content: 'Item content',
          timestamp: target.timestamp,
          url: null,
          engagement: 3,
          attachments: [{ url: 'https://cdn.discordapp.com/a.png' }],
          contentHash: 'hash-1',
          contentAnchor: null,
          originalLanguage: 'eng',
          translated: false,
          filterReason: null,
          status: 'processed',
          batchId: null,
          createdAt: target.created_at,
        },
        context: {
          older: [
            {
              id: 'item-older',
              source: 'discord',
              sourceId: 'guild:1',
              author: 'alice',
              content: 'Item content',
              timestamp: older.timestamp,
              url: null,
              engagement: 3,
              attachments: [],
              contentHash: 'hash-1',
              contentAnchor: null,
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              batchId: null,
              createdAt: older.created_at,
            },
          ],
          newer: [
            {
              id: 'item-newer',
              source: 'discord',
              sourceId: 'guild:1',
              author: 'alice',
              content: 'Item content',
              timestamp: newer.timestamp,
              url: null,
              engagement: 3,
              attachments: [{ url: 'https://cdn.discordapp.com/b.png' }],
              contentHash: 'hash-1',
              contentAnchor: null,
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              batchId: null,
              createdAt: newer.created_at,
            },
          ],
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns raw feed items and applies source filters', async () => {
    const item = createItem({ id: 'item-feed', source: 'twitter', source_id: 'feed-1' });
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT * FROM items WHERE source = $1 AND source_id = $2')) {
        return { rows: [item] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/feed/feed-1?source=twitter&limit=1',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(JSON.parse(response.body).items[0].sourceId, 'feed-1');
      assert.deepStrictEqual(pool.calls[0]?.params, ['twitter', 'feed-1', 1]);
    } finally {
      await app.close();
    }
  });

  it('validates chat request bodies', async () => {
    const { app, pool } = buildApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat',
        payload: {},
      });

      assert.equal(response.statusCode, 400);
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('returns 501 when chat is unavailable', async () => {
    const { app } = buildApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat',
        payload: { query: 'What changed?' },
      });

      assert.equal(response.statusCode, 501);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Chat not available' });
    } finally {
      await app.close();
    }
  });

  it('passes chat requests to the configured handler', async () => {
    const { app } = buildApp({
      chatHandler: {
        async handle(query, conversationId, userId) {
          return {
            ok: true,
            query,
            conversationId,
            userId,
          };
        },
      },
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat',
        payload: { query: 'What changed?', conversationId: 'conv-1' },
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        ok: true,
        query: 'What changed?',
        conversationId: 'conv-1',
        userId: ADMIN_USER.discordId,
      });
    } finally {
      await app.close();
    }
  });
});
