import { Command } from 'commander';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createPool } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { createServer, startServer } from './server.js';
import { createChatHandler } from './chat/handler.js';
import { createLLM } from './llm.js';
import { createEmbedder } from './embed.js';
import { createVectorCache } from './vector-cache.js';
import { createNormalizer } from './normalize/index.js';
import { createPreSummarizer } from './pre-summarize/index.js';
import { createSummarizer } from './process/summarize.js';
import { createCorrelator } from './process/correlate.js';
import { createSynthesizer } from './process/synthesize.js';
import { createPulse } from './process/pulse.js';
import { createNarrativeDetector } from './process/narratives.js';
import { createEmbedPipeline } from './embed-pipeline.js';
import { createEntityManager } from './knowledge/entities.js';
import { createDecayManager } from './knowledge/decay.js';
import { createDelivery } from './deliver/webhook.js';
import { createDiscordAdapter } from './ingest/discord.js';
import { createTwitterAdapter } from './ingest/twitter.js';
import { pollFeed } from './ingest/rss.js';
import { createScheduler } from './scheduler.js';
import { createHealthMonitor } from './health.js';
import { createBackup } from './ops/backup.js';
import { createRetention } from './ops/retention.js';
import { createSeeder } from './knowledge/seed.js';
import { createSentimentTracker } from './knowledge/sentiment.js';
import { createDivergenceTracker } from './knowledge/divergence.js';
import { getSources, resetCrashed, getAppConfig } from './db/queries.js';
import type { RawItem } from './ingest/rss.js';
import type { Pool } from './db/connection.js';
import type { Logger } from './logger.js';

const program = new Command();

program.name('podders').version('2.0.0');

program
  .command('run', { isDefault: true })
  .description('Start the Podders v2 server')
  .action(async () => {
    const config = loadConfig();
    const log = createLogger(config.secrets);
    const pool = createPool(config.databaseUrl);

    try {
      await runMigrations(pool);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.fatal({ err }, `Cannot connect to database or run migrations: ${msg}`);
      log.fatal('Ensure DATABASE_URL is correct and PostgreSQL is running');
      await pool.end().catch(() => {}); // Best-effort cleanup
      process.exit(1);
    }

    // ── 0. Seed entity aliases ───────────────────────────────────────
    const seeder = createSeeder(pool, log);
    try {
      await seeder.seedCoinGecko();
      await seeder.seedIndonesian();
    } catch (err) {
      log.warn({ err }, 'Entity seeding failed, continuing without seeds');
    }

    // ── 1. Shared services ────────────────────────────────────────────
    const llm = createLLM(pool, log, config);
    const embedder = createEmbedder(config, pool, log);
    const vectorCache = createVectorCache(pool, log);

    // ── 2. Pipeline stages ────────────────────────────────────────────
    const normalizer = createNormalizer(pool, log, config, llm);
    const preSummarizer = createPreSummarizer(pool, log, config, llm);
    const entityManager = createEntityManager(pool, log, config, llm);
    const summarizer = createSummarizer(pool, log, config, llm, entityManager);
    const correlator = createCorrelator(pool, log);
    const sentimentTracker = createSentimentTracker(pool, log);
    const divergenceTracker = createDivergenceTracker(pool, log);
    const synthesizer = createSynthesizer(pool, log, config, llm, correlator, sentimentTracker, divergenceTracker);
    const pulse = createPulse(pool, log, config, llm);
    const narrativeDetector = createNarrativeDetector(pool, log, config, llm, embedder);
    const embedPipeline = createEmbedPipeline(pool, log, embedder, vectorCache);
    const decayManager = createDecayManager(pool, log);
    const delivery = createDelivery(pool, log, config);
    const healthMonitor = createHealthMonitor(pool, log, config);
    const backup = createBackup(config, log);
    const retention = createRetention(pool, log);

    // ── 3. Ingest adapters ────────────────────────────────────────────
    const discordAdapter = createDiscordAdapter(config, pool, log, async (item: RawItem) => {
      await normalizer.normalize(item);
    });

    const twitterAdapter = createTwitterAdapter(config, pool, log);

    // ── 4. Scheduler callbacks ────────────────────────────────────────

    async function onSourcePollTick(): Promise<void> {
      const sources = await getSources(pool);
      const now = Date.now();

      // Load source_state for each source to decide if it's time to poll
      // Process sources with limited concurrency (max 5 parallel)
      const POLL_CONCURRENCY = 5;
      for (let i = 0; i < sources.length; i += POLL_CONCURRENCY) {
        const batch = sources.slice(i, i + POLL_CONCURRENCY);
        const pollPromises = batch.map(async (src) => {
          const { rows: stateRows } = await pool.query<{
            last_fetched_at: number | null;
            last_id: string | null;
            status: string;
          }>(
            'SELECT last_fetched_at, last_id, status FROM source_state WHERE source = $1 AND source_id = $2',
            [src.source, src.source_id],
          );

          const state = stateRows[0];

          // Skip disabled or halted sources
          if (state?.status === 'disabled' || state?.status === 'halted') return;

          // Check if enough time has elapsed since last poll
          const lastFetched = state?.last_fetched_at ?? 0;
          const intervalMs = src.poll_interval * 1000;
          if (now - lastFetched < intervalMs) return;

          const lastId = state?.last_id ?? null;

          try {
            let items: RawItem[] = [];
            let newLastId: string | null = lastId;

            if (src.source === 'twitter') {
              const result = await twitterAdapter.poll(src.source_id, lastId);
              items = result.items;
              newLastId = result.lastId ?? lastId;
            } else if (src.source === 'rss') {
              const result = await pollFeed(src.source_id, lastId, log);
              items = result.items;
              newLastId = result.lastId ?? lastId;
            } else if (src.source === 'discord') {
              // Discord is push-based via gateway — no polling needed
              // Just update last_fetched_at to keep health monitor happy
              await updateSourceState(pool, src.source, src.source_id, now, lastId);
              return;
            }

            // Normalize each item
            for (const item of items) {
              await normalizer.normalize(item);
            }

            // Update source state
            await updateSourceState(pool, src.source, src.source_id, now, newLastId);

            if (items.length > 0) {
              log.info(
                { source: src.source, sourceId: src.source_id, count: items.length },
                'ingested and normalized items',
              );
            }
          } catch (err: unknown) {
            log.error(
              { err, source: src.source, sourceId: src.source_id },
              'source poll failed',
            );
            // Increment error count in source_state
            await pool.query(
              `INSERT INTO source_state (source, source_id, error_count, last_error, status)
               VALUES ($2, $3, 1, $1, 'active')
               ON CONFLICT (source, source_id)
               DO UPDATE SET error_count = source_state.error_count + 1, last_error = $1`,
              [
                err instanceof Error ? err.message : String(err),
                src.source,
                src.source_id,
              ],
            );
          }
        });
        await Promise.allSettled(pollPromises);
      }

      // Run pre-summarizer on eligible items
      try {
        await preSummarizer.run();
      } catch (err: unknown) {
        log.error({ err }, 'pre-summarizer failed');
      }

      // Run summarizer batch for each source that has ready items
      const sourcesWithReady = await pool.query<{
        source: string;
        source_id: string;
        min_ts: number;
        max_ts: number;
      }>(
        `SELECT source, source_id, MIN(timestamp) AS min_ts, MAX(timestamp) AS max_ts
         FROM items WHERE status = 'ready'
         GROUP BY source, source_id`,
      );

      for (const row of sourcesWithReady.rows) {
        try {
          const result = await summarizer.runBatch(
            row.source,
            row.source_id,
            row.min_ts,
            row.max_ts,
          );

          if (result.summaryCount > 0) {
            log.info(
              {
                source: row.source,
                sourceId: row.source_id,
                summaries: result.summaryCount,
                hasBreaking: result.hasBreaking,
              },
              'summarizer batch complete',
            );
          }

          // If breaking urgency detected, trigger flash report
          if (result.hasBreaking) {
            const { correlated, shouldFlash } = await correlator.run();
            if (shouldFlash) {
              const flashReport = await synthesizer.runFlash(correlated);
              if (flashReport) {
                await delivery.deliver(flashReport);
              }
            }
          }
        } catch (err: unknown) {
          log.error(
            { err, source: row.source, sourceId: row.source_id },
            'summarizer batch failed',
          );
        }
      }

      // Embed new summaries immediately so chat semantic search stays fresh
      try {
        await embedPipeline.run();
      } catch (err: unknown) {
        log.error({ err }, 'embed pipeline (post-poll) failed');
      }
    }

    async function onPulse(): Promise<void> {
      let reportRow = null;
      try {
        reportRow = await pulse.runPulse();
      } catch (err: unknown) {
        log.error({ err }, 'pulse generation failed');
        return;
      }
      if (reportRow) {
        try {
          await delivery.deliver(reportRow);
        } catch (err: unknown) {
          log.error({ err }, 'pulse delivery failed');
        }
      }
    }

    async function onDaily(): Promise<void> {
      let reportRow = null;
      try { await embedPipeline.run(); } catch (err: unknown) { log.error({ err }, 'embed pipeline failed'); }
      try { await narrativeDetector.detectNarratives(); } catch (err: unknown) { log.error({ err }, 'narrative detection failed'); }
      // Sentiment rollup: compute daily momentum before synthesis uses it
      try {
        const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
        await sentimentTracker.runDaily(todayStr, timezone);
      } catch (err: unknown) { log.error({ err }, 'sentiment rollup failed'); }
      try { reportRow = await synthesizer.runDaily(); } catch (err: unknown) { log.error({ err }, 'daily synthesis failed'); }
      try { await decayManager.runDecay(); } catch (err: unknown) { log.error({ err }, 'decay failed'); }
      // delivery only if report succeeded
      if (reportRow) {
        try {
          await delivery.deliver(reportRow);
        } catch (err: unknown) { log.error({ err }, 'daily delivery failed'); }
      }
      // Run backup after daily synthesis
      try { await backup.run(); } catch (err: unknown) { log.error({ err }, 'backup failed'); }
      // Run retention cleanup
      try { await retention.run(); } catch (err: unknown) { log.error({ err }, 'retention failed'); }
    }

    async function onHealthCheck(): Promise<void> {
      await healthMonitor.check();

      // Daily report catch-up: if 5+ minutes past digest time and no report exists, retry synthesis.
      // The 5-minute buffer avoids racing with onDaily which fires at exactly digest time.
      try {
        const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';
        const digestTime = (await getAppConfig(pool, 'digest_time')) ?? '09:00';
        const [dh, dm] = digestTime.split(':').map(Number);
        const bufferMinutes = 5;
        const totalMinutes = dh * 60 + dm + bufferMinutes;
        const catchUpHours = Math.floor(totalMinutes / 60) % 24;
        const catchUpTime = `${String(catchUpHours).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
        const nowLocal = new Date().toLocaleString('en-US', { timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit' });
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
        if (nowLocal >= catchUpTime) {
          const { rows } = await pool.query<{ exists: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM reports WHERE date = $1 AND type = 'daily') AS exists`,
            [todayStr],
          );
          if (!rows[0]?.exists) {
            log.info({ date: todayStr }, 'Daily report missing after digest time, attempting catch-up');
            const reportRow = await synthesizer.runDaily();
            if (reportRow) await delivery.deliver(reportRow);
          }
        }
      } catch (err: unknown) {
        log.error({ err }, 'Daily catch-up check failed');
      }
    }

    // ── 5. Create and start scheduler ─────────────────────────────────
    const scheduler = createScheduler({
      pool,
      log,
      config,
      onSourcePollTick,
      onPulse,
      onDaily,
      onHealthCheck,
      onCrashRecovery: async () => resetCrashed(pool),
    });

    // ── 6. Start server ───────────────────────────────────────────────
    const chatHandler = createChatHandler(pool, log, config, llm, vectorCache, embedder);
    const app = await createServer(config, pool, log, healthMonitor, chatHandler);
    await startServer(app, config.port, log);

    // ── 7. Start background services ──────────────────────────────────
    await vectorCache.load();
    await scheduler.start();
    await discordAdapter.connect();

    log.info('podders v2 started');

    // ── 8. Graceful shutdown ──────────────────────────────────────────
    let shuttingDown = false;

    const shutdown = async (reason?: string) => {
      if (shuttingDown) return;
      shuttingDown = true;

      log.info({ reason }, 'shutting down...');

      setTimeout(() => process.exit(1), 30_000).unref();

      try {
        await scheduler.stop();
      } catch (err: unknown) {
        log.error({ err }, 'error stopping scheduler');
      }

      try {
        await discordAdapter.disconnect();
      } catch (err: unknown) {
        log.error({ err }, 'error disconnecting discord');
      }

      try {
        await app.close();
      } catch (err: unknown) {
        log.error({ err }, 'error closing server');
      }

      try {
        await pool.end();
      } catch (err: unknown) {
        log.error({ err }, 'error closing database pool');
      }

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (err: unknown) => {
      log.fatal({ err }, 'uncaught exception — triggering graceful shutdown');
      shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (err: unknown) => {
      log.fatal({ err }, 'unhandled rejection — triggering graceful shutdown');
      shutdown('unhandledRejection');
    });
  });

program
  .command('migrate')
  .description('Run database migrations and exit')
  .action(async () => {
    const config = loadConfig();
    const log = createLogger(config.secrets);
    const pool = createPool(config.databaseUrl);
    try {
      await runMigrations(pool);
      log.info('migrations complete');
    } catch (err) {
      log.fatal({ err }, 'migration failed');
      process.exit(1);
    } finally {
      await pool.end();
    }
    process.exit(0);
  });

program.parse();

// ── Helpers ─────────────────────────────────────────────────────────────

async function updateSourceState(
  pool: Pool,
  source: string,
  sourceId: string,
  lastFetchedAt: number,
  lastId: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO source_state (source, source_id, last_fetched_at, last_id, error_count)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT (source, source_id)
     DO UPDATE SET last_fetched_at = $3, last_id = COALESCE($4, source_state.last_id), error_count = 0`,
    [source, sourceId, lastFetchedAt, lastId],
  );
}
