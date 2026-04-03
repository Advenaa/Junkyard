import cron from 'node-cron';
import type { Pool } from './db/connection.js';
import type { Logger } from './logger.js';
import type { Config } from './config.js';
import { getAppConfig } from './db/queries.js';

export interface SchedulerDeps {
  pool: Pool;
  log: Logger;
  config: Config;
  onSourcePollTick: () => Promise<void>;
  onPulse: () => Promise<void>;
  onDaily: () => Promise<void>;
  onHealthCheck: () => Promise<void>;
  onCrashRecovery: () => Promise<number>;
}

export function createScheduler(deps: SchedulerDeps) {
  const { pool, log } = deps;
  const tasks: cron.ScheduledTask[] = [];
  const mutexes: Record<string, boolean> = {};
  let shuttingDown = false;

  async function withMutex(key: string, fn: () => Promise<void>): Promise<void> {
    if (mutexes[key]) {
      log.warn({ key }, 'job overlap — skipping');
      return;
    }
    if (shuttingDown) return;
    mutexes[key] = true;
    try {
      await fn();
    } catch (err) {
      log.error({ err, key }, 'job failed');
    } finally {
      mutexes[key] = false;
    }
  }

  function register(name: string, expression: string, handler: () => Promise<void>, options?: { scheduled?: boolean; timezone?: string }): void {
    const task = cron.schedule(expression, () => {
      void withMutex(name, handler);
    }, options);
    tasks.push(task);
    log.info({ job: name, cron: expression }, 'registered cron job');
  }

  async function buildDailyCron(): Promise<{ expression: string; timezone: string }> {
    const digestTime = await getAppConfig(pool, 'digest_time');
    const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';

    let expression = '0 9 * * *';
    if (digestTime) {
      const match = digestTime.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        const minute = match[2];
        const hour = match[1];
        expression = `${minute} ${hour} * * *`;
      } else {
        log.warn({ digestTime }, 'invalid digest_time format, using default 09:00');
      }
    }

    return { expression, timezone };
  }

  async function start(): Promise<void> {
    const recovered = await deps.onCrashRecovery();
    log.info({ recovered }, 'crash recovery complete');

    const { expression, timezone } = await buildDailyCron();

    register('source-poll-tick', '* * * * *', deps.onSourcePollTick);
    register('market-pulse', '0 */3 * * *', deps.onPulse, { scheduled: true, timezone });
    register('health-monitor', '*/5 * * * *', deps.onHealthCheck, { scheduled: true, timezone });
    register('daily-synthesis', expression, deps.onDaily, {
      scheduled: true,
      timezone,
    });

    log.info('scheduler started');
  }

  async function stop(): Promise<void> {
    shuttingDown = true;
    for (const task of tasks) {
      task.stop();
    }
    log.info('cron tasks stopped, waiting for in-flight jobs…');

    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const anyRunning = Object.values(mutexes).some(Boolean);
      if (!anyRunning) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }

    const stillRunning = Object.entries(mutexes)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (stillRunning.length > 0) {
      log.warn({ jobs: stillRunning }, 'shutdown timeout — jobs still running');
    }

    log.info('scheduler stopped');
  }

  return { start, stop, /** @internal — exposed for unit tests */ withMutex };
}
