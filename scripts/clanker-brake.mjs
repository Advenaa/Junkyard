#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { access, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REMOTE_BRAKE_NAME = 'CLANKERISM_PAUSED';
const LOCAL_BRAKE_URL = new URL('../.clankerism/PAUSED', import.meta.url);

async function main() {
  const [command = 'status', ...argv] = process.argv.slice(2);
  const options = parseArgs(argv);
  const repo = options.repo ?? (await detectRepo());

  if (command === 'status') {
    const state = await getBrakeState(repo);
    printBrakeState(state);

    if (state.paused && options.exitCodeIfPaused) {
      process.exitCode = 2;
    }

    return;
  }

  if (command === 'pause') {
    const reason = options.reason ?? 'manual brake';

    if (options.scope === 'local' || options.scope === 'both') {
      await writeFile(LOCAL_BRAKE_URL, `${reason}\n`, 'utf8');
      console.log('Local brake engaged.');
    }

    if (options.scope === 'remote' || options.scope === 'both') {
      await runGh(['variable', 'set', REMOTE_BRAKE_NAME, '--repo', repo, '--body', reason]);
      console.log(`Remote brake engaged for ${repo}.`);
    }

    return;
  }

  if (command === 'resume') {
    if (options.scope === 'local' || options.scope === 'both') {
      await rm(LOCAL_BRAKE_URL, { force: true });
      console.log('Local brake cleared.');
    }

    if (options.scope === 'remote' || options.scope === 'both') {
      try {
        await runGh(['variable', 'delete', REMOTE_BRAKE_NAME, '--repo', repo]);
        console.log(`Remote brake cleared for ${repo}.`);
      } catch (error) {
        const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : '';

        if (/not found/i.test(stderr)) {
          console.log('Remote brake was already clear.');
          return;
        }

        throw error;
      }
    }

    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(argv) {
  const options = {
    exitCodeIfPaused: false,
    reason: null,
    repo: null,
    scope: 'both'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--exit-code-if-paused') {
      options.exitCodeIfPaused = true;
      continue;
    }

    if (arg === '--reason') {
      options.reason = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--repo') {
      options.repo = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--scope') {
      const scope = argv[index + 1] ?? 'both';

      if (!['local', 'remote', 'both'].includes(scope)) {
        throw new Error(`Unknown scope: ${scope}`);
      }

      options.scope = scope;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function getBrakeState(repo) {
  const local = await hasLocalBrake();
  const remote = await getRemoteBrake(repo);

  return {
    paused: local.paused || remote.paused,
    local,
    remote
  };
}

async function hasLocalBrake() {
  try {
    await access(LOCAL_BRAKE_URL, constants.F_OK);
    return { paused: true, reason: 'local pause file present' };
  } catch {
    return { paused: false, reason: null };
  }
}

async function getRemoteBrake(repo) {
  try {
    const { stdout } = await runGh([
      'variable',
      'get',
      REMOTE_BRAKE_NAME,
      '--repo',
      repo,
      '--json',
      'value',
      '--jq',
      '.value'
    ]);

    return {
      paused: true,
      reason: stdout.trim() || 'remote brake set'
    };
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : '';

    if (/not found/i.test(stderr)) {
      return { paused: false, reason: null };
    }

    throw error;
  }
}

function printBrakeState(state) {
  if (!state.paused) {
    console.log('Clankerism brake is clear.');
    return;
  }

  console.log('Clankerism brake is engaged.');

  if (state.local.paused) {
    console.log(`- local: ${state.local.reason}`);
  }

  if (state.remote.paused) {
    console.log(`- remote: ${state.remote.reason}`);
  }
}

async function detectRepo() {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }

  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin']);
  const remote = stdout.trim();
  const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);

  if (!match) {
    throw new Error(`Could not detect GitHub repo from origin remote: ${remote}`);
  }

  return match[1];
}

async function runGh(args) {
  return execFileAsync('gh', args, {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
