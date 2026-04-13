import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

import type { ReportRow, SummaryEventWithChainRow } from '../../src/db/queries.js';
import { registerReportRoutes } from '../../src/server-report-routes.js';
import { fakeRequest, fakeSummary, makeMockLogger, makeMockPool } from '../helpers/factories.js';

interface RouteUser {
  discordId: string;
  username: string;
  role: string;
}

const ADMIN_USER = fakeRequest({
  user: {
    discordId: '123456789012345678',
    username: 'report-admin',
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

function createReport(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 'report-1',
    date: '2026-04-13',
    type: 'daily',
    body: JSON.stringify({
      keyEvents: ['ETF flows accelerated'],
      sourceFamilies: ['discord'],
      sections: [{ heading: 'Flows', body: 'Risk appetite firmed across majors.' }],
    }),
    tldr: 'ETF flows accelerated',
    sentiment: 0.3,
    delivery_status: 'sent',
    delivered_at: null,
    created_at: Date.UTC(2026, 3, 13, 8, 0, 0),
    ...overrides,
  };
}

function buildApp(
  options: {
    authPreHandler?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
    pool?: ReturnType<typeof makeMockPool>;
  } = {},
) {
  const pool = options.pool ?? makeMockPool();
  const app = fastify({ loggerInstance: createLogger() as never });
  app.decorateRequest('user', null);

  registerReportRoutes({
    app,
    authPreHandler: options.authPreHandler ?? authedPreHandler(),
    pool: pool as never,
  });

  return { app, pool };
}

describe('registerReportRoutes', () => {
  it('rejects unauthenticated requests', async () => {
    const { app, pool } = buildApp({ authPreHandler: noAuthPreHandler });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/reports',
      });

      assert.equal(response.statusCode, 401);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Unauthorized' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('lists reports and applies bookmark filters in the SQL query', async () => {
    const report = createReport();
    const pool = makeMockPool((sql) => {
      if (sql.includes('FROM reports') && sql.includes('SELECT reports.id')) {
        return { rows: [report] };
      }

      if (sql.includes('SELECT COUNT(*) AS count FROM reports')) {
        return { rows: [{ count: '1' }] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/reports?type=daily&bookmarked=true&limit=1&offset=0',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        reports: [
          {
            id: 'report-1',
            date: '2026-04-13',
            type: 'daily',
            tldr: 'ETF flows accelerated',
            sentiment: 0.3,
            deliveryStatus: 'sent',
            deliveredAt: null,
            createdAt: report.created_at,
            keyEvents: ['ETF flows accelerated'],
            sourceFamilies: ['discord'],
          },
        ],
        total: 1,
      });
      assert.match(pool.calls[0]!.sql, /INNER JOIN bookmarks/);
      assert.equal(pool.calls[0]!.params[2], 'daily');
      assert.equal(pool.calls[0]!.params[3], ADMIN_USER.discordId);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when a report is missing', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT * FROM reports WHERE id = $1')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/reports/report-missing',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Report not found' });
    } finally {
      await app.close();
    }
  });

  it('returns a parsed report payload for report drilldowns', async () => {
    const report = createReport({
      body: JSON.stringify({
        keyEvents: ['ETF flows accelerated'],
        sourceFamilies: ['discord'],
        entitySentiment: [{ name: 'Bitcoin', sentiment: 0.4 }],
        sections: [{ heading: 'Flows', body: 'Risk appetite firmed across majors.' }],
      }),
    });
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT * FROM reports WHERE id = $1')) {
        return { rows: [report] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/reports/report-1',
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as { report: Record<string, unknown> };
      assert.deepStrictEqual(body.report, {
        id: 'report-1',
        date: '2026-04-13',
        type: 'daily',
        body: report.body,
        tldr: 'ETF flows accelerated',
        sentiment: 0.3,
        deliveryStatus: 'sent',
        deliveredAt: null,
        createdAt: report.created_at,
        keyEvents: ['ETF flows accelerated'],
        marketCatalysts: [],
        regionalDivergence: [],
        narrativeShifts: [],
        eventChains: [],
        firstMovers: [],
        alphaSignals: [],
        priceAlerts: [],
        unusualActivity: [],
        macroAlerts: [],
        entitySentiment: [{ name: 'Bitcoin', sentiment: 0.4 }],
        sections: [{ heading: 'Flows', body: 'Risk appetite firmed across majors.' }],
        sourceFamilies: ['discord'],
        newProjects: [],
      });
    } finally {
      await app.close();
    }
  });

  it('validates report export format values', async () => {
    const { app, pool } = buildApp();
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/reports/report-1/export?format=csv',
      });

      assert.equal(response.statusCode, 400);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'format must be "md" or "json"' });
      assert.equal(pool.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it('exports reports as JSON attachments', async () => {
    const report = createReport();
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT * FROM reports WHERE id = $1')) {
        return { rows: [report] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/reports/report-1/export?format=json',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
      assert.equal(response.headers['content-disposition'], 'attachment; filename="report-report-1.json"');
      assert.equal(JSON.parse(response.body).report.keyEvents[0], 'ETF flows accelerated');
    } finally {
      await app.close();
    }
  });

  it('exports reports as markdown attachments', async () => {
    const report = createReport();
    const { app } = buildApp({
      pool: makeMockPool((sql) => {
        if (sql.includes('SELECT * FROM reports WHERE id = $1')) {
          return { rows: [report] };
        }

        return { rows: [], rowCount: 0 };
      }),
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/reports/report-1/export?format=md',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['content-disposition'], 'attachment; filename="report-report-1.md"');
      assert.match(response.body, /^# Daily Report/);
      assert.match(response.body, /## Key Events/);
      assert.match(response.body, /ETF flows accelerated/);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when a summary is missing', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT * FROM summaries WHERE id = $1 LIMIT 1')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/summaries/summary-missing',
      });

      assert.equal(response.statusCode, 404);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Summary not found' });
    } finally {
      await app.close();
    }
  });

  it('returns summary drilldowns with persisted entities and events', async () => {
    const summary = fakeSummary({
      id: 'summary-1',
      body: 'Plain summary body',
      created_at: Date.UTC(2026, 3, 13, 8, 30, 0),
    });
    const eventRow: SummaryEventWithChainRow = {
      id: 'event-1',
      entity_name: 'Bitcoin',
      event_type: 'launch',
      description: 'Launch announced',
      event_time: Date.UTC(2026, 3, 13, 8, 20, 0),
      summary_id: 'summary-1',
      chain_root_id: 'event-1',
      chain_event_count: 1,
      chain_position: 1,
      chain_first_event_time: Date.UTC(2026, 3, 13, 8, 20, 0),
      chain_latest_event_time: Date.UTC(2026, 3, 13, 8, 20, 0),
      chain_event_types: ['launch'],
      previous_summary_id: null,
      previous_event_type: null,
      previous_event_description: null,
      previous_event_time: null,
      next_summary_id: null,
      next_event_type: null,
      next_event_description: null,
      next_event_time: null,
    };
    const pool = makeMockPool((sql) => {
      if (sql.includes('SELECT * FROM summaries WHERE id = $1 LIMIT 1')) {
        return { rows: [summary] };
      }

      if (sql.includes('FROM entity_mentions em')) {
        return {
          rows: [
            {
              id: 'mention-1',
              entity_name: 'Bitcoin',
              entity_type: 'token',
              mention_count: 3,
              sentiment: 0.4,
            },
          ],
        };
      }

      if (sql.includes('WITH summary_events AS (')) {
        return { rows: [eventRow] };
      }

      return { rows: [], rowCount: 0 };
    });
    const { app } = buildApp({ pool });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/summaries/summary-1',
      });

      assert.equal(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), {
        summary: {
          id: 'summary-1',
          source: summary.source,
          sourceId: summary.source_id,
          windowStart: summary.window_start,
          windowEnd: summary.window_end,
          body: 'Plain summary body',
          sentiment: summary.sentiment,
          urgency: summary.urgency,
          itemCount: summary.item_count,
          createdAt: summary.created_at,
          text: 'Plain summary body',
          confidence: null,
          keyEvents: [],
          entities: [
            {
              name: 'Bitcoin',
              aliases: [],
              type: 'token',
              mentionCount: 3,
              sentiment: 0.4,
              entityMentionId: 'mention-1',
            },
          ],
          events: [
            {
              entityName: 'Bitcoin',
              eventType: 'launch',
              description: 'Launch announced',
              eventTime: eventRow.event_time,
              chain: null,
            },
          ],
        },
      });
    } finally {
      await app.close();
    }
  });
});
