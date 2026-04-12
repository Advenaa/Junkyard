import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from './db/connection.js';
import { getAppConfig } from './db/queries.js';

type RoutePreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

interface OnboardingRouteDeps {
  app: FastifyInstance;
  authPreHandler: RoutePreHandler;
  pool: Pool;
}

interface OnboardingSnapshotRow {
  source_count: string;
  items_ready: string;
  items_processing: string;
  summaries_today: string;
  dismissed_onboarding?: boolean | null;
}

function toStatusSummary(row: OnboardingSnapshotRow) {
  return {
    itemsReady: parseInt(row.items_ready, 10),
    itemsProcessing: parseInt(row.items_processing, 10),
    summariesToday: parseInt(row.summaries_today, 10),
  };
}

export function registerOnboardingRoutes({ app, authPreHandler, pool }: OnboardingRouteDeps): void {
  app.get('/api/v1/onboarding', { preHandler: [authPreHandler] }, async (request) => {
    const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';

    if (request.user?.discordId === 'api-key') {
      const { rows } = await pool.query<OnboardingSnapshotRow>(
        `SELECT
          (SELECT count(*) FROM sources) AS source_count,
          (SELECT count(*) FROM items WHERE status = 'ready') AS items_ready,
          (SELECT count(*) FROM items WHERE status = 'processing') AS items_processing,
          (
            SELECT count(*)
            FROM summaries
            WHERE created_at > EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000
          ) AS summaries_today`,
        [timezone],
      );

      const row = rows[0];
      return {
        showOnboarding: false,
        sourceCount: parseInt(row.source_count, 10),
        statusSummary: toStatusSummary(row),
      };
    }

    const { rows } = await pool.query<OnboardingSnapshotRow>(
      `SELECT
        (SELECT count(*) FROM sources) AS source_count,
        (SELECT count(*) FROM items WHERE status = 'ready') AS items_ready,
        (SELECT count(*) FROM items WHERE status = 'processing') AS items_processing,
        (
          SELECT count(*)
          FROM summaries
          WHERE created_at > EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $2)) * 1000
        ) AS summaries_today,
        (SELECT dismissed_onboarding FROM users WHERE discord_id = $1) AS dismissed_onboarding`,
      [request.user!.discordId, timezone],
    );

    const row = rows[0];
    const sourceCount = parseInt(row.source_count, 10);
    const dismissedOnboarding = row.dismissed_onboarding ?? false;

    return {
      showOnboarding: dismissedOnboarding === false && sourceCount === 0,
      sourceCount,
      statusSummary: toStatusSummary(row),
    };
  });

  app.patch(
    '/api/v1/onboarding/dismiss',
    {
      preHandler: [authPreHandler],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (request.user?.discordId === 'api-key') {
        return { ok: true };
      }

      const result = await pool.query(`UPDATE users SET dismissed_onboarding = TRUE WHERE discord_id = $1`, [
        request.user!.discordId,
      ]);

      if ((result.rowCount ?? 0) === 0) {
        return reply.code(404).send({ error: 'User not found' });
      }

      return { ok: true };
    },
  );
}
