#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LOG_RELATIVE = '.clankerism/worktree.log';

async function mainCheckout() {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--git-common-dir']);
  const gitDir = stdout.trim();
  const abs = path.isAbsolute(gitDir) ? gitDir : path.resolve(gitDir);
  return path.dirname(abs);
}

function pathForSlug(main, slug) {
  return `${main}-worktrees/${slug}`;
}

async function log(main, line) {
  const logPath = path.join(main, LOG_RELATIVE);
  const ts = new Date().toISOString();
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${ts} ${line}\n`);
}

async function gitTry(args, opts = {}) {
  try {
    await execFileAsync('git', args, opts);
    return true;
  } catch {
    return false;
  }
}

async function branchExistsLocal(branch, cwd) {
  return gitTry(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd });
}

async function branchExistsRemote(branch, cwd) {
  return gitTry(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { cwd });
}

export async function claim(slug, { branch, base = 'origin/main' } = {}) {
  const br = branch ?? `build/${slug}`;
  const main = await mainCheckout();
  const wt = pathForSlug(main, slug);

  if (existsSync(wt)) {
    throw new Error(`worktree already exists at ${wt} — run 'resume' or 'release' first`);
  }
  if ((await branchExistsLocal(br, main)) || (await branchExistsRemote(br, main))) {
    throw new Error(`branch ${br} already exists — use 'resume' to reattach`);
  }

  await mkdir(path.dirname(wt), { recursive: true });
  await execFileAsync('git', ['fetch', 'origin', 'main'], { cwd: main });
  await execFileAsync('git', ['worktree', 'add', '-b', br, wt, base], { cwd: main });
  await log(main, `claim slug=${slug} branch=${br} path=${wt}`);
  return wt;
}

export async function resume(slug, { branch } = {}) {
  const br = branch ?? `build/${slug}`;
  const main = await mainCheckout();
  const wt = pathForSlug(main, slug);

  if (existsSync(wt)) {
    await gitTry(['pull', '--ff-only'], { cwd: wt });
    await log(main, `resume-existing slug=${slug} branch=${br} path=${wt}`);
    return wt;
  }

  await mkdir(path.dirname(wt), { recursive: true });

  if (await branchExistsRemote(br, main)) {
    await execFileAsync('git', ['fetch', 'origin', br], { cwd: main });
    await execFileAsync('git', ['worktree', 'add', '-B', br, wt, `origin/${br}`], { cwd: main });
  } else if (await branchExistsLocal(br, main)) {
    await execFileAsync('git', ['worktree', 'add', wt, br], { cwd: main });
  } else {
    throw new Error(`no branch ${br} to resume — run 'claim' instead`);
  }

  await log(main, `resume-create slug=${slug} branch=${br} path=${wt}`);
  return wt;
}

export async function release(slug) {
  const main = await mainCheckout();
  const wt = pathForSlug(main, slug);

  if (existsSync(wt)) {
    await gitTry(['worktree', 'remove', '--force', wt], { cwd: main });
  }
  await gitTry(['worktree', 'prune'], { cwd: main });
  if (existsSync(wt)) {
    await rm(wt, { force: true, recursive: true });
  }
  await log(main, `release slug=${slug} path=${wt}`);
  return wt;
}

export async function pathFor(slug) {
  const main = await mainCheckout();
  return pathForSlug(main, slug);
}

export async function list() {
  const main = await mainCheckout();
  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: main });
  const parent = `${main}-worktrees/`;
  const rows = [];
  for (const rec of stdout.split('\n\n').filter(Boolean)) {
    const lines = rec.split('\n');
    const wtLine = lines.find((l) => l.startsWith('worktree '));
    if (!wtLine) continue;
    const p = wtLine.slice('worktree '.length);
    if (!p.startsWith(parent)) continue;
    const branchLine = lines.find((l) => l.startsWith('branch '));
    const br = branchLine ? branchLine.slice('branch refs/heads/'.length) : 'detached';
    rows.push({ slug: path.basename(p), branch: br, path: p });
  }
  return rows;
}

export async function gc({ dryRun = false } = {}) {
  const main = await mainCheckout();
  const parent = `${main}-worktrees`;
  const actions = [];
  if (!existsSync(parent)) return actions;

  await gitTry(['worktree', 'prune'], { cwd: main });

  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: main });
  const active = new Set();
  for (const rec of stdout.split('\n\n').filter(Boolean)) {
    const wtLine = rec.split('\n').find((l) => l.startsWith('worktree '));
    if (wtLine) active.add(wtLine.slice('worktree '.length));
  }

  const dirs = await readdir(parent).catch(() => []);
  for (const dir of dirs) {
    const full = path.join(parent, dir);
    if (!active.has(full)) {
      actions.push({ slug: dir, kind: 'orphan-dir', path: full });
      if (!dryRun) {
        await rm(full, { force: true, recursive: true });
        await log(main, `gc-orphan-dir slug=${dir} path=${full}`);
      }
      continue;
    }
    const m = dir.match(/^issue-(\d+)$/);
    if (!m) continue;
    const n = m[1];
    let closed = false;
    let merged = false;
    try {
      const { stdout: view } = await execFileAsync('gh', ['issue', 'view', n, '--json', 'state']);
      closed = JSON.parse(view).state === 'CLOSED';
    } catch {
      /* ignore */
    }
    if (closed) {
      try {
        const { stdout: prs } = await execFileAsync('gh', [
          'pr',
          'list',
          '--head',
          `build/issue-${n}`,
          '--state',
          'merged',
          '--json',
          'number',
        ]);
        merged = JSON.parse(prs).length > 0;
      } catch {
        /* ignore */
      }
    }
    if (closed && merged) {
      actions.push({ slug: dir, kind: 'closed-merged', path: full });
      if (!dryRun) {
        await release(dir);
        const attemptsPath = path.join(main, '.clankerism', 'attempts', `${dir}.ndjson`);
        await rm(attemptsPath, { force: true }).catch(() => {});
      }
    }
  }
  return actions;
}

function usage() {
  process.stderr.write(`usage: worktree.mjs <command> [args]

commands:
  path <slug>                          print worktree path for slug
  claim <slug> [--branch b] [--base r] create fresh worktree + new branch
  resume <slug> [--branch b]           reattach existing branch or create worktree
  release <slug>                       remove worktree (keeps remote branch)
  list                                 list clankerism worktrees
  gc [--dry-run]                       prune orphans + close merged issues

convention: <main-checkout>-worktrees/<slug>
default branch: build/<slug>
`);
}

function parseFlag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function cli() {
  const [, , cmd, ...rest] = process.argv;
  try {
    switch (cmd) {
      case 'path': {
        const slug = rest[0];
        if (!slug) throw new Error('missing <slug>');
        process.stdout.write((await pathFor(slug)) + '\n');
        return;
      }
      case 'claim': {
        const slug = rest[0];
        if (!slug) throw new Error('missing <slug>');
        const wt = await claim(slug, {
          branch: parseFlag(rest, '--branch'),
          base: parseFlag(rest, '--base'),
        });
        process.stdout.write(wt + '\n');
        return;
      }
      case 'resume': {
        const slug = rest[0];
        if (!slug) throw new Error('missing <slug>');
        const wt = await resume(slug, { branch: parseFlag(rest, '--branch') });
        process.stdout.write(wt + '\n');
        return;
      }
      case 'release': {
        const slug = rest[0];
        if (!slug) throw new Error('missing <slug>');
        await release(slug);
        return;
      }
      case 'list': {
        for (const row of await list()) {
          process.stdout.write(`${row.slug}\t${row.branch}\t${row.path}\n`);
        }
        return;
      }
      case 'gc': {
        const actions = await gc({ dryRun: rest.includes('--dry-run') });
        for (const a of actions) {
          process.stdout.write(`${a.kind}\t${a.slug}\t${a.path}\n`);
        }
        return;
      }
      default:
        usage();
        process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`worktree: ${err.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  cli();
}
