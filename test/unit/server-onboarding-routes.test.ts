import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

import { registerOnboardingRoutes } from '../../src/server-onboarding-routes.js';
import { fakeRequest, makeMockLogger, makeMockPool } from '../helpers/factories.js';

interface RouteUser {
  discordId: string;
  username: string;
  role: string;
}

interface OnboardingState {
  dismissedOnboarding: boolean;
  sourceCount: number;
  itemsReady: number;
  itemsProcessing: number;
  summariesToday: number;
  updateRowCount: number;
}

const DASHBOARD_USER = fakeRequest({
  user: {
    discordId: '123456789012345678',
    username: 'onboarding-user',
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

function authedPreHandler(user: RouteUser) {
  return async (request: FastifyRequest) => {
    request.user = { ...user };
  };
}

async function noAuthPreHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.code(401).send({ error: 'Unauthorized' });
}

function createPool(state: Partial<OnboardingState> = {}) {
  const snapshot: OnboardingState = {
    dismissedOnboarding: false,
    sourceCount: 0,
    itemsReady: 0,
    itemsProcessing: 0,
    summariesToday: 0,
    updateRowCount: 1,
    ...state,
  };

  return makeMockPool((sql) => {
    if (sql.includes('SELECT value FROM app_config WHERE key = $1')) {
      return { rows: [{ value: 'Asia/Jakarta' }] };
    }

    if (sql.includes('AS dismissed_onboarding')) {
      return {
        rows: [
          {
            source_count: String(snapshot.sourceCount),
            items_ready: String(snapshot.itemsReady),
            items_processing: String(snapshot.itemsProcessing),
            summaries_today: String(snapshot.summariesToday),
            dismissed_onboarding: snapshot.dismissedOnboarding,
          },
        ],
      };
    }

    if (sql.includes('(SELECT count(*) FROM sources) AS source_count')) {
      return {
        rows: [
          {
            source_count: String(snapshot.sourceCount),
            items_ready: String(snapshot.itemsReady),
            items_processing: String(snapshot.itemsProcessing),
            summaries_today: String(snapshot.summariesToday),
          },
        ],
      };
    }

    if (sql.includes('UPDATE users SET dismissed_onboarding = TRUE WHERE discord_id = $1')) {
      snapshot.dismissedOnboarding = true;
      return { rows: [], rowCount: snapshot.updateRowCount };
    }

    return { rows: [], rowCount: 0 };
  });
}

function buildApp(
  options: {
    authPreHandler?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
    pool?: ReturnType<typeof createPool>;
  } = {},
) {
  const pool = options.pool ?? createPool();
  const app = fastify({ loggerInstance: createLogger() as never });
  app.decorateRequest('user', null);

  registerOnboardingRoutes({
    app,
    authPreHandler: options.authPreHandler ?? authedPreHandler(DASHBOARD_USER),
    pool: pool as never,
  });

  return { app, pool };
}

describe('registerOnboardingRoutes', () => {
  it('rejects unauthenticated requests', async () => {
    const { app, pool } = buildApp({ authPreHandler: noAuthPreHandler });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/onboarding',
      });

      assert.equal(response.statusCode, 401);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Unauthorized' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('shows onboarding for a dashboard user with no sources and no dismissal flag', async () => {
    const { app } = buildApp({
      pool: createPool({
        dismissedOnboarding: false,
        sourceCount: 0,
        itemsReady: 2,
        itemsProcessing: 1,
        summariesToday: 3,
      }),
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/onboarding',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        showOnboarding: true,
        sourceCount: 0,
        statusSummary: {
          itemsReady: 2,
          itemsProcessing: 1,
          summariesToday: 3,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns onboarding status for the API key pseudo-user without consulting the user table', async () => {
    const pool = createPool({
      dismissedOnboarding: true,
      sourceCount: 5,
      itemsReady: 7,
      itemsProcessing: 2,
      summariesToday: 4,
    });
    const { app } = buildApp({
      authPreHandler: authedPreHandler(API_KEY_USER),
      pool,
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/onboarding',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        showOnboarding: false,
        sourceCount: 5,
        statusSummary: {
          itemsReady: 7,
          itemsProcessing: 2,
          summariesToday: 4,
        },
      });
      assert.equal(
        pool.calls.some((call) => call.sql.includes('dismissed_onboarding')),
        false,
      );
    } finally {
      await app.close();
    }
  });

  it('allows the API key pseudo-user to dismiss onboarding without a database write', async () => {
    const pool = createPool();
    const { app } = buildApp({
      authPreHandler: authedPreHandler(API_KEY_USER),
      pool,
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/onboarding/dismiss',
        payload: {},
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), { ok: true });
      assert.equal(
        pool.calls.some((call) => call.sql.includes('UPDATE users SET dismissed_onboarding = TRUE')),
        false,
      );
    } finally {
      await app.close();
    }
  });

  it('returns 404 when dismissing onboarding for a missing dashboard user', async () => {
    const { app } = buildApp({
      pool: createPool({ updateRowCount: 0 }),
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/onboarding/dismiss',
        payload: {},
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'User not found' });
    } finally {
      await app.close();
    }
  });

  it('dismisses onboarding for an existing dashboard user', async () => {
    const pool = createPool();
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/onboarding/dismiss',
        payload: {},
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), { ok: true });
      assert.equal(pool.calls[0]?.params[0], DASHBOARD_USER.discordId);
    } finally {
      await app.close();
    }
  });
});
