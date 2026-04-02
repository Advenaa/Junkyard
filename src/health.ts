import type { Pool } from './db/connection.js';
import type { Logger } from './logger.js';
import type { Config } from './config.js';
import { ulid } from 'ulid';

export interface HealthCheckResult {
  name: string;
  status: 'ok' | 'warn' | 'critical';
  message?: string;
}

interface HealthEvent {
  category: string;
  severity: 'warn' | 'critical';
  message: string;
  metadata: Record<string, unknown>;
}

interface HealthMonitor {
  check(): Promise<void>;
  getStatus(): Promise<{ checks: HealthCheckResult[]; healthy: boolean }>;
}

export function createHealthMonitor(
  pool: Pool,
  log: Logger,
  config: Config,
): HealthMonitor {
  async function checkSourceSilence(): Promise<HealthCheckResult> {
    const { rows } = await pool.query<{
      label: string | null;
      poll_interval: number;
      last_fetched_at: number | null;
    }>(`
      SELECT s.label, s.poll_interval, ss.last_fetched_at
      FROM sources s
      JOIN source_state ss ON ss.source = s.source AND ss.source_id = s.source_id
      WHERE ss.status = 'active'
    `);

    const now = Date.now();
    const silent: string[] = [];

    for (const row of rows) {
      if (!row.last_fetched_at) {
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

  async function checkLlmFailures(): Promise<HealthCheckResult> {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    const { rows: usageRows } = await pool.query<{ count: string }>(`
      SELECT COUNT(*) AS count
      FROM llm_usage
      WHERE created_at > $1
    `, [oneHourAgo]);

    const recentUsage = parseInt(usageRows[0].count, 10);

    if (recentUsage === 0) {
      const { rows: readyRows } = await pool.query<{ count: string }>(`
        SELECT COUNT(*) AS count
        FROM items
        WHERE status = 'ready'
          AND created_at < $1
      `, [oneHourAgo]);

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

    const { rows } = await pool.query<{ count: string }>(`
      SELECT COUNT(*) AS count
      FROM reports
      WHERE type = 'pulse'
        AND created_at > $1
    `, [fourHoursAgo]);

    if (parseInt(rows[0].count, 10) === 0) {
      return {
        name: 'missed_pulse',
        status: 'warn',
        message: 'No pulse report in last 4 hours',
      };
    }
    return { name: 'missed_pulse', status: 'ok' };
  }

  async function checkMissedDaily(): Promise<HealthCheckResult> {
    const twentySixHoursAgo = Date.now() - 26 * 60 * 60 * 1000;

    const { rows } = await pool.query<{ count: string }>(`
      SELECT COUNT(*) AS count
      FROM reports
      WHERE type = 'daily'
        AND created_at > $1
    `, [twentySixHoursAgo]);

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

    if (idle === 0 && total >= 10) {
      return {
        name: 'db_pool_exhaustion',
        status: 'warn',
        message: `Pool exhausted: ${total} total, ${idle} idle`,
      };
    }
    return { name: 'db_pool_exhaustion', status: 'ok' };
  }

  async function checkCostSpike(): Promise<HealthCheckResult> {
    const now = Date.now();
    const todayStart = now - (now % (24 * 60 * 60 * 1000));
    const sevenDaysAgo = todayStart - 7 * 24 * 60 * 60 * 1000;

    const { rows } = await pool.query<{
      today_cost: string | null;
      avg_cost: string | null;
    }>(`
      SELECT
        (SELECT COALESCE(SUM(cost_usd), 0) FROM llm_usage
         WHERE created_at >= $1) AS today_cost,
        (SELECT COALESCE(SUM(cost_usd), 0) / NULLIF(
          COUNT(DISTINCT (created_at / 86400000)), 0
        ) FROM llm_usage
         WHERE created_at >= $2
           AND created_at < $1) AS avg_cost
    `, [todayStart, sevenDaysAgo]);

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

  async function isDuplicate(category: string, message: string): Promise<boolean> {
    const { rows } = await pool.query<{ count: string }>(`
      SELECT COUNT(*) AS count
      FROM health_events
      WHERE category = $1
        AND message = $2
        AND acknowledged = false
        AND created_at > $3
    `, [category, message, Date.now() - 30 * 60 * 1000]);

    return parseInt(rows[0].count, 10) > 0;
  }

  async function insertEvent(event: HealthEvent): Promise<void> {
    if (await isDuplicate(event.category, event.message)) {
      log.debug({ category: event.category }, 'Skipping duplicate health event');
      return;
    }

    const id = ulid();
    const now = Date.now();

    await pool.query(
      `INSERT INTO health_events (id, category, severity, message, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, event.category, event.severity, event.message, JSON.stringify(event.metadata), now],
    );

    if (event.severity === 'critical' && config.alertWebhookUrl) {
      await sendAlertWebhook(event);
    }
  }

  async function sendAlertWebhook(event: HealthEvent): Promise<void> {
    if (!config.alertWebhookUrl) return;

    const body = {
      embeds: [
        {
          title: `Health Alert: ${event.category}`,
          description: event.message,
          color: 0xFF0000,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    try {
      await fetch(config.alertWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ err: errMsg }, 'Failed to send health alert webhook');
    }
  }

  async function runChecks(): Promise<HealthCheckResult[]> {
    const results = await Promise.all([
      checkSourceSilence(),
      checkSourceDisabled(),
      checkLlmFailures(),
      checkMissedPulse(),
      checkMissedDaily(),
      Promise.resolve(checkDbPoolExhaustion()),
      checkCostSpike(),
    ]);

    return results;
  }

  async function check(): Promise<void> {
    const results = await runChecks();

    for (const result of results) {
      if (result.status === 'ok') continue;

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

  return { check, getStatus };
}
