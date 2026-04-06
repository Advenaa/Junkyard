import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const integrationDir = resolve(process.cwd(), 'test/integration');

async function collectIntegrationTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return collectIntegrationTests(entryPath);
      }

      return entry.isFile() && entry.name.endsWith('.test.ts') ? [entryPath] : [];
    }),
  );

  return nested.flat().sort();
}

const testFiles = await collectIntegrationTests(integrationDir);

if (testFiles.length === 0) {
  console.log('No integration tests found in test/integration; skipping.');
  process.exit(0);
}

const child = spawn(process.execPath, ['--import', 'tsx/esm', '--test', ...testFiles], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
