import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

import { registerFeedbackRoutes } from '../../src/server-feedback-routes.js';
import { fakeRequest, makeMockLogger, makeMockPool } from '../helpers/factories.js';

interface RouteUser {
  discordId: string;
  username: string;
  role: string;
}

const ADMIN_USER = fakeRequest({
  user: {
    discordId: '123456789012345678',
    username: 'feedback-admin',
    role: 'admin',
  },
}).user as RouteUser;

const VIEWER_USER = fakeRequest({
  user: {
    discordId: '123456789012345678',
    username: 'feedback-viewer',
    role: 'viewer',
  },
}).user as RouteUser;

const API_KEY_USER = fakeRequest({
  user: {
    discordId: 'api-key',
    username: 'api-key',
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

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.user?.role !== 'admin') {
    return reply.code(403).send({ error: 'Admin required' });
  }
}

function buildApp(
  options: {
    authPreHandler?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
    requireAdminHandler?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
    pool?: ReturnType<typeof makeMockPool>;
  } = {},
) {
  const pool = options.pool ?? makeMockPool();
  const app = fastify({ loggerInstance: createLogger() as never });
  app.decorateRequest('user', null);

  registerFeedbackRoutes({
    app,
    authPreHandler: options.authPreHandler ?? authedPreHandler(),
    requireAdmin: options.requireAdminHandler ?? requireAdmin,
    pool: pool as never,
  });

  return { app, pool };
}

describe('registerFeedbackRoutes', () => {
  it('rejects unauthenticated requests', async () => {
    const { app, pool } = buildApp({ authPreHandler: noAuthPreHandler });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        payload: {
          targetType: 'summary',
          targetId: 'summary-1',
          category: 'other',
        },
      });

      assert.equal(response.statusCode, 401);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Unauthorized' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('rejects feedback from the API key pseudo-user', async () => {
    const { app, pool } = buildApp({ authPreHandler: authedPreHandler(API_KEY_USER) });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        payload: {
          targetType: 'summary',
          targetId: 'summary-1',
          category: 'other',
        },
      });

      assert.equal(response.statusCode, 400);
      assert.deepStrictEqual(JSON.parse(response.body), {
        error: 'Feedback requires a dashboard user session',
      });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('validates feedback creation request bodies', async () => {
    const { app, pool } = buildApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        payload: {
          targetType: 'invalid-target',
          targetId: 'summary-1',
          category: 'other',
        },
      });

      assert.equal(response.statusCode, 400);
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('creates feedback for a valid dashboard user request', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('INSERT INTO feedback')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/feedback',
        payload: {
          targetType: 'summary',
          targetId: 'summary-1',
          category: 'wrong_entity',
          note: 'Wrong token tagged',
        },
      });

      assert.equal(response.statusCode, 201);
      const body = JSON.parse(response.body) as { id: string };
      assert.equal(typeof body.id, 'string');
      assert.ok(body.id.length > 0);
      assert.deepStrictEqual(pool.calls[0]?.params.slice(1, 6), [
        ADMIN_USER.discordId,
        'summary',
        'summary-1',
        'wrong_entity',
        'Wrong token tagged',
      ]);
    } finally {
      await app.close();
    }
  });

  it('requires admin access to list feedback', async () => {
    const { app, pool } = buildApp({ authPreHandler: authedPreHandler(VIEWER_USER) });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/feedback',
      });

      assert.equal(response.statusCode, 403);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Admin required' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('returns an empty list for unknown feedback statuses without hitting the database', async () => {
    const { app, pool } = buildApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/feedback?status=unknown-status',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), { feedback: [], total: 0 });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('lists feedback rows with camelCase response keys', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT * FROM feedback')) {
        return {
          rows: [
            {
              id: 'feedback-1',
              user_id: '123456789012345678',
              target_type: 'summary',
              target_id: 'summary-1',
              category: 'other',
              note: 'Investigate',
              status: 'pending',
              created_at: 1_700_000_000_000,
            },
          ],
        };
      }

      if (sql.includes('SELECT COUNT(*) AS count FROM feedback')) {
        return { rows: [{ count: '1' }] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/feedback?status=pending&limit=25&offset=0',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        feedback: [
          {
            id: 'feedback-1',
            userId: '123456789012345678',
            targetType: 'summary',
            targetId: 'summary-1',
            category: 'other',
            note: 'Investigate',
            status: 'pending',
            createdAt: 1_700_000_000_000,
          },
        ],
        total: 1,
      });
    } finally {
      await app.close();
    }
  });

  it('validates feedback status updates', async () => {
    const { app, pool } = buildApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/feedback/feedback-1',
        payload: { status: 'invalid-status' },
      });

      assert.equal(response.statusCode, 400);
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when updating a missing feedback row', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('UPDATE feedback SET status')) {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/feedback/feedback-missing',
        payload: { status: 'acknowledged' },
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Feedback not found' });
    } finally {
      await app.close();
    }
  });

  it('updates feedback status for an existing row', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('UPDATE feedback SET status')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/feedback/feedback-1',
        payload: { status: 'dismissed' },
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), { ok: true });
      assert.deepStrictEqual(pool.calls[0]?.params, ['dismissed', 'feedback-1']);
    } finally {
      await app.close();
    }
  });
});
