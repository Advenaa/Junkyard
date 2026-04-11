#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = options.repo ?? (await detectRepo());
  const labelConfig = await loadLabelConfig();
  const existingLabels = await listExistingLabels(repo);

  for (const label of labelConfig) {
    const command = existingLabels.has(label.name) ? 'edit' : 'create';
    const args = ['label', command, label.name, '--repo', repo, '--color', label.color, '--description', label.description];

    if (options.dryRun) {
      console.log(`[dry-run] gh ${args.join(' ')}`);
      continue;
    }

    await runGh(args);
    console.log(`${command === 'create' ? 'created' : 'updated'} ${label.name}`);
  }
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    repo: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--repo') {
      options.repo = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
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

async function loadLabelConfig() {
  const raw = await readFile(new URL('../.clankerism/labels.json', import.meta.url), 'utf8');
  const parsed = JSON.parse(raw);
  const issueLabels = Object.values(parsed.issue_axes).flat();
  const operationalLabels = parsed.operational_labels ?? [];
  return [...issueLabels, ...operationalLabels];
}

async function listExistingLabels(repo) {
  const { stdout } = await runGh(['label', 'list', '--repo', repo, '--limit', '200', '--json', 'name']);
  const labels = JSON.parse(stdout);
  return new Set(labels.map((label) => label.name));
}

async function runGh(args) {
  return execFileAsync('gh', args, {
    env: process.env
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
