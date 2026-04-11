#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = options.repo ?? (await detectRepo());
  const baseUrl = normalizeBaseUrl(process.env.CLANKER_VERIFY_BASE_URL ?? process.env.PUBLIC_URL ?? '');

  if (await isPaused(repo)) {
    console.log('Clankerism brake is engaged; skipping autonomous verify.');
    return;
  }

  if (!baseUrl) {
    throw new Error('Set CLANKER_VERIFY_BASE_URL or PUBLIC_URL before running clanker-verify.');
  }

  const checks = [
    {
      id: 'health',
      url: `${baseUrl}/api/v1/health`,
      validate(response) {
        return response.ok;
      },
      explain(response) {
        return `Expected a healthy HTTP response from /api/v1/health but got ${response.status}.`;
      }
    },
    {
      id: 'root-shell',
      url: `${baseUrl}/`,
      validate(response) {
        return response.ok && /<div[^>]+id=["']root["']/i.test(response.body);
      },
      explain(response) {
        if (!response.ok) {
          return `Expected / to return HTML shell but got ${response.status}.`;
        }

        return 'Expected / to contain the React root shell.';
      }
    }
  ];

  const failures = [];

  for (const check of checks) {
    const response = await fetchText(check.url);

    if (!check.validate(response)) {
      failures.push({
        ...check,
        response,
        summary: check.explain(response)
      });
    }
  }

  if (failures.length === 0) {
    console.log(`clanker-verify passed for ${baseUrl}`);
    return;
  }

  for (const failure of failures) {
    await createOrUpdateRegressionIssue({
      baseUrl,
      failure,
      repo,
      target: options.target
    });
  }

  process.exitCode = 1;
}

function parseArgs(argv) {
  const options = {
    repo: null,
    target: process.env.CLANKER_VERIFY_TARGET ?? 'prod'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--repo') {
      options.repo = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--target') {
      options.target = argv[index + 1] ?? options.target;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, '');
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

async function isPaused(repo) {
  try {
    await runGh([
      'variable',
      'get',
      'CLANKERISM_PAUSED',
      '--repo',
      repo,
      '--json',
      'value'
    ]);
    return true;
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';

    if (!/not found/i.test(stderr)) {
      throw error;
    }
  }

  return false;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'clanker-verify/1.0' },
      redirect: 'follow',
      signal: controller.signal
    });
    const body = await response.text();

    return {
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      body
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function createOrUpdateRegressionIssue({ repo, baseUrl, failure, target }) {
  const fingerprint = `clanker-verify-${target}-${failure.id}`;
  const existingIssue = await findOpenIssueByFingerprint(repo, fingerprint);
  const title = `verify regression: ${failure.id} on ${target}`;
  const body = buildIssueBody({ baseUrl, failure, fingerprint, target });

  if (existingIssue) {
    await runGh([
      'issue',
      'comment',
      String(existingIssue.number),
      '--repo',
      repo,
      '--body',
      buildUpdateComment({ baseUrl, failure })
    ]);
    console.log(`updated existing regression issue #${existingIssue.number}`);
    return;
  }

  await runGh([
    'issue',
    'create',
    '--repo',
    repo,
    '--title',
    title,
    '--body',
    body,
    '--label',
    'state:ready',
    '--label',
    'p1',
    '--label',
    'type:bug',
    '--label',
    'source:scout'
  ]);
  console.log(`created regression issue for ${failure.id}`);
}

function buildIssueBody({ baseUrl, failure, fingerprint, target }) {
  return `## Summary
Autonomous verify failed the \`${failure.id}\` smoke check against \`${target}\`.

## Target
- Base URL: ${baseUrl}
- Check: ${failure.url}

## What happened
${failure.summary}

## Evidence
- HTTP status: ${failure.response.status}
- Response excerpt:

\`\`\`
${excerpt(failure.response.body)}
\`\`\`

## What should happen
The autonomous smoke check should pass without manual intervention.

<!-- clanker-fingerprint:${fingerprint} -->`;
}

function buildUpdateComment({ baseUrl, failure }) {
  return `Autonomous verify observed the same regression again.

- Base URL: ${baseUrl}
- Check: ${failure.url}
- HTTP status: ${failure.response.status}

\`\`\`
${excerpt(failure.response.body)}
\`\`\``;
}

async function findOpenIssueByFingerprint(repo, fingerprint) {
  const { stdout } = await runGh([
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--search',
    fingerprint,
    '--json',
    'number,title'
  ]);
  const issues = JSON.parse(stdout);
  return issues[0] ?? null;
}

function excerpt(text) {
  return String(text).trim().slice(0, 1000) || '(empty response)';
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
