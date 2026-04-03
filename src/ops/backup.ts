import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, unlink, stat } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { join } from 'node:path';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';

function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function parseDateFromFilename(filename: string): Date | null {
  const match = /^podders_(\d{4})(\d{2})(\d{2})\.sql\.gz$/.exec(filename);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

export function createBackup(config: Config, log: Logger) {
  async function run(): Promise<boolean> {
    try {
      await mkdir(config.dataDir, { recursive: true });

      const dateStr = formatDate(new Date());
      const filename = `podders_${dateStr}.sql.gz`;
      const filePath = join(config.dataDir, filename);

      await new Promise<void>((resolve, reject) => {
        // Parse connection string so credentials never appear as CLI args
        const dbUrl = new URL(config.databaseUrl);
        const pgEnv: Record<string, string> = { ...process.env } as Record<string, string>;
        if (dbUrl.password) {
          pgEnv['PGPASSWORD'] = decodeURIComponent(dbUrl.password);
        }

        const pgArgs = [
          '--host', dbUrl.hostname,
          '--port', dbUrl.port || '5432',
          '--username', decodeURIComponent(dbUrl.username),
          '--dbname', dbUrl.pathname.slice(1),
          '--no-password',
        ];

        const pgDump = spawn('pg_dump', pgArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: pgEnv,
        });

        // Kill pg_dump if it hangs for more than 5 minutes
        const killTimeout = setTimeout(() => {
          pgDump.kill('SIGTERM');
          reject(new Error('pg_dump timed out after 5 minutes'));
        }, 300_000);

        const gzip = createGzip();
        const output = createWriteStream(filePath);

        let stderr = '';
        pgDump.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        pgDump.stdout.pipe(gzip).pipe(output);

        output.on('finish', () => {
          clearTimeout(killTimeout);
          if (pgDump.exitCode !== 0) {
            reject(new Error(`pg_dump exited with code ${String(pgDump.exitCode)}: ${stderr}`));
            return;
          }
          resolve();
        });

        output.on('error', (err) => { clearTimeout(killTimeout); reject(err); });
        pgDump.on('error', (err) => { clearTimeout(killTimeout); reject(err); });
        gzip.on('error', (err) => { clearTimeout(killTimeout); reject(err); });
      });

      const fileInfo = await stat(filePath);
      log.info(
        { filePath, sizeBytes: fileInfo.size },
        'backup: completed successfully',
      );

      // Delete backups older than 7 days
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const files = await readdir(config.dataDir);

      for (const file of files) {
        const fileDate = parseDateFromFilename(file);
        if (fileDate && fileDate.getTime() < sevenDaysAgo) {
          const oldPath = join(config.dataDir, file);
          await unlink(oldPath);
          log.info({ file: oldPath }, 'backup: deleted old backup');
        }
      }

      return true;
    } catch (err: unknown) {
      log.error({ err }, 'backup: failed');
      return false;
    }
  }

  return { run };
}
