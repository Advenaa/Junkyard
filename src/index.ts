import { Command } from 'commander';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createPool } from './db/connection.js';
import { runMigrations } from './db/migrations.js';

const program = new Command();

program.name('podders').version('2.0.0');

program
  .command('run', { isDefault: true })
  .description('Start the Podders v2 server')
  .action(async () => {
    const config = loadConfig();
    const log = createLogger(config.secrets);
    const pool = createPool(config.databaseUrl);

    await runMigrations(pool);

    log.info('podders v2 started');
    log.info({ port: config.port }, 'server will start here (Step 6)');

    let shuttingDown = false;

    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;

      log.info('shutting down...');

      setTimeout(() => process.exit(1), 30_000).unref();

      // TODO: close Fastify server here when added in Step 6
      await pool.end();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });

program
  .command('migrate')
  .description('Run database migrations and exit')
  .action(async () => {
    const config = loadConfig();
    const pool = createPool(config.databaseUrl);

    await runMigrations(pool);
    await pool.end();
    process.exit(0);
  });

program.parse();
