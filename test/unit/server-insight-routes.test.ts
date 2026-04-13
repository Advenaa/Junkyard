import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

import { registerInsightRoutes } from '../../src/server-insight-routes.js';
import { fakeConfig, fakeRequest, makeMockLogger, makeMockPool } from '../helpers/factories.js';

interface RouteUser {
  discordId: string;
  username: string;
  role: string;
}

const ADMIN_USER = fakeRequest({
  user: {
    discordId: '123456789012345678',
    username: 'insight-admin',
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

function buildApp(
  options: {
    authPreHandler?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
    config?: ReturnType<typeof fakeConfig>;
    pool?: ReturnType<typeof makeMockPool>;
    getNarrativeSummaryPreview?: (body: string) => string;
  } = {},
) {
  const pool = options.pool ?? makeMockPool();
  const app = fastify({ loggerInstance: createLogger() as never });
  app.decorateRequest('user', null);

  registerInsightRoutes({
    app,
    authPreHandler: options.authPreHandler ?? authedPreHandler(),
    config: options.config ?? fakeConfig(),
    pool: pool as never,
    getNarrativeSummaryPreview: options.getNarrativeSummaryPreview ?? ((body) => body),
  });

  return { app, pool };
}

function createInsightPool() {
  const now = Date.now();

  return makeMockPool((sql) => {
    if (sql.includes('SELECT MAX(date) AS latest_date FROM entity_sentiment_daily')) {
      return { rows: [{ latest_date: '2026-04-12' }] };
    }

    if (sql.includes('FROM entity_sentiment_daily sd')) {
      return {
        rows: [
          {
            entity_id: 'ent-btc',
            entity_name: 'Bitcoin',
            relevance_score: 9,
            date: '2026-04-12',
            mention_count: 18,
            avg_sentiment: 0.42,
            momentum: 0.3,
            baseline_mentions: 4.5,
            baseline_peak_mentions: 7,
            baseline_days: 7,
            spike_ratio: 4,
          },
        ],
      };
    }

    if (sql.includes('DATE(to_timestamp(i.timestamp / 1000.0) AT TIME ZONE')) {
      return { rows: [] };
    }

    if (sql.includes('SELECT value FROM app_config WHERE key = $1')) {
      return { rows: [{ value: 'Asia/Jakarta' }] };
    }

    if (sql.includes('SELECT DISTINCT ON (indicator)')) {
      return {
        rows: [
          {
            id: 'macro-spx',
            date: '2026-04-12',
            indicator: 'spx',
            value: 5600,
            change_1d: 1.4,
            change_7d: 2.6,
            source: 'fred',
            created_at: now,
          },
          {
            id: 'macro-vix',
            date: '2026-04-11',
            indicator: 'vix',
            value: 14.2,
            change_1d: -0.5,
            change_7d: -1.2,
            source: 'fred',
            created_at: now,
          },
        ],
      };
    }

    if (sql.includes('SELECT MAX(timestamp) AS latest_timestamp') && sql.includes('FROM price_snapshots')) {
      return { rows: [{ latest_timestamp: now }] };
    }

    if (sql.includes('WITH latest_prices AS (')) {
      return {
        rows: [
          {
            entity_id: 'ent-sol',
            entity_name: 'Solana',
            timestamp: now,
            price_usd: 180,
            price_change_24h: 5.2,
            price_change_7d: 12.4,
            volume_24h: 300_000_000,
            market_cap: 90_000_000_000,
            avg_sentiment: -0.4,
            momentum: 0.2,
          },
        ],
      };
    }

    if (sql.includes('SELECT MAX(ap.first_mention_time) AS latest_timestamp')) {
      return { rows: [{ latest_timestamp: now - 5_000 }] };
    }

    if (sql.includes('WITH recent AS (') && sql.includes('FROM alpha_propagation ap')) {
      return {
        rows: [
          {
            entity_id: 'ent-hype',
            entity_name: 'Hype',
            first_signal_tier: 'alpha',
            first_signal_time: now - 10_000,
            latest_tier: 'influencer',
            latest_mention_time: now - 2_000,
            propagation_lag_ms: 8_000,
            tier_count: 2,
            source_count: 3,
          },
        ],
      };
    }

    if (sql.includes('SELECT MAX(timestamp) AS latest_timestamp') && sql.includes('FROM author_calls')) {
      return { rows: [{ latest_timestamp: now - 10_000 }] };
    }

    if (sql.includes('WITH ranked_calls AS (')) {
      return {
        rows: [
          {
            entity_id: 'ent-move',
            entity_name: 'Mover',
            author_id: 'author-1',
            platform: 'twitter',
            handle: 'alpha',
            display_name: 'Alpha',
            claim_type: 'call',
            claim_text: 'Mover is breaking out',
            source_item_id: 'item-1',
            timestamp: now - 20_000,
            next_tracked_call_time: now - 5_000,
            lead_window_ms: 15_000,
          },
        ],
      };
    }

    if (sql.includes('SELECT MAX(date)::text AS latest_date FROM narratives')) {
      return { rows: [{ latest_date: '2026-04-12' }] };
    }

    if (sql.includes('FROM narratives') && sql.includes('WHERE date = $1::date')) {
      return {
        rows: [
          {
            id: 'nar-1',
            name: 'ETF Rotation',
            date: '2026-04-12',
            member_count: 8,
            avg_sentiment: 0.6,
            signal_strength: 'emerging',
          },
        ],
      };
    }

    if (sql.includes('FROM narratives') && sql.includes('WHERE id = $1')) {
      return {
        rows: [
          {
            id: 'nar-1',
            name: 'ETF Rotation',
            date: '2026-04-12',
            member_count: 8,
            avg_sentiment: 0.6,
            signal_strength: 'strong',
            summary_ids: ['summary-1'],
          },
        ],
      };
    }

    if (sql.includes('FROM summaries') && sql.includes('id = ANY')) {
      return {
        rows: [
          {
            id: 'summary-1',
            source: 'discord',
            source_id: 'guild:1',
            window_start: now - 10_000,
            window_end: now - 5_000,
            body: 'Narrative summary body',
            sentiment: 0.4,
            urgency: 'routine',
            item_count: 2,
            created_at: now - 4_000,
          },
        ],
      };
    }

    return { rows: [], rowCount: 0 };
  });
}

describe('registerInsightRoutes', () => {
  it('rejects unauthenticated requests', async () => {
    const { app, pool } = buildApp({ authPreHandler: noAuthPreHandler });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/macro',
      });

      assert.equal(response.statusCode, 401);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Unauthorized' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('returns 503 when macro insights are disabled', async () => {
    const { app } = buildApp({ config: fakeConfig() });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/macro',
      });

      assert.equal(response.statusCode, 503);
      assert.deepStrictEqual(JSON.parse(response.body), {
        error: 'feature_disabled',
        feature: 'macro',
        missingEnv: 'FRED_API_KEY',
        disables: ['macro snapshots', 'cross-market correlation', 'macro regime detection'],
        reason: 'missing_env',
      });
    } finally {
      await app.close();
    }
  });

  it('returns macro context when the feature is enabled', async () => {
    const { app } = buildApp({
      config: fakeConfig({ fredApiKey: 'fred-key' }),
      pool: createInsightPool(),
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/macro',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        overallBias: 'risk-on',
        latestDate: '2026-04-12',
        entries: [
          {
            indicator: 'vix',
            label: 'VIX',
            value: 14.2,
            change1d: -0.5,
            change7d: -1.2,
            date: '2026-04-11',
            signal: 'risk-on',
            narrative: 'volatility easing',
          },
          {
            indicator: 'spx',
            label: 'S&P 500',
            value: 5600,
            change1d: 1.4,
            change7d: 2.6,
            date: '2026-04-12',
            signal: 'risk-on',
            narrative: 'equities firming',
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('returns unusual activity entries', async () => {
    const { app } = buildApp({ pool: createInsightPool() });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/unusual-activity',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        latestDate: '2026-04-12',
        entries: [
          {
            entityId: 'ent-btc',
            entityName: 'Bitcoin',
            date: '2026-04-12',
            mentionCount: 18,
            baselineMentionCount: 4.5,
            baselinePeakMentionCount: 7,
            baselineDays: 7,
            avgSentiment: 0.42,
            momentum: 0.3,
            spikeRatio: 4,
            relevanceScore: 9,
            lowRelevance: false,
            duplicateClusterSize: null,
            duplicateAuthorCount: null,
            duplicateSourceCount: null,
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('returns 503 when price watch is disabled', async () => {
    const { app } = buildApp({ config: fakeConfig() });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/price-watch',
      });

      assert.equal(response.statusCode, 503);
      assert.equal(JSON.parse(response.body).feature, 'prices');
    } finally {
      await app.close();
    }
  });

  it('returns price watch entries when the feature is enabled', async () => {
    const { app } = buildApp({
      config: fakeConfig({ coingeckoApiKey: 'coingecko-key' }),
      pool: createInsightPool(),
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/price-watch',
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as {
        latestTimestamp: number | null;
        entries: Array<{
          entityId: string;
          entityName: string;
          timestamp: number;
          priceUsd: number;
          priceChange24h: number | null;
          priceChange7d: number | null;
          volume24h: number | null;
          marketCap: number | null;
          avgSentiment: number | null;
          momentum: number | null;
          contrarianSignal: string | null;
        }>;
      };

      assert.equal(typeof body.latestTimestamp, 'number');
      assert.deepStrictEqual(body.entries, [
        {
          entityId: 'ent-sol',
          entityName: 'Solana',
          timestamp: body.entries[0]!.timestamp,
          priceUsd: 180,
          priceChange24h: 5.2,
          priceChange7d: 12.4,
          volume24h: 300_000_000,
          marketCap: 90_000_000_000,
          avgSentiment: -0.4,
          momentum: 0.2,
          contrarianSignal: 'price-up-sentiment-down',
        },
      ]);
    } finally {
      await app.close();
    }
  });

  it('validates alpha watch query params', async () => {
    const { app } = buildApp({ pool: createInsightPool() });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/alpha-watch?limit=100',
      });

      assert.equal(response.statusCode, 400);
    } finally {
      await app.close();
    }
  });

  it('returns alpha watch entries', async () => {
    const { app } = buildApp({ pool: createInsightPool() });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/alpha-watch?limit=2&days=3',
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as {
        latestTimestamp: number | null;
        entries: Array<{
          entityId: string;
          entityName: string;
          firstSignalTier: string;
          firstSignalTime: number;
          latestTier: string;
          latestMentionTime: number;
          propagationLagMs: number | null;
          tierCount: number;
          sourceCount: number;
        }>;
      };

      assert.equal(typeof body.latestTimestamp, 'number');
      assert.deepStrictEqual(body.entries, [
        {
          entityId: 'ent-hype',
          entityName: 'Hype',
          firstSignalTier: 'alpha',
          firstSignalTime: body.entries[0]!.firstSignalTime,
          latestTier: 'influencer',
          latestMentionTime: body.entries[0]!.latestMentionTime,
          propagationLagMs: 8_000,
          tierCount: 2,
          sourceCount: 3,
        },
      ]);
    } finally {
      await app.close();
    }
  });

  it('returns first mover entries', async () => {
    const { app } = buildApp({ pool: createInsightPool() });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/first-movers?limit=2&days=3',
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as {
        latestTimestamp: number | null;
        entries: Array<{
          entityId: string;
          entityName: string;
          authorId: string;
          platform: string;
          handle: string;
          displayName: string | null;
          claimType: string;
          claimText: string;
          sourceItemId: string | null;
          timestamp: number;
          nextTrackedCallTime: number | null;
          leadWindowMs: number | null;
        }>;
      };
      assert.equal(typeof body.latestTimestamp, 'number');
      assert.deepStrictEqual(body.entries, [
        {
          entityId: 'ent-move',
          entityName: 'Mover',
          authorId: 'author-1',
          platform: 'twitter',
          handle: 'alpha',
          displayName: 'Alpha',
          claimType: 'call',
          claimText: 'Mover is breaking out',
          sourceItemId: 'item-1',
          timestamp: body.entries[0]!.timestamp,
          nextTrackedCallTime: body.entries[0]!.nextTrackedCallTime,
          leadWindowMs: 15_000,
        },
      ]);
    } finally {
      await app.close();
    }
  });

  it('returns 503 when narrative insights are disabled', async () => {
    const { app } = buildApp({ config: fakeConfig() });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/narratives',
      });

      assert.equal(response.statusCode, 503);
      assert.equal(JSON.parse(response.body).feature, 'embeddings');
    } finally {
      await app.close();
    }
  });

  it('returns the narrative watchlist when embeddings are enabled', async () => {
    const { app } = buildApp({
      config: fakeConfig({ geminiApiKey: 'gemini-key' }),
      pool: createInsightPool(),
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/narratives',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        latestDate: '2026-04-12',
        entries: [
          {
            id: 'nar-1',
            name: 'ETF Rotation',
            date: '2026-04-12',
            memberCount: 8,
            avgSentiment: 0.6,
            signalStrength: 'emerging',
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('returns 404 when a narrative drilldown is missing', async () => {
    const pool = createInsightPool();
    const missingPool = makeMockPool((sql, params) => {
      if (sql.includes('FROM narratives') && sql.includes('WHERE id = $1') && params?.[0] === 'nar-missing') {
        return { rows: [] };
      }

      return pool.query(sql, params);
    });
    const { app } = buildApp({
      config: fakeConfig({ geminiApiKey: 'gemini-key' }),
      pool: missingPool,
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/narratives/nar-missing',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Narrative not found' });
    } finally {
      await app.close();
    }
  });

  it('returns a narrative drilldown with summary previews', async () => {
    const { app } = buildApp({
      config: fakeConfig({ geminiApiKey: 'gemini-key' }),
      pool: createInsightPool(),
      getNarrativeSummaryPreview: (body) => `preview:${body}`,
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/narratives/nar-1',
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as {
        narrative: {
          id: string;
          name: string;
          date: string;
          memberCount: number;
          avgSentiment: number | null;
          signalStrength: string;
          summaries: Array<{
            id: string;
            source: string;
            sourceId: string;
            sentiment: number | null;
            urgency: string | null;
            itemCount: number;
            createdAt: number;
            text: string;
          }>;
        };
      };

      assert.deepStrictEqual(body.narrative, {
        id: 'nar-1',
        name: 'ETF Rotation',
        date: '2026-04-12',
        memberCount: 8,
        avgSentiment: 0.6,
        signalStrength: 'strong',
        summaries: [
          {
            id: 'summary-1',
            source: 'discord',
            sourceId: 'guild:1',
            sentiment: 0.4,
            urgency: 'routine',
            itemCount: 2,
            createdAt: body.narrative.summaries[0]!.createdAt,
            text: 'preview:Narrative summary body',
          },
        ],
      });
      assert.equal(typeof body.narrative.summaries[0]?.createdAt, 'number');
    } finally {
      await app.close();
    }
  });
});
