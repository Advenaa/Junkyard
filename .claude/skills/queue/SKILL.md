---
name: queue
description: Clankerism merge queue — runs one serialized cycle of `pnpm run clanker:queue:loop --once`, then engages reasoning only if a PR just got flipped to `queue:blocked`. Safe to run in a `/loop` for continuous merging while you work.
---

# /queue — Clankerism Expeditor

The merge gate. Many builders can cook in parallel; only `/queue` can
publish to `main`. This skill is a thin wrapper around the deterministic
merge script (`scripts/clanker-queue.mjs`) — mechanical work stays in the
Node script so it merges the same way every time, and LLM reasoning only
fires when the script reports a `queue:blocked` failure.

`/queue` is the 3rd Clankerism role. Unlike `/scout` (read source) and
`/build` (write source), `/queue` does not touch application code — it
only reads PR state, runs CI gate checks, and merges.

**Invocation**:

- `/queue` — run one cycle and report
- `/queue loop` — run continuously via `/loop`, self-paced between cycles

## Hard rules

1. **Check the PAUSED brake.** If `.clankerism/PAUSED` exists, exit with a
   one-line status and do nothing else.
2. **Never modify source code.** `/queue` only runs the merge script,
   reads PR labels/checks, and optionally files a follow-up issue when a
   merge fails for a non-obvious reason. It does not edit files in `src/`,
   `dashboard/`, `scripts/`, or `test/`.
3. **Never merge by hand.** Always go through `clanker-queue.mjs`. The
   script is the single source of truth for "what's safe to merge right
   now" — lock-group serialization, CI check validation, synthetic merge
   ref revalidation all live there.
4. **Never strip `queue:deferred` by hand.** The script manages deferred
   labels automatically. If you see a deferred PR you think should go
   first, that's a bug in the deferred logic, not something to paper over.
5. **Never override the PR metadata gate.** If the script blocks a PR
   because `Lock group` or `Write set` is missing, the fix is for a
   builder to add that metadata to the PR body — not for `/queue` to
   bypass validation.
6. **Never claim work for yourself.** `/queue` consumes what builders
   produce. If you think a blocked PR needs repair, either spawn `/fix`
   for a quick patch, or tell the user it needs a fresh `/build` repair
   session — do not start editing the PR branch yourself.

## Flow

### Step 1: Preflight

```bash
cd /Users/advena/project/poddershub

if [ -f .clankerism/PAUSED ]; then
  echo "PAUSED — exiting"
  exit 0
fi
```

### Step 2: Run one queue cycle

```bash
node scripts/clanker-queue.mjs --once
```

(We call `node` directly instead of `pnpm run clanker:queue:loop --once` so
this works on any machine, even without `pnpm` on the PATH. The script
itself still uses `corepack pnpm` internally for the synthetic-merge build
gate — that part is untouched.)

Capture the full stdout. A single cycle takes roughly **60–120 seconds**
when a PR is actually merging, because the script runs `pnpm install
--frozen-lockfile` + build + lint + format:check + test + dashboard test
in a fresh temp dir to validate the synthetic merge ref before merging.
Don't panic if the command looks stuck for a minute — that's normal.

Interpret the output as one of these terminal statuses:

| Status           | How to detect                                                             |
|------------------|---------------------------------------------------------------------------|
| `paused`         | Stdout starts with `PAUSED` or mentions the brake                         |
| `idle`           | **Empty stdout** or `Queue idle` — no ready PRs at all                    |
| `deferred`       | Stdout contains `waiting behind` or `deferred` language                   |
| `waiting-checks` | Stdout contains `waiting` + CI check name                                 |
| `merged`         | Stdout contains `Merged PR #<N>`                                          |
| `blocked`        | Stdout contains `Queue blocked this PR` or `Queue validation failed`      |
| `dry-run`        | Stdout contains `[dry-run]`                                               |

**Important:** the script prints **nothing to stdout when the queue is
idle** (no open `queue:ready` PRs). Empty stdout is not a crash — it's
success, meaning there's nothing to do. If you want to be extra sure,
double-check with `gh pr list --state open --label queue:ready` — if that
also returns empty, you're idle.

### Step 3: Branch on status

**paused / idle / deferred / waiting-checks / dry-run** — print a
one-line status for the user and stop. No reasoning needed, no follow-up.

**merged** — print which PR merged and what's next in the queue. If
running under `/loop`, schedule the next cycle.

**blocked** — **this is the only path where LLM reasoning runs.** Do
this:

1. Parse the PR number the script reported as blocked.
2. `gh pr view <N> --json statusCheckRollup,title,labels,body,url` to
   read the failure context.
3. Classify the failure:
   - **Metadata gate** (missing Lock group / Write set in PR body)
     → tell user, suggest the builder run adds metadata, stop.
   - **CI `build-and-test` failed** → look at the failing job log
     (`gh run view <run-id> --log-failed`), summarize the root cause
     in 2–3 sentences, and offer the user the choice between:
     - **/fix** — small patch directly on `build/issue-<N>`
     - **/build repair** — re-open a `repair/pr-<N>` lock and send a
       builder agent
     - **close the PR** — if the underlying issue is wrong
   - **Synthetic merge ref failed** (conflicts on latest `main`)
     → tell the user the branch needs a rebase. Do NOT rebase yourself
     — a builder repair session owns that.
   - **Lock branch rejected / cross-repo PR / unknown gh error**
     → report verbatim and stop.
4. Do not take action. `/queue` reports the diagnosis and waits for the
   user's call. The whole point of splitting `/queue` from `/build` is
   that the queue doesn't write code.

### Step 4: Report

Tell the user, in this structure:

```
Cycle status: <idle|merged|blocked|…>
Merged this cycle: <PR #N> (if any)
Queue-ready waiting: <list of PR numbers>
Deferred: <list of PR numbers> (if any)
Waiting on CI: <list of PR numbers> (if any)
Blocked this cycle: <PR #N + one-line reason> (if any)
Next: <"sleeping before next cycle" | "idle, nothing to do" | "awaiting user on PR #N">
```

Then stop. If running under `/loop`, schedule the next wake via
`ScheduleWakeup` with a self-paced delay. Remember each cycle itself
takes 60–120s of wall time, so these delays are on top of that:

- **Merged this cycle** → 60s (hot — more ready PRs may flush; next
  cycle will immediately start validating the next candidate)
- **waiting-checks** → 180s (CI builds typically take 3–4 min; no point
  checking sooner)
- **deferred** → 300s (only clears when the blocking older sibling moves,
  which requires builder activity)
- **idle** → 600s (nothing will change until a builder produces a
  `queue:ready` PR; cache-warm window doesn't matter here)
- **blocked** → do NOT auto-loop. Stop and report to the user. Blocked
  PRs require a human decision (spawn `/fix`, spawn `/build` repair, or
  close the PR) and auto-retrying will just re-block the same PR on the
  same reason. Wait for the user to act, then the user re-invokes
  `/queue` when the blocker is cleared.

If the same PR blocks twice in a row on the same reason across cycles,
escalate — stop the loop, tell the user "PR #N is stuck, something
upstream needs human attention" and wait.

## When /queue runs

- **Active clankering session** — the user runs `/queue loop` in a
  second Claude Code tab while they drive `/build` in the main tab.
  Terminal-free, chat-native merges.
- **Post-build handoff** — the user just ran `/build`, the PR is
  `queue:ready`, they want it merged now without waiting for the next
  `/loop` tick. `/queue` once, see it merge, move on.
- **Triage the backlog** — several PRs sitting `queue:ready`, user
  wants to flush them. Run `/queue loop` until status is `idle`.

## Things you will be tempted to do and must not

- **Merge a PR the script said was blocked.** No. The script is the
  gate. If you disagree with its decision, file an issue against the
  script's logic — don't bypass it.
- **Rebase a conflicted branch yourself.** No — that's a builder
  repair job. `/queue` does not write code.
- **Strip `queue:deferred` because you want a younger PR to go first.**
  No — the lock-group order is intentional. Talk to the user if the
  order looks wrong.
- **Run `--loop` mode from inside this skill.** No — always `--once`.
  The skill's own loop (via `/loop` + `ScheduleWakeup`) replaces the
  script's internal loop, so we get reasoning between cycles.
- **Skip the PAUSED check.** Never. The brake exists for a reason.
- **Touch application code or the queue script itself.** Read-only
  against the repo. The only writes `/queue` performs are via `gh`
  (labels, merges, and optionally a follow-up issue when a block is
  ambiguous enough to warrant one).
