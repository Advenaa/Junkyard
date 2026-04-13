import { getAppConfig, getLlmCostByModel } from '../db/queries.js';
import {
  COST_SPIKES_BASELINE_MS,
  COST_SPIKES_WINDOW_HOURS,
  COST_SPIKES_WINDOW_MS,
  STUCK_THRESHOLD_MS,
  type AdminRouteDeps,
} from '../server-admin-routes.js';
import { toCamelCase } from '../server-route-helpers.js';

export function registerDiagnosticsRoutes({
  app,
  authPreHandler,
  config,
  getSchedulerDiagnostics,
  pool,
  requireAdmin,
}: AdminRouteDeps): void {
  app.get('/api/v1/status', { preHandler: [authPreHandler] }, async () => {
    const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';
    const { rows } = await pool.query<{
      items_ready: string;
      items_processing: string;
      summaries_today: string;
      reports_today: string;
      cost_today: string;
    }>(
      `SELECT
        (SELECT count(*) FROM items WHERE status = 'ready') AS items_ready,
        (SELECT count(*) FROM items WHERE status = 'processing') AS items_processing,
        (SELECT count(*) FROM summaries WHERE created_at > EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000) AS summaries_today,
        (SELECT count(*) FROM reports WHERE created_at > EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000) AS reports_today,
        (SELECT COALESCE(SUM(cost_usd), 0) FROM llm_usage WHERE created_at > EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000) AS cost_today`,
      [timezone],
    );
    const row = rows[0];
    return {
      twitterApiKeyConfigured: !!config.twitterApiKey,
      itemsReady: parseInt(row.items_ready, 10),
      itemsProcessing: parseInt(row.items_processing, 10),
      summariesToday: parseInt(row.summaries_today, 10),
      reportsToday: parseInt(row.reports_today, 10),
      costToday: parseFloat(row.cost_today),
      disabledFeatures: (Object.keys(config.disabledFeatures) as Array<keyof typeof config.disabledFeatures>)
        .filter((key) => config.disabledFeatures[key].disabled)
        .map((key) => ({
          feature: key,
          missingEnv: config.disabledFeatures[key].missingEnv,
          disables: config.disabledFeatures[key].disables,
          reason: config.disabledFeatures[key].keyRejected ? 'auth_failed' : 'missing_env',
        })),
    };
  });

  app.get('/api/v1/llm/cost-by-model', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';
    const startOfDayResult = await pool.query<{ start_of_day: string }>(
      `SELECT EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000 AS start_of_day`,
      [timezone],
    );
    const startOfDayMs = parseInt(startOfDayResult.rows[0]?.start_of_day ?? '0', 10);
    const entries = await getLlmCostByModel(pool, startOfDayMs);
    return { timezone, sinceMs: startOfDayMs, entries };
  });

  app.get('/api/v1/diag/stuck-items', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const nowMs = Date.now();
    const { rows: aggRows } = await pool.query<{
      stuck_count: string;
      oldest_age_ms: string | null;
    }>(
      `SELECT
        count(*) AS stuck_count,
        ($1::bigint - MIN(created_at))::text AS oldest_age_ms
      FROM items
      WHERE status = 'processing' AND created_at < $1::bigint - $2::bigint`,
      [nowMs, STUCK_THRESHOLD_MS],
    );
    const { rows: sampleRows } = await pool.query<{
      id: string;
      source: string;
      source_id: string;
      created_at: string;
    }>(
      `SELECT id, source, source_id, created_at::text
       FROM items
       WHERE status = 'processing' AND created_at < $1::bigint - $2::bigint
       ORDER BY created_at ASC
       LIMIT 10`,
      [nowMs, STUCK_THRESHOLD_MS],
    );
    const agg = aggRows[0];
    return {
      thresholdMs: STUCK_THRESHOLD_MS,
      stuckCount: parseInt(agg.stuck_count, 10),
      oldestAgeMs: agg.oldest_age_ms === null ? 0 : parseInt(agg.oldest_age_ms, 10),
      sample: sampleRows.map((row) => toCamelCase(row as unknown as Record<string, unknown>)),
    };
  });

  app.get('/api/v1/diag/backpressure', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const nowMs = Date.now();
    const { rows } = await pool.query<{
      ready_count: string;
      processing_count: string;
      oldest_ready_age_ms: string | null;
    }>(
      `SELECT
        (SELECT count(*) FROM items WHERE status = 'ready') AS ready_count,
        (SELECT count(*) FROM items WHERE status = 'processing') AS processing_count,
        (SELECT ($1::bigint - MIN(created_at))::text FROM items WHERE status = 'ready') AS oldest_ready_age_ms`,
      [nowMs],
    );
    const row = rows[0];
    return {
      readyCount: parseInt(row.ready_count, 10),
      processingCount: parseInt(row.processing_count, 10),
      oldestReadyAgeMs: row.oldest_ready_age_ms === null ? 0 : parseInt(row.oldest_ready_age_ms, 10),
    };
  });

  app.get('/api/v1/diag/halted-sources', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const { rows } = await pool.query<{
      source: string;
      source_id: string;
      status: string;
      error_count: number | null;
      last_error: string | null;
      last_fetched_at: string | null;
    }>(
      `SELECT s.source, s.source_id, ss.status, ss.error_count, ss.last_error, ss.last_fetched_at::text
       FROM sources s
       INNER JOIN source_state ss ON ss.source = s.source AND ss.source_id = s.source_id
       WHERE ss.status = 'halted'
       ORDER BY ss.error_count DESC NULLS LAST`,
    );
    return {
      haltedSources: rows.map((row) => toCamelCase(row as unknown as Record<string, unknown>)),
    };
  });

  app.get('/api/v1/diag/scheduler', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    return (
      getSchedulerDiagnostics?.() ?? {
        processTimezone: process.env.TZ ?? null,
        jobs: [],
      }
    );
  });

  app.get<{ Querystring: { sinceMs?: number; limit?: number } }>(
    '/api/v1/diag/health-events',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            sinceMs: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? 50;
      const sinceMs = request.query.sinceMs ?? Date.now() - 24 * 60 * 60 * 1000;
      const { rows } = await pool.query<{
        id: string;
        category: string;
        severity: string;
        message: string;
        metadata: unknown;
        acknowledged: boolean;
        created_at: string;
      }>(
        `SELECT id, category, severity, message, metadata, acknowledged, created_at::text
         FROM health_events
         WHERE severity IN ('warn', 'error', 'critical') AND created_at >= $1::bigint
         ORDER BY created_at DESC
         LIMIT $2::int`,
        [sinceMs, limit],
      );
      return {
        sinceMs,
        limit,
        events: rows.map((row) => toCamelCase(row as unknown as Record<string, unknown>)),
      };
    },
  );

  app.get('/api/v1/diag/cost-spikes', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const nowMs = Date.now();
    const recentSinceMs = nowMs - COST_SPIKES_WINDOW_MS;
    const historicalSinceMs = recentSinceMs - COST_SPIKES_BASELINE_MS;
    const { rows } = await pool.query<{
      model: string;
      hour_epoch_ms: string;
      actual_usd: string;
      baseline_usd: string;
      ratio: string;
    }>(
      `WITH recent AS (
         SELECT
           model,
           date_trunc('hour', timezone('UTC', to_timestamp(created_at / 1000.0))) AS hour_ts,
           SUM(cost_usd) AS actual_usd
         FROM llm_usage
         WHERE created_at >= $1::bigint
         GROUP BY model, hour_ts
       ),
       historical AS (
         SELECT
           model,
           EXTRACT(HOUR FROM timezone('UTC', to_timestamp(created_at / 1000.0))) AS hour_of_day,
           SUM(cost_usd) AS bucket_usd
         FROM llm_usage
         WHERE created_at >= $2::bigint AND created_at < $1::bigint
         GROUP BY
           model,
           date_trunc('hour', timezone('UTC', to_timestamp(created_at / 1000.0))),
           EXTRACT(HOUR FROM timezone('UTC', to_timestamp(created_at / 1000.0)))
       ),
       baselines AS (
         SELECT
           model,
           hour_of_day,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY bucket_usd) AS median_usd
         FROM historical
         GROUP BY model, hour_of_day
       )
       SELECT
         r.model,
         (EXTRACT(EPOCH FROM (r.hour_ts AT TIME ZONE 'UTC')) * 1000)::bigint AS hour_epoch_ms,
         r.actual_usd,
         b.median_usd AS baseline_usd,
         r.actual_usd / NULLIF(b.median_usd, 0) AS ratio
       FROM recent r
       INNER JOIN baselines b
         ON b.model = r.model
         AND b.hour_of_day = EXTRACT(HOUR FROM r.hour_ts)
       WHERE b.median_usd > 0
         AND r.actual_usd > 3 * b.median_usd
       ORDER BY r.actual_usd / NULLIF(b.median_usd, 0) DESC`,
      [recentSinceMs, historicalSinceMs],
    );
    return {
      windowHours: COST_SPIKES_WINDOW_HOURS,
      spikes: rows.map((row) =>
        toCamelCase<{
          model: string;
          hourEpochMs: number;
          actualUsd: number;
          baselineUsd: number;
          ratio: number;
        }>({
          model: row.model,
          hour_epoch_ms: Number(row.hour_epoch_ms),
          actual_usd: Number(row.actual_usd),
          baseline_usd: Number(row.baseline_usd),
          ratio: Number(row.ratio),
        }),
      ),
    };
  });
}
