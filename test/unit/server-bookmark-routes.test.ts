import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

import { registerBookmarkRoutes } from '../../src/server-bookmark-routes.js';
import { fakeRequest, makeMockLogger, makeMockPool } from '../helpers/factories.js';

interface RouteUser {
  discordId: string;
  username: string;
  role: string;
}

const ADMIN_USER = fakeRequest({
  user: {
    discordId: '123456789012345678',
    username: 'bookmark-admin',
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

describe('registerBookmarkRoutes', () => {
  it('rejects unauthenticated bookmark requests', async () => {
    const pool = makeMockPool();
    const app = fastify({ loggerInstance: createLogger() as never });
    app.decorateRequest('user', null);

    registerBookmarkRoutes({
      app,
      authPreHandler: noAuthPreHandler,
      pool: pool as never,
    });

    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/bookmarks',
      });

      assert.equal(response.statusCode, 401);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Unauthorized' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('returns bookmarked report ids for the authenticated user', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT report_id FROM bookmarks')) {
        return {
          rows: [{ report_id: 'report-1' }, { report_id: 'report-2' }],
        };
      }

      return { rows: [], rowCount: 0 };
    });

    const app = fastify({ loggerInstance: createLogger() as never });
    app.decorateRequest('user', null);

    registerBookmarkRoutes({
      app,
      authPreHandler: authedPreHandler(),
      pool: pool as never,
    });

    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/bookmarks',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), { reportIds: ['report-1', 'report-2'] });
      assert.equal(pool.calls[0]?.params[0], ADMIN_USER.discordId);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when bookmark creation is missing a report id', async () => {
    const pool = makeMockPool();
    const app = fastify({ loggerInstance: createLogger() as never });
    app.decorateRequest('user', null);

    registerBookmarkRoutes({
      app,
      authPreHandler: authedPreHandler(),
      pool: pool as never,
    });

    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/bookmarks',
        payload: {},
      });

      assert.equal(response.statusCode, 400);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'reportId is required' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('creates a bookmark for a valid request', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('INSERT INTO bookmarks')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });

    const app = fastify({ loggerInstance: createLogger() as never });
    app.decorateRequest('user', null);

    registerBookmarkRoutes({
      app,
      authPreHandler: authedPreHandler(),
      pool: pool as never,
    });

    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/bookmarks',
        payload: { reportId: 'report-99' },
      });

      assert.equal(response.statusCode, 201);
      assert.deepStrictEqual(JSON.parse(response.body), { ok: true });
      assert.equal(pool.calls[0]?.params[2], 'report-99');
    } finally {
      await app.close();
    }
  });

  it('returns 404 when deleting a missing bookmark', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('DELETE FROM bookmarks')) {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    });

    const app = fastify({ loggerInstance: createLogger() as never });
    app.decorateRequest('user', null);

    registerBookmarkRoutes({
      app,
      authPreHandler: authedPreHandler(),
      pool: pool as never,
    });

    await app.ready();

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/bookmarks/report-missing',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Bookmark not found' });
    } finally {
      await app.close();
    }
  });

  it('deletes an existing bookmark', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('DELETE FROM bookmarks')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });

    const app = fastify({ loggerInstance: createLogger() as never });
    app.decorateRequest('user', null);

    registerBookmarkRoutes({
      app,
      authPreHandler: authedPreHandler(),
      pool: pool as never,
    });

    await app.ready();

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/bookmarks/report-1',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), { ok: true });
      assert.deepStrictEqual(pool.calls[0]?.params, [ADMIN_USER.discordId, 'report-1']);
    } finally {
      await app.close();
    }
  });
});
