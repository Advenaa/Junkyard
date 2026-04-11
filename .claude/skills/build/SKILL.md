---
name: build
description: Claim one ready issue from the Clankerism queue, ship a PR that resolves it, and auto-merge on green CI. This is the consumer half of Clankerism.
---

# /build — Clankerism Consumer

The line cook of the Clankerism kitchen. Pulls one `state:ready` issue off
the queue, cooks it, plates it as a PR, and walks away. Never batches issues.
Never picks its own work — it always takes the next ticket.

**Invocation**:

- `/build` — claim the next highest-priority ready issue
- `/build <N>` — claim a specific issue by number

`$ARGUMENTS` may contain the issue number.

## Hard rules (never violate)

1. **One issue per run.** If you finish early, exit — don't start a second.
2. **One PR per run.** No "bundled" PRs combining multiple issues.
3. **Claim atomically.** The only lock is pushing `build/issue-$N` to origin.
   If the push is rejected, another clanker got there first — exit gracefully,
   do NOT retry with a different name.
4. **Check the PAUSED brake.** If `.clankerism/PAUSED` exists, exit immediately
   with a one-line status.
5. **Never force-push to main.** Never amend a published commit. Never
   disable hooks (`--no-verify`, `--no-gpg-sign`).
6. **Never modify `.clankerism/scout-state.md`.** That file belongs to
   `/scout`.
7. **Local retries are bounded at 3 attempts per run.** Step 5 (Implement &
   verify) runs inside a retry wrapper. Each retry must read the prior
   attempt's failure log from `.clankerism/attempts/issue-<N>.ndjson` and fix
   the root cause — no re-running the same diff hoping for a different
   result. If all 3 attempts fail locally, comment on the issue with the
   three-attempt summary, flip to `state:blocked`, exit. The worktree stays
   for a repair session.
8. **At most one remote fix commit per PR, inside the same run that opened
   it.** If CI goes red after the PR is pushed, Claude may diagnose the
   failure, push one follow-up commit to the same branch, and `gh run watch`
   the new run. If that second run is also red, flip to `state:blocked`. A
   future run cannot push a third commit to the same PR — repair sessions
   use `repair/pr-<PR>`.
9. **Cross-run budget is 5 failed attempts total per issue.** Attempt
   records accumulate in `.clankerism/attempts/issue-<N>.ndjson` across
   runs. If the file already has ≥5 records where `outcome != "pass"`, the
   new run flips `state:blocked` immediately and exits — don't even claim
   the worktree again.

## Preflight

The main checkout is a launchpad only. Every build runs in its own
worktree at `<main>-worktrees/issue-<N>`. The main checkout is never
modified, so parallel `/build` sessions can run without fighting.

```bash
# 1. Run from the main checkout. This is the stable cwd we cd back to
#    on errors and between ticks.
MAIN="$(git rev-parse --show-toplevel)"
cd "$MAIN"

# 2. Hard stop if brake is on
if [ -f .clankerism/PAUSED ]; then
  echo "PAUSED brake engaged — exiting"
  exit 0
fi

# 3. Fetch main so the worktree branches off a fresh base
git fetch origin main
```

## Attempt memory (`.clankerism/attempts/issue-<N>.ndjson`)

Retries learn from prior failures. Every Step 5 attempt appends one NDJSON
record to `<main>/.clankerism/attempts/issue-<N>.ndjson`. The file lives
in the **main checkout**, never in the worktree, so it survives
`worktree.mjs release`. All reads and writes happen with `cwd = "$MAIN"`.

Schema (one line per attempt):

```json
{"ts":"2026-04-11T17:42:13Z","attempt":2,"run":"build","outcome":"gate_failed","gate_step":"test","output_excerpt":"...","diff_summary":{"files_changed":3,"lines_added":47,"lines_removed":12,"files":["..."]},"terminal":false}
```

- `outcome` ∈ `pass | gate_failed | hard_error`
- `gate_step` ∈ `build | lint | format:check | test | test:dashboard | remote-ci | adversarial-review | none`
- `output_excerpt` — first 40 lines of failure output, ANSI-stripped
- `terminal: true` — marker on the final record when flipping to `state:blocked` for good

Budget math:
- **Local cap**: 3 attempts per run.
- **Global cap**: 5 failed attempts (`outcome != "pass"`) per issue across all runs.
- `PRIOR_FAILS` = count of `"outcome":"gate_failed"` + `"outcome":"hard_error"` lines in the existing file (0 if no file).
- `THIS_RUN_CAP = min(3, 5 - PRIOR_FAILS)`. If ≤0, comment and `state:blocked`, exit before claiming.

On run start after Step 1 picks the issue but before Step 2 claims the
worktree, read `<main>/.clankerism/attempts/issue-$N.ndjson` (if present)
and compute the budget. Tolerate malformed lines: any line not starting
with `{` is ignored but kept for audit.

On `clean_win` (merge succeeds), delete the file before releasing the
worktree. On `state:blocked`, preserve the file and append a final
`"terminal":true` marker record.

## Step 1: Pick the issue

If `$ARGUMENTS` is a number, use that issue. Otherwise, ask `gh` for the
highest-priority `state:ready` issue, walking `p0 → p1 → p2 → p3`:

```bash
for prio in p0 p1 p2 p3; do
  N=$(gh issue list \
        --state open \
        --label "state:ready" \
        --label "$prio" \
        --limit 1 \
        --json number --jq '.[0].number')
  if [ -n "$N" ]; then break; fi
done

if [ -z "$N" ]; then
  echo "no ready issues — exiting"
  exit 0
fi
```

Read the issue body in full via `gh issue view $N --json title,body,labels`.
Extract the acceptance criteria (`- [ ]` checkboxes in the body). Those are
your contract — you are not done until every box is checked in reality.

## Step 2: Atomic branch claim

Create a dedicated worktree for this issue, then push the new branch.
The **push** is still the lock — if someone else pushed first, we
release the worktree and exit.

```bash
BRANCH="build/issue-$N"

# Create the worktree. `claim` fails if the branch already exists
# locally or on origin — that means a previous session crashed or
# another clanker beat us. Either way, exit cleanly.
WT=$(node scripts/worktree.mjs claim "issue-$N") || {
  echo "worktree claim failed (branch may already exist) — exiting"
  exit 0
}
cd "$WT"

# The push IS the lock. If someone else pushed first, we lose.
if ! git push -u origin "$BRANCH"; then
  echo "branch already claimed by another clanker — releasing worktree and exiting"
  cd "$MAIN"
  node scripts/worktree.mjs release "issue-$N"
  exit 0
fi
```

Immediately after the push succeeds, flip the issue label:

```bash
gh issue edit $N \
  --remove-label state:ready \
  --add-label state:in-progress
```

## Step 3: Understand the problem

1. Read the issue body (context + acceptance criteria).
2. Read every file the issue references. If the issue names a file that
   doesn't exist, the issue is stale — post a comment saying so, flip to
   `state:blocked`, and exit. Don't guess.
3. Grep for related code around the issue's claims (don't trust the issue
   description over the current code).
4. Consult `.clankerism/lessons.md` for recurring bug patterns that might
   apply.

## Step 4: Plan before coding

Spawn the `Plan` subagent with the full issue context and current file state
to produce a step-by-step implementation plan. Reading the plan is cheap;
ripping out a wrong implementation is expensive.

The plan should name every file you'll touch and every test you'll add or
update.

## Step 5: Implement & verify (retry loop)

The implement step and the verify step run inside a shared retry wrapper.
Each attempt is one pass through "edit files → run the full local CI
gate". On gate failure, Claude reads the failure output, updates the
attempt record, and either retries (fixing the root cause) or exits to
`state:blocked` when the budget is spent.

Implementation rules (every attempt):

- Smallest diff that satisfies the acceptance criteria. Don't drive-by
  refactor adjacent code unless the issue is literally a refactor.
- Follow the conventions in `CLAUDE.md`.
- ESM-only, `.js` import extensions, TypeScript strict.
- Validate at system boundaries only.
- No comments unless they explain a non-obvious WHY.

Retry state machine (pseudocode — Claude executes this, not bash):

```
PRIOR_FAILS = count of non-"pass" lines in $MAIN/.clankerism/attempts/issue-$N.ndjson
if PRIOR_FAILS >= 5:
  gh issue comment $N --body "/build: attempt budget exhausted (5/5). state:blocked."
  append attempt record with {outcome: "gate_failed", terminal: true}
  gh issue edit $N --remove-label state:in-progress --add-label state:blocked
  exit 1  # leave worktree for a repair session

THIS_RUN_CAP = min(3, 5 - PRIOR_FAILS)
PRIOR_CONTEXT = last non-"pass" record from attempts file (if any)

for attempt in 1..THIS_RUN_CAP:
  # 1. Implement the fix.
  #    - attempt 1 of a fresh issue: start from scratch
  #    - any retry: read PRIOR_CONTEXT (gate_step + output_excerpt), then
  #      fix the ROOT CAUSE. Do not re-run the same diff hoping CI is flaky.
  edit files in the worktree

  # 2. Run the full local CI gate IN THIS ORDER. Short-circuit on first fail.
  for step in [build, lint, format:check, test, test:dashboard]:
    run npm run $step (cwd = worktree)
    if failed:
      EXCERPT = first 40 lines of command output, ANSI-stripped
      DIFF_SUMMARY = git diff --numstat origin/main  (files + lines)
      append_attempt_record(
        ts=now, attempt=PRIOR_FAILS+attempt, run="build",
        outcome="gate_failed", gate_step=$step,
        output_excerpt=EXCERPT, diff_summary=DIFF_SUMMARY
      )
      PRIOR_CONTEXT = that record
      continue outer loop  # next attempt

  # All 5 gate steps passed.
  append_attempt_record(outcome="pass", gate_step="none")
  break  # proceed to Step 6 (adversarial review)

if outer loop exhausted without passing:
  comment issue with a short summary of the THIS_RUN_CAP attempts
  append_attempt_record(terminal=true) if cumulative PRIOR_FAILS+attempt >= 5
  gh issue edit $N --remove-label state:in-progress --add-label state:blocked
  exit 1  # leave worktree for a repair session
```

**Commands to remember** (run from inside the worktree cwd):

```bash
npm run build          # tsc + vite dashboard
npm run lint           # 0 errors
npm run format:check   # all files formatted
npm test               # backend unit tests
npm run test:dashboard # dashboard vitest
```

**Append the attempt record from the main checkout**:

```bash
mkdir -p "$MAIN/.clankerism/attempts"
echo '{"ts":"...","attempt":N,"run":"build","outcome":"...","gate_step":"...","output_excerpt":"...","diff_summary":{...}}' >> "$MAIN/.clankerism/attempts/issue-$N.ndjson"
```

If your change touches integration paths, also mention in the PR body that
integration tests were not run locally (CI runs them on merge).

## Step 6: Adversarial self-review

Before opening the PR, spawn a **separate subagent** (the general-purpose
agent with a code-reviewer brief) whose only job is to look for:

- Acceptance-criteria boxes the implementation missed
- Security issues (XSS, SQL injection, SSRF, secret leakage, prompt injection)
- Missing test coverage for the code you changed
- Hidden coupling with modules the issue didn't mention

If the reviewer flags something material, treat it as a failed attempt:
append an attempt record with `gate_step: "adversarial-review"`, then loop
back to Step 5 for the next attempt (subject to the 3-per-run / 5-total
budget). The retry wrapper owns the "try again" semantics — this step
doesn't have its own one-shot retry anymore.

> Future: if `scripts/codex-review.mjs` exists, call it as an additional
> adversarial pass. Until that script lands, the subagent review is the only
> gate.

## Step 7: Commit + push

Follow the existing commit-message style (see `git log --oneline -20`).
The commit title should reference the issue in a way GitHub auto-closes it:

```
<short imperative title>

<1–3 paragraph body explaining the why>

Fixes #<N>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

`git push` to the already-upstream branch.

## Step 8: Open the PR, watch CI, allow one fix commit

Because this repo is on the free GitHub plan (no branch protection /
rulesets), `gh pr merge --auto` is unreliable. The clanker watches the CI
run synchronously. On green, it merges. On red, it gets **one** chance to
push a fix commit and re-watch — then it either merges or gives up to
`state:blocked`.

```bash
# 1. Open the PR
PR_URL=$(gh pr create \
  --base main \
  --head "$BRANCH" \
  --title "<same as commit title>" \
  --body "$(cat <<EOF
## Summary
<1–3 bullets>

## Acceptance
<copy the issue checklist, marked off where done>

## Test plan
- [x] npm run build
- [x] npm run lint
- [x] npm run format:check
- [x] npm test
- [x] npm run test:dashboard
- [ ] integration (CI only)

Fixes #$N
EOF
)")

PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')
REMOTE_FIX_USED=0
```

Find the CI run for the initial push:

```bash
sleep 5  # give GitHub a moment to register the run
RUN_ID=$(gh run list --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId')
if [ -z "$RUN_ID" ]; then
  gh issue comment "$N" --body "/build: no CI run detected after push. Human triage needed."
  gh issue edit "$N" --remove-label state:in-progress --add-label state:blocked
  exit 1
fi
```

Watch / fix / re-watch state machine (Claude executes, not bash):

```
watch:
  gh run watch "$RUN_ID" --exit-status
  if green:
    goto merge
  if red:
    if REMOTE_FIX_USED == 1:
      comment "/build: CI red after fix commit. state:blocked."
      append attempt record {outcome: gate_failed, gate_step: remote-ci, terminal: true}
      gh issue edit --remove-label state:in-progress --add-label state:blocked
      exit 1

    PRIOR_FAILS = count non-"pass" records in attempts file
    if PRIOR_FAILS >= 5:
      comment "/build: attempt budget exhausted. state:blocked."
      append attempt record {terminal: true}
      gh issue edit --remove-label state:in-progress --add-label state:blocked
      exit 1

    # diagnose
    FIX_LOG = gh run view "$RUN_ID" --log-failed | head 200
    append attempt record {outcome: gate_failed, gate_step: remote-ci, output_excerpt: FIX_LOG}

    # produce fix diff inside the worktree, then re-run the LOCAL gate
    edit files in the worktree
    run local CI gate (build, lint, format:check, test, test:dashboard)
    if local gate fails:
      comment "/build: local gate failed on remote-fix attempt. state:blocked."
      append attempt record {outcome: gate_failed, gate_step: <step>, terminal: true}
      gh issue edit --remove-label state:in-progress --add-label state:blocked
      exit 1

    # commit + push the fix
    git commit -m "fix(ci): <root cause> for #$N"
    git push
    REMOTE_FIX_USED=1

    # re-query RUN_ID until it changes (gh run watch watches a specific
    # run ID, not the branch — the old ID would complete and mislead us)
    for i in 1..6:
      sleep 5
      NEW_RUN_ID = gh run list --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId'
      if NEW_RUN_ID != RUN_ID:
        RUN_ID = NEW_RUN_ID
        goto watch
    # run never materialized
    comment "/build: CI run never materialized for fix commit. state:blocked."
    gh issue edit --remove-label state:in-progress --add-label state:blocked
    exit 1

merge:
  gh pr merge "$PR_NUMBER" --squash --delete-branch
  gh issue edit "$N" --remove-label state:in-progress 2>/dev/null || true
  rm -f "$MAIN/.clankerism/attempts/issue-$N.ndjson"
  cd "$MAIN"
  node scripts/worktree.mjs release "issue-$N"
  exit 0
```

**Race guard**: before the final `gh issue edit --add-label state:blocked`,
re-read the labels — if a human has already set `state:blocked`, skip the
edit so we don't clobber human intent.

**Idempotent cleanup**: every cleanup call in the merge path ends with
`|| true` so a concurrent `/queue` session can't trip the exit path.

## Step 9: Exit cleanly

Three exit paths:

- **Clean win** — CI green (first try or after the fix commit), PR merged,
  attempt file deleted, worktree released. Issue auto-closed via `Fixes #N`.
- **Soft block** — local retry budget exhausted or remote fix failed.
  Issue flipped to `state:blocked`. Worktree **preserved** so a future
  `repair/pr-<PR>` run can pick it up. Attempt file preserved with
  `"terminal":true` marker.
- **Hard block** — disk full, `gh` auth expired, brake engaged mid-run,
  or other environmental failure. Exit immediately with a one-line status.
  Leave all state in place; the next run does a fresh sweep.

## Failure modes + what to do

| Situation | What you do |
|-----------|-------------|
| No ready issues in the queue | Exit with `no work` message |
| `.clankerism/PAUSED` present | Exit immediately, log the brake |
| Worktree `claim` fails (branch exists, disk full) | Log the error, exit — another clanker may hold the branch, or a previous crash left state behind (run `worktree.mjs gc`) |
| Branch push rejected | Another clanker won the race — `cd "$MAIN"`, `node scripts/worktree.mjs release "issue-$N"`, exit |
| Issue names a file that doesn't exist | Comment on issue, flip to `state:blocked`, exit (leave worktree — repair run may need it) |
| Cross-run attempt budget exhausted (≥5 failed records in NDJSON) | Comment "attempt budget exhausted", write `terminal:true` record, `state:blocked`, exit — don't even start a new attempt |
| Local retry budget exhausted (3 attempts this run) | Comment with last 3 attempt summaries, `state:blocked`, preserve worktree + NDJSON, exit |
| CI red after 1 remote fix commit | Comment, write `terminal:true` record, `state:blocked`, preserve worktree, exit — no second fix commit |
| CI red, local fix attempt fails its own gate | Comment with details, `state:blocked`, don't push the broken fix |
| Adversarial review finds a material gap | Treat as a failed attempt — append `adversarial-review` record and loop back to Step 5 under the retry wrapper |
| Attempts file write fails (disk full) | Log, Discord webhook, `state:blocked`, exit — never continue without the audit trail |
| `gh` auth expired | Exit with a clear message — human action required |

## Worktree lifecycle

- Every build runs in `<main-checkout>-worktrees/issue-<N>`.
- The worktree **stays on disk until the PR merges**. `/queue` releases
  it after a successful `gh pr merge`.
- If the PR is flipped to `queue:blocked`, the worktree stays — a future
  repair run (`node scripts/worktree.mjs resume "issue-$N"`) reattaches
  and fixes it.
- Orphan worktrees (crashed sessions, closed-without-merge issues) are
  cleaned up by `node scripts/worktree.mjs gc`, which `/scout` runs once
  per tick. Safe to run any time — idempotent.

## Things you will be tempted to do and must not

- **Claim two issues because they're "related"**. No. One run, one issue.
- **Modify an unrelated file because you noticed a typo**. No. File a new
  issue via `/scout` if it matters.
- **Push a second fix commit to an already-failed fix**. No. One fix commit
  per PR per run. Second failure = `state:blocked`.
- **Retry the same diff hoping CI is flaky**. No. Each retry must read the
  prior attempt's `output_excerpt` and fix a concrete root cause. If you
  genuinely believe it's flake, document it in the comment and
  `state:blocked` — let a human decide.
- **Write attempt records inside the worktree**. No.
  `.clankerism/attempts/issue-<N>.ndjson` lives in the main checkout so it
  survives worktree release.
- **Skip the attempt record when a gate fails**. No. Every failed attempt
  writes a record before the retry fires. Missing records make the budget
  math lie.
- **Re-use a branch name another clanker already pushed to**. Never. The
  branch name IS the lock.
- **Create the issue yourself if none exist**. That is `/scout`'s job.
