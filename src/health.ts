import type { Pool } from './db/connection.js';
import type { Logger } from './logger.js';
import type { Config } from './config.js';
import { ulid } from 'ulid';
import { fetchValidated, validateUrl } from './url-validator.js';
import { getAppConfig } from './db/queries.js';

const READY_BACKLOG_THRESHOLD = 5000;

export interface HealthCheckResult {
  name: string;
  status: 'ok' | 'warn' | 'critical';
  message?: string;
}

export interface HealthEvent {
  category: string;
  severity: 'warn' | 'critical';
  message: string;
  metadata: Record<string, unknown>;
}

export interface HealthMonitor {
  check(): Promise<void>;
  getStatus(): Promise<{ checks: HealthCheckResult[]; healthy: boolean }>;
  recordEvent(event: HealthEvent): Promise<void>;
}

export function createHealthMonitor(pool: Pool, log: Logger, config: Config): HealthMonitor {
  let readyBacklogHighTicks = 0;

  // HM-001: Log confirmation that alert webhook is configured (URL already validated in config.ts)
  if (config.alertWebhookUrl) {
    log.info({ url: config.alertWebhookUrl }, 'Alert webhook URL configured');
  } else {
    log.warn('No alert webhook URL configured — critical alerts will only be logged');
  }

  async function checkDbConnectivity(): Promise<HealthCheckResult> {
    try {
      const start = Date.now();
      await pool.query('SELECT 1');
      const latencyMs = Date.now() - start;

      if (latencyMs > 5000) {
        return { name: 'db_connectivity', status: 'warn', message: `DB responding but slow (${latencyMs}ms)` };
      }
      return { name: 'db_connectivity', status: 'ok', message: `DB responsive (${latencyMs}ms)` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { name: 'db_connectivity', status: 'critical', message: `DB unreachable: ${msg}` };
    }
  }

  async function checkSourceSilence(): Promise<HealthCheckResult> {
    // HM-020: LEFT JOIN to catch sources without source_state rows
    const { rows } = await pool.query<{
      label: string | null;
      poll_interval: number;
      last_fetched_at: number | null;
      status: string | null;
    }>(`
      SELECT s.label, s.poll_interval, ss.last_fetched_at, ss.status
      FROM sources s
      LEFT JOIN source_state ss ON ss.source = s.source AND ss.source_id = s.source_id
    `);

    const now = Date.now();
    const silent: string[] = [];

    for (const row of rows) {
      if (row.status === 'disabled' || row.status === 'halted') continue; // HM-020
      if (!row.last_fetched_at) {
        // HM-020: Never successfully polled (or no source_state yet)
        silent.push(row.label ?? 'unknown');
        continue;
      }
      const elapsedMs = now - row.last_fetched_at;
      if (elapsedMs > 3 * row.poll_interval * 1000) {
        silent.push(row.label ?? 'unknown');
      }
    }

    if (silent.length > 0) {
      return {
        name: 'source_silence',
        status: 'warn',
        message: `Silent sources: ${silent.join(', ')}`,
      };
    }
    return { name: 'source_silence', status: 'ok' };
  }

  async function checkSourceDisabled(): Promise<HealthCheckResult> {
    const { rows } = await pool.query<{ label: string | null }>(`
      SELECT s.label
      FROM sources s
      JOIN source_state ss ON ss.source = s.source AND ss.source_id = s.source_id
      WHERE ss.status = 'disabled'
    `);

    if (rows.length > 0) {
      const names = rows.map((r) => r.label ?? 'unknown');
      return {
        name: 'source_disabled',
        status: 'critical',
        message: `Disabled sources: ${names.join(', ')}`,
      };
    }
    return { name: 'source_disabled', status: 'ok' };
  }

  async function checkSourceHalted(): Promise<HealthCheckResult> {
    const { rows } = await pool.query<{ source: string; source_id: string }>(`
      SELECT s.source, s.source_id FROM sources s
      JOIN source_state ss ON ss.source = s.source AND ss.source_id = s.source_id
      WHERE ss.status = 'halted'
    `);
    if (rows.length > 0) {
      const labels = rows.map((r) => `${r.source}:${r.source_id}`).join(', ');
      return {
        name: 'source_halted',
        status: 'critical',
        message: `Halted sources (likely auth failure): ${labels}`,
      };
    }
    return { name: 'source_halted', status: 'ok' };
  }

  async function checkLlmFailures(): Promise<HealthCheckResult> {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    const { rows: usageRows } = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*) AS count
      FROM llm_usage
      WHERE created_at > $1
    `,
      [oneHourAgo],
    );

    const recentUsage = parseInt(usageRows[0].count, 10);

    if (recentUsage === 0) {
      const { rows: readyRows } = await pool.query<{ count: string }>(
        `
        SELECT COUNT(*) AS count
        FROM items
        WHERE status = 'ready'
          AND created_at < $1
      `,
        [oneHourAgo],
      );

      const staleReady = parseInt(readyRows[0].count, 10);
      if (staleReady > 0) {
        return {
          name: 'llm_failures',
          status: 'critical',
          message: `No LLM usage in last hour with ${staleReady} stale ready items`,
        };
      }
    }

    return { name: 'llm_failures', status: 'ok' };
  }

  async function checkMissedPulse(): Promise<HealthCheckResult> {
    const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    const { rows } = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*) AS count
      FROM reports
      WHERE type = 'pulse'
        AND created_at > $1
    `,
      [fourHoursAgo],
    );

    if (parseInt(rows[0].count, 10) > 0) {
      return { name: 'missed_pulse', status: 'ok' };
    }

    const { rows: summaryRows } = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*) AS count
      FROM summaries
      WHERE created_at > $1
        AND created_at <= $2
    `,
      [fourHoursAgo, oneHourAgo],
    );

    if (parseInt(summaryRows[0].count, 10) === 0) {
      return { name: 'missed_pulse', status: 'ok' };
    }

    return {
      name: 'missed_pulse',
      status: 'critical',
      message: 'No pulse report in last 4 hours',
    };
  }

  async function checkMissedDaily(): Promise<HealthCheckResult> {
    const twentySixHoursAgo = Date.now() - 26 * 60 * 60 * 1000;

    const { rows } = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*) AS count
      FROM reports
      WHERE type = 'daily'
        AND created_at > $1
    `,
      [twentySixHoursAgo],
    );

    if (parseInt(rows[0].count, 10) === 0) {
      return {
        name: 'missed_daily',
        status: 'critical',
        message: 'No daily report in last 26 hours',
      };
    }
    return { name: 'missed_daily', status: 'ok' };
  }

  function checkDbPoolExhaustion(): HealthCheckResult {
    const total = pool.totalCount;
    const idle = pool.idleCount;
    const poolMax = pool.options?.max ?? 10;

    if (idle === 0 && total >= poolMax) {
      return {
        name: 'db_pool_exhaustion',
        status: 'warn',
        message: `Pool exhausted: ${total} total, ${idle} idle`,
      };
    }
    return { name: 'db_pool_exhaustion', status: 'ok' };
  }

  async function checkCostSpike(): Promise<HealthCheckResult> {
    const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';

    const { rows } = await pool.query<{
      today_cost: string | null;
      avg_cost: string | null;
    }>(
      `
      SELECT
        (SELECT COALESCE(SUM(cost_usd), 0) FROM llm_usage
         WHERE created_at >= EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000
        ) AS today_cost,
        (SELECT COALESCE(SUM(cost_usd), 0) / 7.0
           FROM llm_usage
           WHERE created_at >= EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1) - INTERVAL '7 days') * 1000
             AND created_at < EXTRACT(EPOCH FROM date_trunc('day', NOW() AT TIME ZONE $1)) * 1000
        ) AS avg_cost
    `,
      [timezone],
    );

    const todayCost = parseFloat(rows[0].today_cost ?? '0');
    const avgCost = parseFloat(rows[0].avg_cost ?? '0');

    if (avgCost > 0 && todayCost > 3 * avgCost) {
      return {
        name: 'cost_spike',
        status: 'warn',
        message: `Today's cost $${todayCost.toFixed(4)} is >3x 7-day avg $${avgCost.toFixed(4)}`,
      };
    }
    return { name: 'cost_spike', status: 'ok' };
  }

  async function checkEntityAliases(): Promise<HealthCheckResult> {
    try {
      const activeSince = Date.now() - 24 * 60 * 60 * 1000;

      const { rows: aliasRows } = await pool.query<{ alias_count?: number | string; count?: number | string }>(
        `
        SELECT COUNT(*)::int AS alias_count
        FROM entity_aliases
      `,
      );
      const { rows: entityRows } = await pool.query<{ entity_count?: number | string; count?: number | string }>(
        `
        SELECT COUNT(*)::int AS entity_count
        FROM entities
        WHERE last_seen > $1
      `,
        [activeSince],
      );

      const aliasCount = Number(aliasRows[0]?.alias_count ?? aliasRows[0]?.count ?? 0);
      const entityCount = Number(entityRows[0]?.entity_count ?? entityRows[0]?.count ?? 0);

      if (entityCount === 0) {
        return {
          name: 'entity_aliases',
          status: 'ok',
          message: 'No active entities yet — skipping alias health check',
        };
      }

      if (aliasCount < 100) {
        return {
          name: 'entity_aliases',
          status: 'warn',
          message: `Only ${aliasCount} entity aliases present but ${entityCount} active entities — seeding may have failed`,
        };
      }

      return {
        name: 'entity_aliases',
        status: 'ok',
        message: `Entity alias table healthy: ${aliasCount} aliases for ${entityCount} active entities`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        name: 'entity_aliases',
        status: 'critical',
        message: `Entity alias health check failed: ${msg}`,
      };
    }
  }

  async function checkReadyBacklog(): Promise<HealthCheckResult> {
    const { rows } = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*) AS count
      FROM items
      WHERE status = 'ready'
    `,
    );
    const count = parseInt(rows[0]?.count ?? '0', 10);

    if (count > READY_BACKLOG_THRESHOLD) {
      readyBacklogHighTicks += 1;

      if (readyBacklogHighTicks >= 2) {
        return {
          name: 'ready_backlog',
          status: 'critical',
          message: `Ready-item backlog ${count} > ${READY_BACKLOG_THRESHOLD} for ${readyBacklogHighTicks} consecutive checks`,
        };
      }

      return {
        name: 'ready_backlog',
        status: 'warn',
        message: `Ready-item backlog ${count} > ${READY_BACKLOG_THRESHOLD} (first tick — will alert on next consecutive tick)`,
      };
    }

    readyBacklogHighTicks = 0;
    return { name: 'ready_backlog', status: 'ok' };
  }

  async function insertEvent(event: HealthEvent): Promise<void> {
    const id = ulid();
    const now = Date.now();
    const cutoff = now - 30 * 60 * 1000;

    // HM-021: Atomic dedup — INSERT only if no recent unacknowledged event exists
    const { rowCount } = await pool.query(
      `INSERT INTO health_events (id, category, severity, message, metadata, created_at)
       SELECT $1, $2, $3, $4, $5, $6
       WHERE NOT EXISTS (
         SELECT 1 FROM health_events
         WHERE category = $2
           AND acknowledged = false
           AND created_at > $7
           AND (severity = $3 OR $3 = 'warn')
       )`,
      [id, event.category, event.severity, event.message, JSON.stringify(event.metadata), now, cutoff],
    );

    if ((rowCount ?? 0) === 0) {
      log.debug({ category: event.category }, 'Skipping duplicate health event');
      return;
    }

    if (event.severity === 'critical' && config.alertWebhookUrl) {
      await sendAlertWebhook(event);
    }
  }

  async function sendAlertWebhook(event: HealthEvent): Promise<void> {
    if (!config.alertWebhookUrl) return;

    const validation = await validateUrl(config.alertWebhookUrl);
    if (!validation.valid || !validation.resolvedIp) {
      log.error({ reason: validation.reason }, 'Alert webhook URL failed SSRF validation');
      return;
    }

    const body = {
      embeds: [
        {
          title: `Health Alert: ${event.category}`,
          description: event.message,
          color: 0xff0000,
          timestamp: new Date().toISOString(),
        },
      ],
      allowed_mentions: { parse: [] as string[] },
    };

    // Retry once on failure (DL-007)
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { response } = await fetchValidated(
          config.alertWebhookUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
          },
          validation,
        );
        if (!response) {
          log.error({ reason: validation.reason }, 'Alert webhook URL failed SSRF validation during delivery');
          return;
        }
        if (response.ok) {
          await response.body?.cancel().catch(() => undefined);
          return;
        }
        if (response.status < 500) {
          await response.body?.cancel().catch(() => undefined);
          return; // Client error, don't retry
        }
        await response.body?.cancel().catch(() => undefined);
        lastErr = new Error(`Alert webhook returned ${response.status}`);
      } catch (err: unknown) {
        lastErr = err;
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    log.error({ err: lastErr }, 'Alert webhook failed after 2 attempts');
  }

  async function runChecks(): Promise<HealthCheckResult[]> {
    // Run DB connectivity first — if DB is down, skip DB-dependent checks
    // to avoid cascading spurious critical alerts.
    const dbResult = await checkDbConnectivity();
    if (dbResult.status === 'critical') {
      return [dbResult, checkDbPoolExhaustion()];
    }

    const dbDependentChecks = [
      checkSourceSilence(),
      checkSourceDisabled(),
      checkSourceHalted(),
      checkLlmFailures(),
      checkMissedPulse(),
      checkMissedDaily(),
      checkCostSpike(),
      checkEntityAliases(),
      checkReadyBacklog(),
    ];

    const settled = await Promise.allSettled(dbDependentChecks);
    const names = [
      'source_silence',
      'source_disabled',
      'source_halted',
      'llm_failures',
      'missed_pulse',
      'missed_daily',
      'cost_spike',
      'entity_aliases',
      'ready_backlog',
    ];

    const results: HealthCheckResult[] = [dbResult, checkDbPoolExhaustion()];
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === 'fulfilled') {
        results.push(s.value);
      } else {
        const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
        results.push({ name: names[i] ?? 'unknown', status: 'critical' as const, message: `Check failed: ${msg}` });
      }
    }

    return results;
  }

  async function check(): Promise<void> {
    const results = await runChecks();
    const dbDown = results.some((r) => r.name === 'db_connectivity' && r.status === 'critical');

    for (const result of results) {
      if (result.status === 'ok') continue;

      if (dbDown) {
        // Can't write to DB, but still alert for critical
        if (result.status === 'critical' && config.alertWebhookUrl) {
          await sendAlertWebhook({
            category: result.name,
            severity: result.status,
            message: result.message ?? `${result.name} check failed`,
            metadata: { checkName: result.name, status: result.status },
          }).catch((err) => log.error({ err }, 'alert webhook failed'));
        }
        continue;
      }

      await insertEvent({
        category: result.name,
        severity: result.status,
        message: result.message ?? `${result.name} check failed`,
        metadata: { checkName: result.name, status: result.status },
      });
    }

    const unhealthy = results.filter((r) => r.status !== 'ok');
    if (unhealthy.length > 0) {
      log.warn({ checks: unhealthy }, 'Health checks found issues');
    } else {
      log.info('All health checks passed');
    }
  }

  async function getStatus(): Promise<{ checks: HealthCheckResult[]; healthy: boolean }> {
    const checks = await runChecks();
    const healthy = checks.every((c) => c.status === 'ok');
    return { checks, healthy };
  }

  return { check, getStatus, recordEvent: insertEvent };
}
