import { readFileSync } from 'node:fs';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler, type SchedulerDeps } from '../../src/scheduler.js';

// ── Helpers ────────────────────────────────────────────────────────────

let warnings: { key?: string; msg?: string }[] = [];
let errors: { key?: string }[] = [];

const silentLog = {
  info: () => {},
  warn: (...args: unknown[]) => {
    const obj = typeof args[0] === 'object' ? (args[0] as Record<string, unknown>) : {};
    warnings.push({ key: obj.key as string | undefined, msg: args[1] as string | undefined });
  },
  error: (...args: unknown[]) => {
    const obj = typeof args[0] === 'object' ? (args[0] as Record<string, unknown>) : {};
    errors.push({ key: obj.key as string | undefined });
  },
  debug: () => {},
  child: () => silentLog,
} as never;

/** Mock pool: responds to getAppConfig queries via configMap */
function createMockPool(configMap: Record<string, string | null> = {}) {
  return {
    query: async (_text: string, params?: unknown[]) => {
      if (_text.includes('app_config') && params?.[0]) {
        const val = configMap[params[0] as string] ?? null;
        return { rows: val != null ? [{ value: val }] : [] };
      }
      return { rows: [], rowCount: 0 };
    },
    totalCount: 1,
    idleCount: 1,
  } as never;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseDeps(overrides: Partial<SchedulerDeps> = {}): SchedulerDeps {
  return {
    pool: createMockPool(),
    log: silentLog,
    config: {} as never,
    onSourcePollTick: async () => {},
    onPulse: async () => {},
    onDaily: async () => {},
    onHealthCheck: async () => {},
    onCrashRecovery: async () => 0,
    ...overrides,
  };
}

/** Capturing log that records registered cron jobs */
function capturingLog() {
  const registered: { job: string; cron: string }[] = [];
  const warnMessages: string[] = [];
  const log = {
    info: (...args: unknown[]) => {
      const obj = typeof args[0] === 'object' ? (args[0] as Record<string, unknown>) : {};
      if (obj.job && obj.cron) {
        registered.push({ job: obj.job as string, cron: obj.cron as string });
      }
    },
    warn: (...args: unknown[]) => {
      if (typeof args[1] === 'string') warnMessages.push(args[1]);
    },
    error: () => {},
    debug: () => {},
    child: function () {
      return this;
    },
  } as never;
  return { log, registered, warnMessages };
}

// ── withMutex ──────────────────────────────────────────────────────────

describe('withMutex', () => {
  beforeEach(() => {
    warnings = [];
    errors = [];
  });

  it('prevents overlap — second concurrent call is skipped', async () => {
    const deps = baseDeps();
    const { withMutex } = createScheduler(deps);

    const calls: string[] = [];

    const slowJob = async () => {
      calls.push('start');
      await sleep(80);
      calls.push('end');
    };

    // Fire two calls concurrently on the same key
    const p1 = withMutex('test-job', slowJob);
    const p2 = withMutex('test-job', slowJob);
    await Promise.all([p1, p2]);

    // Only the first should have run
    assert.deepEqual(calls, ['start', 'end']);
    assert.ok(
      warnings.some((w) => w.key === 'test-job'),
      'should log overlap warning for skipped call',
    );
  });

  it('releases mutex after completion — sequential calls both run', async () => {
    const deps = baseDeps();
    const { withMutex } = createScheduler(deps);

    let callCount = 0;
    const job = async () => {
      callCount++;
    };

    await withMutex('seq-job', job);
    await withMutex('seq-job', job);

    assert.equal(callCount, 2, 'both sequential calls should execute');
    assert.equal(warnings.length, 0, 'no overlap warnings');
  });

  it('releases mutex on error — next call succeeds', async () => {
    const deps = baseDeps();
    const { withMutex } = createScheduler(deps);

    let secondRan = false;

    const failingJob = async () => {
      throw new Error('boom');
    };
    const succeedingJob = async () => {
      secondRan = true;
    };

    // First call throws internally (caught by withMutex)
    await withMutex('err-job', failingJob);

    // Mutex should be released, so the next call runs
    await withMutex('err-job', succeedingJob);

    assert.ok(secondRan, 'job after error should execute');
    assert.ok(
      errors.some((e) => e.key === 'err-job'),
      'should log error for failed job',
    );
  });

  it('different keys do not interfere', async () => {
    const deps = baseDeps();
    const { withMutex } = createScheduler(deps);

    const order: string[] = [];

    const jobA = async () => {
      order.push('A-start');
      await sleep(50);
      order.push('A-end');
    };
    const jobB = async () => {
      order.push('B-start');
      await sleep(50);
      order.push('B-end');
    };

    // Concurrent calls on different keys should both run
    await Promise.all([withMutex('key-a', jobA), withMutex('key-b', jobB)]);

    assert.ok(order.includes('A-start'), 'job A should start');
    assert.ok(order.includes('A-end'), 'job A should finish');
    assert.ok(order.includes('B-start'), 'job B should start');
    assert.ok(order.includes('B-end'), 'job B should finish');
    assert.equal(warnings.length, 0, 'no overlap on different keys');
  });

  it('skips execution when shutting down', async () => {
    const deps = baseDeps();
    const scheduler = createScheduler(deps);

    let ran = false;
    const job = async () => {
      ran = true;
    };

    // Trigger shutdown state
    await scheduler.stop();

    // withMutex should bail early because shuttingDown is true
    await scheduler.withMutex('post-stop', job);

    assert.ok(!ran, 'job should not run after stop()');
  });
});

// ── buildDailyCron (observed via log on start) ─────────────────────────

describe('buildDailyCron', () => {
  it('defaults to "0 9 * * *" when no digest_time configured', async () => {
    const { log, registered } = capturingLog();
    const deps = baseDeps({ pool: createMockPool({}), log });
    const scheduler = createScheduler(deps);
    await scheduler.start();

    const daily = registered.find((r) => r.job === 'daily-synthesis');
    assert.ok(daily, 'daily-synthesis job should be registered');
    assert.equal(daily.cron, '0 9 * * *');

    await scheduler.stop();
  });

  it('parses "14:30" into "30 14 * * *"', async () => {
    const { log, registered } = capturingLog();
    const deps = baseDeps({ pool: createMockPool({ digest_time: '14:30' }), log });
    const scheduler = createScheduler(deps);
    await scheduler.start();

    const daily = registered.find((r) => r.job === 'daily-synthesis');
    assert.ok(daily);
    assert.equal(daily.cron, '30 14 * * *');

    await scheduler.stop();
  });

  it('parses "6:00" (single-digit hour) into "00 6 * * *"', async () => {
    const { log, registered } = capturingLog();
    const deps = baseDeps({ pool: createMockPool({ digest_time: '6:00' }), log });
    const scheduler = createScheduler(deps);
    await scheduler.start();

    const daily = registered.find((r) => r.job === 'daily-synthesis');
    assert.ok(daily);
    assert.equal(daily.cron, '00 6 * * *');

    await scheduler.stop();
  });

  it('parses "0:00" (midnight) into "00 0 * * *"', async () => {
    const { log, registered } = capturingLog();
    const deps = baseDeps({ pool: createMockPool({ digest_time: '0:00' }), log });
    const scheduler = createScheduler(deps);
    await scheduler.start();

    const daily = registered.find((r) => r.job === 'daily-synthesis');
    assert.ok(daily);
    assert.equal(daily.cron, '00 0 * * *');

    await scheduler.stop();
  });

  it('parses "23:59" into "59 23 * * *"', async () => {
    const { log, registered } = capturingLog();
    const deps = baseDeps({ pool: createMockPool({ digest_time: '23:59' }), log });
    const scheduler = createScheduler(deps);
    await scheduler.start();

    const daily = registered.find((r) => r.job === 'daily-synthesis');
    assert.ok(daily);
    assert.equal(daily.cron, '59 23 * * *');

    await scheduler.stop();
  });

  it('falls back to default for invalid digest_time format', async () => {
    const { log, registered, warnMessages } = capturingLog();
    const deps = baseDeps({ pool: createMockPool({ digest_time: 'not-a-time' }), log });
    const scheduler = createScheduler(deps);
    await scheduler.start();

    const daily = registered.find((r) => r.job === 'daily-synthesis');
    assert.ok(daily);
    assert.equal(daily.cron, '0 9 * * *', 'should fall back to default');
    assert.ok(
      warnMessages.some((m) => m.includes('invalid digest_time')),
      'should log warning about invalid format',
    );

    await scheduler.stop();
  });

  it('uses custom timezone without error', async () => {
    const { log, registered } = capturingLog();
    const deps = baseDeps({
      pool: createMockPool({ digest_time: '09:00', timezone: 'America/New_York' }),
      log,
    });
    const scheduler = createScheduler(deps);
    await scheduler.start();

    const daily = registered.find((r) => r.job === 'daily-synthesis');
    assert.ok(daily);
    assert.equal(daily.cron, '00 09 * * *');

    await scheduler.stop();
  });
});

// ── Graceful shutdown ──────────────────────────────────────────────────

describe('graceful shutdown', () => {
  it('stop() resolves promptly when no jobs are in-flight', async () => {
    const deps = baseDeps({ pool: createMockPool({ digest_time: '09:00' }) });
    const scheduler = createScheduler(deps);
    await scheduler.start();

    const before = Date.now();
    await scheduler.stop();
    const elapsed = Date.now() - before;

    assert.ok(elapsed < 2000, `stop() took ${elapsed}ms, expected < 2000ms`);
  });

  it('stop() resolves even without prior start()', async () => {
    const scheduler = createScheduler(baseDeps());
    await scheduler.stop();
  });

  it('stop() drains in-flight jobs before resolving', async () => {
    const deps = baseDeps();
    const scheduler = createScheduler(deps);

    let jobFinished = false;

    // Start a slow job via withMutex
    const slowPromise = scheduler.withMutex('drain-test', async () => {
      await sleep(200);
      jobFinished = true;
    });

    // Give the job a moment to acquire the mutex
    await sleep(10);

    // stop() should wait for the in-flight job
    const stopPromise = scheduler.stop();
    await Promise.all([slowPromise, stopPromise]);

    assert.ok(jobFinished, 'in-flight job should complete before stop resolves');
  });
});

// ── SD-005 regression: onDaily pipeline ordering ──────────────────────

describe('SD-005: onDaily runs embed + narratives before synthesis', () => {
  it('embedPipeline.run() and narrativeDetector.detectNarratives() precede synthesizer.runDaily() in source', () => {
    const source = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf-8');

    // Extract the onDaily function body
    const onDailyStart = source.indexOf('async function onDaily()');
    assert.ok(onDailyStart !== -1, 'onDaily function must exist in src/index.ts');

    // Grab a generous slice starting from onDaily (the function may be 30+ lines with advisory lock)
    const onDailySlice = source.slice(onDailyStart, onDailyStart + 1500);

    const embedPos = onDailySlice.indexOf('embedPipeline.run()');
    const narrativePos = onDailySlice.indexOf('narrativeDetector.detectNarratives()');
    const synthPos = onDailySlice.indexOf('synthesizer.runDaily()');

    assert.ok(embedPos !== -1, 'embedPipeline.run() must be called in onDaily');
    assert.ok(narrativePos !== -1, 'narrativeDetector.detectNarratives() must be called in onDaily');
    assert.ok(synthPos !== -1, 'synthesizer.runDaily() must be called in onDaily');

    assert.ok(
      embedPos < synthPos,
      `embedPipeline.run() (pos ${embedPos}) must come before synthesizer.runDaily() (pos ${synthPos})`,
    );
    assert.ok(
      narrativePos < synthPos,
      `narrativeDetector.detectNarratives() (pos ${narrativePos}) must come before synthesizer.runDaily() (pos ${synthPos})`,
    );
  });
});

// ── Cron registration ──────────────────────────────────────────────────

describe('cron registration', () => {
  it('registers all four expected jobs on start()', async () => {
    const { log, registered } = capturingLog();
    const deps = baseDeps({ pool: createMockPool({ digest_time: '09:00' }), log });
    const scheduler = createScheduler(deps);
    await scheduler.start();

    const jobNames = registered.map((r) => r.job).sort();
    assert.deepEqual(jobNames, ['daily-synthesis', 'health-monitor', 'market-pulse', 'source-poll-tick']);

    await scheduler.stop();
  });

  it('calls onCrashRecovery on start', async () => {
    let recovered = -1;
    const deps = baseDeps({
      pool: createMockPool({ digest_time: '09:00' }),
      onCrashRecovery: async () => {
        recovered = 42;
        return 42;
      },
    });
    const scheduler = createScheduler(deps);
    await scheduler.start();

    assert.equal(recovered, 42);
    await scheduler.stop();
  });
});
