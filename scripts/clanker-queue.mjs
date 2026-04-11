#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const QUEUE_READY = 'queue:ready';
const QUEUE_ACTIVE = 'queue:active';
const QUEUE_BLOCKED = 'queue:blocked';
const QUEUE_DEFERRED = 'queue:deferred';
const REQUIRED_CI_WORKFLOW = 'CI';
const REQUIRED_CI_CHECK = 'build-and-test';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = options.repo ?? (await detectRepo());

  do {
    const result = await runQueueCycle({ ...options, repo });

    if (!options.loop) {
      return;
    }

    if (result.status === 'paused') {
      console.log('Queue paused; sleeping before the next check.');
    } else if (result.status === 'idle') {
      console.log('Queue idle; sleeping before the next check.');
    } else if (result.status === 'deferred') {
      console.log('Queue has ready PRs, but they are waiting behind older lock-group siblings.');
    } else if (result.status === 'waiting-checks') {
      console.log('Queue has ready PRs, but the required GitHub CI check is still pending.');
    }

    await sleep(options.sleepMs);
  } while (true);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    loop: false,
    once: false,
    repo: null,
    sleepMs: 60_000
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

    if (arg === '--loop') {
      options.loop = true;
      continue;
    }

    if (arg === '--once') {
      options.once = true;
      continue;
    }

    if (arg === '--repo') {
      options.repo = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--sleep-ms') {
      options.sleepMs = Number(argv[index + 1] ?? '0');
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.loop) {
    options.once = true;
  }

  return options;
}

async function runQueueCycle(options) {
  if (await isPaused(options.repo)) {
    return { status: 'paused' };
  }

  const pullRequests = await listOpenPullRequests(options.repo);

  await syncDeferredLabels(options, pullRequests);

  const nextDecision = classifyReadyPullRequests(pullRequests);

  if (nextDecision.status === 'idle') {
    return { status: 'idle' };
  }

  if (nextDecision.status === 'deferred') {
    console.log(summarizeDeferredQueue(nextDecision.deferred));
    return { status: 'deferred' };
  }

  const waitingChecks = [];

  for (const nextPr of nextDecision.candidates) {
    console.log(`Processing PR #${nextPr.number} ${nextPr.url}`);

    if (nextPr.isCrossRepository) {
      const summary =
        'Queue refuses cross-repository PRs. Recreate this change from an in-repo branch before re-queueing.';
      await markQueueBlocked(options, nextPr, summary);
      return { status: 'blocked', pullRequest: nextPr.number };
    }

    const metadata = validatePullRequestMetadata(nextPr);

    if (!metadata.ok) {
      await markQueueBlocked(options, nextPr, metadata.summary);
      return { status: 'blocked', pullRequest: nextPr.number };
    }

    const githubChecks = await validateGitHubChecks(options.repo, nextPr.number);

    if (githubChecks.action === 'wait') {
      waitingChecks.push({ pullRequest: nextPr, summary: githubChecks.summary });
      continue;
    }

    if (githubChecks.action === 'block') {
      await markQueueBlocked(options, nextPr, githubChecks.summary);
      return { status: 'blocked', pullRequest: nextPr.number };
    }

    if (!options.dryRun) {
      await movePullRequestToActive(options.repo, nextPr.number);
    }

    const validation = await validatePullRequest(nextPr.number);

    if (!validation.ok) {
      await markQueueBlocked(options, nextPr, validation.summary);
      return { status: 'blocked', pullRequest: nextPr.number };
    }

    if (options.dryRun) {
      console.log(`[dry-run] would merge PR #${nextPr.number}`);
      return { status: 'dry-run', pullRequest: nextPr.number };
    }

    try {
      await runGh(['pr', 'merge', String(nextPr.number), '--repo', options.repo, '--squash', '--delete-branch']);
    } catch (error) {
      await markQueueBlocked(options, nextPr, summarizeFailure('gh', ['pr', 'merge', String(nextPr.number)], error));
      return { status: 'blocked', pullRequest: nextPr.number };
    }

    await runGh([
      'issue',
      'edit',
      String(nextPr.number),
      '--repo',
      options.repo,
      '--remove-label',
      QUEUE_READY,
      '--remove-label',
      QUEUE_ACTIVE,
      '--remove-label',
      QUEUE_BLOCKED,
      '--remove-label',
      QUEUE_DEFERRED
    ]);

    const issueNumber = parseIssueNumber(nextPr.headRefName);

    if (issueNumber !== null) {
      await runGh(['issue', 'edit', String(issueNumber), '--repo', options.repo, '--remove-label', 'state:in-progress']);
    }

    console.log(`Merged PR #${nextPr.number}`);
    return { status: 'merged', pullRequest: nextPr.number };
  }

  if (waitingChecks.length > 0) {
    console.log(summarizeWaitingChecks(waitingChecks));
    return { status: 'waiting-checks' };
  }

  return { status: 'idle' };
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

  try {
    await readFile(new URL('../.clankerism/PAUSED', import.meta.url), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function validatePullRequestMetadata(pullRequest) {
  if (!isMeaningfulMetadata(pullRequest.lockGroup)) {
    return {
      ok: false,
      summary: 'Queue blocked this PR because the `## Lock group` section is missing or still contains placeholder text.'
    };
  }

  if (!isMeaningfulMetadata(pullRequest.writeSet)) {
    return {
      ok: false,
      summary: 'Queue blocked this PR because the `## Write set` section is missing or still contains placeholder text.'
    };
  }

  return { ok: true };
}

function extractMarkdownSection(body, heading) {
  const pattern = new RegExp(`## ${escapeRegExp(heading)}\\s+([\\s\\S]*?)(?=\\n## |$)`);
  const match = body.match(pattern);
  return match ? match[1].trim() : '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isMeaningfulMetadata(value) {
  const normalized = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`/g, '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  return !normalized.includes('<copy from issue>') && !normalized.includes('must match the issue');
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

async function listOpenPullRequests(repo) {
  const { stdout } = await runGh([
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--base',
    'main',
    '--limit',
    '200',
    '--json',
    'number,title,createdAt,isDraft,headRefName,url,isCrossRepository,labels,body'
  ]);

  const pullRequests = JSON.parse(stdout)
    .filter((pullRequest) => !pullRequest.isDraft)
    .map(enrichPullRequest)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  return pullRequests;
}

function enrichPullRequest(pullRequest) {
  const labelNames = Array.isArray(pullRequest.labels)
    ? pullRequest.labels.map((label) => label.name)
    : [];
  const body = typeof pullRequest.body === 'string' ? pullRequest.body : '';
  const lockGroup = extractMarkdownSection(body, 'Lock group');
  const writeSet = extractMarkdownSection(body, 'Write set');

  return {
    ...pullRequest,
    body,
    labelNames,
    lockGroup,
    lockGroupKey: normalizeLockGroup(lockGroup),
    writeSet
  };
}

async function syncDeferredLabels(options, pullRequests) {
  for (const pullRequest of pullRequests) {
    const olderSibling = hasLabel(pullRequest, QUEUE_READY)
      ? findOlderLockGroupSibling(pullRequest, pullRequests)
      : null;
    const shouldBeDeferred = olderSibling !== null;
    const isDeferred = hasLabel(pullRequest, QUEUE_DEFERRED);

    if (shouldBeDeferred === isDeferred) {
      continue;
    }

    const action = shouldBeDeferred ? 'add' : 'remove';
    const reason = shouldBeDeferred
      ? ` behind PR #${olderSibling.number} in lock group \`${pullRequest.lockGroup}\``
      : '';

    console.log(`${options.dryRun ? '[dry-run] would ' : ''}${action} ${QUEUE_DEFERRED} on PR #${pullRequest.number}${reason}`);

    if (options.dryRun) {
      continue;
    }

    await runGh([
      'issue',
      'edit',
      String(pullRequest.number),
      '--repo',
      options.repo,
      shouldBeDeferred ? '--add-label' : '--remove-label',
      QUEUE_DEFERRED
    ]);
  }
}

function classifyReadyPullRequests(pullRequests) {
  const readyPullRequests = pullRequests
    .filter((pullRequest) => hasLabel(pullRequest, QUEUE_READY))
    .sort(comparePullRequests);
  const candidates = [];
  const deferred = [];

  for (const pullRequest of readyPullRequests) {
    const olderSibling = findOlderLockGroupSibling(pullRequest, pullRequests);

    if (olderSibling) {
      deferred.push({ pullRequest, olderSibling });
      continue;
    }

    candidates.push(pullRequest);
  }

  if (readyPullRequests.length === 0) {
    return { status: 'idle' };
  }

  if (candidates.length > 0) {
    return { status: 'candidates', candidates, deferred };
  }

  return { status: 'deferred', deferred };
}

function findOlderLockGroupSibling(candidate, pullRequests) {
  if (!candidate.lockGroupKey) {
    return null;
  }

  return (
    pullRequests.find((pullRequest) => {
      if (pullRequest.number === candidate.number || pullRequest.isCrossRepository) {
        return false;
      }

      if (pullRequest.lockGroupKey !== candidate.lockGroupKey) {
        return false;
      }

      return comparePullRequests(pullRequest, candidate) < 0;
    }) ?? null
  );
}

function comparePullRequests(left, right) {
  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  return createdAtComparison !== 0 ? createdAtComparison : left.number - right.number;
}

function hasLabel(pullRequest, labelName) {
  return pullRequest.labelNames.includes(labelName);
}

function normalizeLockGroup(value) {
  const normalized = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized;
}

function summarizeDeferredQueue(deferred) {
  const details = deferred
    .map(({ pullRequest, olderSibling }) => {
      const group = pullRequest.lockGroup ? ` in \`${pullRequest.lockGroup}\`` : '';
      return `- PR #${pullRequest.number} is waiting behind PR #${olderSibling.number}${group}`;
    })
    .join('\n');

  return `Queue found only deferred PRs this cycle.\n${details}`;
}

async function validateGitHubChecks(repo, pullRequestNumber) {
  const { stdout } = await runGh([
    'pr',
    'view',
    String(pullRequestNumber),
    '--repo',
    repo,
    '--json',
    'statusCheckRollup'
  ]);
  const { statusCheckRollup } = JSON.parse(stdout);
  const requiredCheck = Array.isArray(statusCheckRollup)
    ? statusCheckRollup.find((check) => {
        return check?.workflowName === REQUIRED_CI_WORKFLOW && check?.name === REQUIRED_CI_CHECK;
      })
    : null;

  if (!requiredCheck) {
    return {
      ok: false,
      action: 'wait',
      summary: `Queue is waiting for GitHub CI. Required check \`${REQUIRED_CI_WORKFLOW} / ${REQUIRED_CI_CHECK}\` has not appeared yet.`
    };
  }

  const status = String(requiredCheck.status ?? '').toUpperCase();
  const conclusion = String(requiredCheck.conclusion ?? '').toUpperCase();

  if (status !== 'COMPLETED') {
    return {
      ok: false,
      action: 'wait',
      summary: `Queue is waiting for GitHub CI. Required check \`${REQUIRED_CI_WORKFLOW} / ${REQUIRED_CI_CHECK}\` is currently ${status.toLowerCase() || 'pending'}.`
    };
  }

  if (conclusion === 'SUCCESS') {
    return { ok: true, action: 'proceed' };
  }

  return {
    ok: false,
    action: 'block',
    summary: `Queue blocked this PR because GitHub CI failed. Required check \`${REQUIRED_CI_WORKFLOW} / ${REQUIRED_CI_CHECK}\` concluded with \`${conclusion.toLowerCase() || 'unknown'}\`.`
  };
}

function summarizeWaitingChecks(waitingChecks) {
  const details = waitingChecks
    .map(({ pullRequest, summary }) => `- PR #${pullRequest.number}: ${summary}`)
    .join('\n');

  return `Queue found ready PRs, but they are still waiting on GitHub CI.\n${details}`;
}

async function movePullRequestToActive(repo, pullRequestNumber) {
  await runGh([
    'issue',
    'edit',
    String(pullRequestNumber),
    '--repo',
    repo,
    '--remove-label',
    QUEUE_BLOCKED,
    '--remove-label',
    QUEUE_DEFERRED,
    '--remove-label',
    QUEUE_READY,
    '--add-label',
    QUEUE_ACTIVE
  ]);
}

async function validatePullRequest(number) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clanker-queue-'));
  const worktreePath = path.join(tempRoot, 'repo');

  try {
    await runGit(['fetch', 'origin', 'main']);
    await runGit(['worktree', 'add', '--detach', worktreePath, 'origin/main']);

    try {
      await runGit(['fetch', 'origin', `pull/${number}/merge`], { cwd: worktreePath });
      await runGit(['checkout', '--force', 'FETCH_HEAD'], { cwd: worktreePath });
    } catch (error) {
      return {
        ok: false,
        summary: 'Queue could not materialize the GitHub merge ref for this PR. Rebase or resolve merge conflicts, then re-queue it.'
      };
    }

    const commands = [
      ['corepack', ['pnpm', 'install', '--frozen-lockfile']],
      ['corepack', ['pnpm', 'run', 'build']],
      ['corepack', ['pnpm', 'run', 'lint']],
      ['corepack', ['pnpm', 'run', 'format:check']],
      ['corepack', ['pnpm', 'test']],
      ['corepack', ['pnpm', 'run', 'test:dashboard']]
    ];

    for (const [command, args] of commands) {
      try {
        console.log(`Running ${command} ${args.join(' ')} in ${worktreePath}`);
        await runCommand(command, args, { cwd: worktreePath, env: sanitizedValidationEnv() });
      } catch (error) {
        return {
          ok: false,
          summary: summarizeFailure(command, args, error)
        };
      }
    }

    return { ok: true };
  } finally {
    await runGit(['worktree', 'remove', '--force', worktreePath]).catch(() => {});
    await rm(tempRoot, { force: true, recursive: true }).catch(() => {});
  }
}

async function markQueueBlocked(options, pullRequest, summary) {
  const pullRequestNumber = pullRequest.number;
  console.log(summary);

  if (options.dryRun) {
    console.log(`[dry-run] would move PR #${pullRequestNumber} to ${QUEUE_BLOCKED}`);
    return;
  }

  await runGh([
    'issue',
    'edit',
    String(pullRequestNumber),
    '--repo',
    options.repo,
    '--remove-label',
    QUEUE_DEFERRED,
    '--remove-label',
    QUEUE_READY,
    '--remove-label',
    QUEUE_ACTIVE,
    '--add-label',
    QUEUE_BLOCKED
  ]);

  await runGh([
    'pr',
    'comment',
    String(pullRequestNumber),
    '--repo',
    options.repo,
    '--body',
    `Queue blocked this PR.\n\n${summary}`
  ]);

  const issueNumber = parseIssueNumber(pullRequest.headRefName);

  if (issueNumber !== null) {
    await runGh([
      'issue',
      'edit',
      String(issueNumber),
      '--repo',
      options.repo,
      '--remove-label',
      'state:in-progress',
      '--add-label',
      'state:blocked'
    ]);
  }
}

function parseIssueNumber(headRefName) {
  const match = headRefName.match(/^build\/issue-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function summarizeFailure(command, args, error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
  const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
  const combined = [stderr, stdout].filter(Boolean).join('\n').trim();
  const excerpt = combined.split('\n').slice(0, 20).join('\n');

  if (!excerpt) {
    return `Queue validation failed while running \`${command} ${args.join(' ')}\`.`;
  }

  return `Queue validation failed while running \`${command} ${args.join(' ')}\`.\n\n\`\`\`\n${excerpt}\n\`\`\``;
}

function sanitizedValidationEnv() {
  const env = { ...process.env };

  for (const key of Object.keys(env)) {
    if (
      key.startsWith('GH_') ||
      key.startsWith('GITHUB_') ||
      key === 'ACTIONS_ID_TOKEN_REQUEST_TOKEN' ||
      key === 'ACTIONS_RUNTIME_TOKEN'
    ) {
      delete env[key];
    }
  }

  return env;
}

async function runGit(args, options = {}) {
  return runCommand('git', args, options);
}

async function runGh(args) {
  return runCommand('gh', args, { env: process.env });
}

async function runCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    maxBuffer: 10 * 1024 * 1024
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
