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

export interface SchedulerJobDiagnostics {
  job: string;
  cron: string;
  timezone: string | null;
  status: string;
  nextRun: string | null;
}

export interface SchedulerDiagnostics {
  processTimezone: string | null;
  jobs: SchedulerJobDiagnostics[];
}

type ScheduledTaskWithDiagnostics = cron.ScheduledTask & {
  getNextRun?: () => Date | null;
  getStatus?: () => string;
};

export function createScheduler(deps: SchedulerDeps) {
  const { pool, log } = deps;
  const tasks: cron.ScheduledTask[] = [];
  const registeredJobs = new Map<
    string,
    {
      expression: string;
      timezone: string | null;
      task: ScheduledTaskWithDiagnostics;
    }
  >();
  const mutexes: Record<string, boolean> = {};
  let shuttingDown = false;
  let dailyTask: cron.ScheduledTask | null = null;

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

  function register(
    name: string,
    expression: string,
    handler: () => Promise<void>,
    options?: { scheduled?: boolean; timezone?: string },
  ): void {
    const task = cron.schedule(
      expression,
      () => {
        void withMutex(name, handler);
      },
      options,
    ) as ScheduledTaskWithDiagnostics;
    tasks.push(task);
    registeredJobs.set(name, { expression, timezone: options?.timezone ?? null, task });
    log.info(
      { job: name, cron: expression, timezone: options?.timezone, nextRun: getTaskNextRun(task) },
      'registered cron job',
    );
  }

  function normalizeSchedulerTimezone(timezone: string | null | undefined): string {
    const candidate = timezone?.trim() ? timezone.trim() : 'Asia/Jakarta';
    try {
      Intl.DateTimeFormat(undefined, { timeZone: candidate });
      return candidate;
    } catch {
      log.warn({ timezone: candidate }, 'invalid scheduler timezone, using Asia/Jakarta');
      return 'Asia/Jakarta';
    }
  }

  async function getSchedulerTimezone(): Promise<string> {
    return normalizeSchedulerTimezone((await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta');
  }

  function ensureUtcProcessTimezone(): void {
    const currentTimezone = process.env.TZ;
    if (currentTimezone === 'UTC') return;
    process.env.TZ = 'UTC';
    if (currentTimezone && currentTimezone.length > 0) {
      log.warn(
        { previousTimezone: currentTimezone, processTimezone: 'UTC' },
        'timezone-aware cron jobs require UTC host timezone; forcing process.env.TZ to UTC',
      );
      return;
    }
    log.info({ processTimezone: 'UTC' }, 'timezone-aware cron jobs defaulted process.env.TZ to UTC');
  }

  function getTaskNextRun(task: ScheduledTaskWithDiagnostics): string | null {
    const nextRun = typeof task.getNextRun === 'function' ? task.getNextRun() : null;
    if (!(nextRun instanceof Date) || Number.isNaN(nextRun.getTime())) {
      return null;
    }
    return nextRun.toISOString();
  }

  function getTaskStatus(task: ScheduledTaskWithDiagnostics): string {
    const status = typeof task.getStatus === 'function' ? task.getStatus() : 'unknown';
    return typeof status === 'string' && status.length > 0 ? status : 'unknown';
  }

  async function buildDailyCron(): Promise<{ expression: string; timezone: string }> {
    const digestTime = await getAppConfig(pool, 'digest_time');
    const timezone = await getSchedulerTimezone();

    let expression = '0 9 * * *';
    if (digestTime) {
      const match = digestTime.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
          expression = `${match[2]} ${match[1]} * * *`;
        } else {
          log.warn({ digestTime }, 'digest_time out of range, using default 09:00');
        }
      } else {
        log.warn({ digestTime }, 'invalid digest_time format, using default 09:00');
      }
    }

    return { expression, timezone };
  }

  async function refreshDailyCron(): Promise<void> {
    if (shuttingDown) return;
    const { expression, timezone } = await buildDailyCron();
    const previousDailyTask = dailyTask;
    ensureUtcProcessTimezone();

    let nextDailyTask: ScheduledTaskWithDiagnostics;
    try {
      nextDailyTask = cron.schedule(
        expression,
        () => {
          void withMutex('daily-synthesis', deps.onDaily);
        },
        { timezone },
      ) as ScheduledTaskWithDiagnostics;
    } catch (err) {
      log.error({ err, cron: expression, timezone }, 'failed to rebuild daily cron');
      if (previousDailyTask) {
        return;
      }
      throw err;
    }

    // Only stop the old task once the replacement has been created successfully.
    if (previousDailyTask) {
      previousDailyTask.stop();
      const idx = tasks.indexOf(previousDailyTask);
      if (idx !== -1) tasks.splice(idx, 1);
    }
    dailyTask = nextDailyTask;
    tasks.push(nextDailyTask);
    registeredJobs.set('daily-synthesis', { expression, timezone, task: nextDailyTask });
    log.info(
      { job: 'daily-synthesis', cron: expression, timezone, nextRun: getTaskNextRun(nextDailyTask) },
      'daily cron rebuilt',
    );
  }

  async function start(): Promise<void> {
    const recovered = await deps.onCrashRecovery();
    log.info({ recovered }, 'crash recovery complete');
    const timezone = await getSchedulerTimezone();
    ensureUtcProcessTimezone();

    register('source-poll-tick', '* * * * *', deps.onSourcePollTick);
    register('market-pulse', '0 */3 * * *', deps.onPulse, {
      scheduled: true,
      timezone,
    });
    register('health-monitor', '*/5 * * * *', deps.onHealthCheck, {
      scheduled: true,
      timezone,
    });
    await refreshDailyCron();

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

  function getDiagnostics(): SchedulerDiagnostics {
    return {
      processTimezone: process.env.TZ ?? null,
      jobs: Array.from(registeredJobs.entries()).map(([job, meta]) => ({
        job,
        cron: meta.expression,
        timezone: meta.timezone,
        status: getTaskStatus(meta.task),
        nextRun: getTaskNextRun(meta.task),
      })),
    };
  }

  return { start, stop, refreshDailyCron, getDiagnostics, /** @internal — exposed for unit tests */ withMutex };
}
