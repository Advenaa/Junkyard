import { Command } from 'commander';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createPool } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { createServer, startServer } from './server.js';

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

    const app = await createServer(config, pool, log);
    await startServer(app, config.port, log);

    log.info('podders v2 started');

    let shuttingDown = false;

    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;

      log.info('shutting down...');

      setTimeout(() => process.exit(1), 30_000).unref();

      await app.close();
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
