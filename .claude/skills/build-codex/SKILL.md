---
name: build-codex
description: Self-pacing loop that claims one Clankerism state:ready issue per tick and delegates the full /build flow to Codex via codex:rescue. Use with `/loop /build-codex` to drive the queue overnight.
user-invocable: true
---

# /build-codex — Codex-driven Clankerism loop

You are the heartbeat. Codex is the cook. Each tick you check the queue,
claim one issue, hand the keys to Codex, verify what Codex did, then
decide when the next tick fires. The loop is self-healing, circuit-broken,
and serializes by design.

## Invocation

```
/loop /build-codex
```

This is **dynamic /loop mode** — you self-pace via `ScheduleWakeup`. There
is no fixed interval. Each tick decides when the next one fires by passing
`prompt: "/loop /build-codex"` back to `ScheduleWakeup`. Omit the
`ScheduleWakeup` call to end the loop.

## Ownership split

The key inversion vs. earlier versions: **Codex only edits source files and
runs the local CI gate. Claude does every git and gh operation.**

| Layer | Owner |
|-------|-------|
| `cd` to repo, PAUSED brake check | Claude |
| Zombie sweep (state:in-progress reconciliation) | Claude |
| Preflight (fetch origin/main) | Claude |
| Queue scan + atomic branch claim OR resume | Claude |
| Attempt-budget check against `.clankerism/attempts/issue-<N>.ndjson` | Claude |
| Read issue, plan, implement source edits inside worktree | **Codex** |
| Run local CI gate (`build`, `lint`, `format:check`, `test`, `test:dashboard`) | **Codex** |
| Return structured status (`passing` / `gate_failed` / `hard_error`) | **Codex** |
| Append NDJSON attempt record to `.clankerism/attempts/issue-<N>.ndjson` | Claude |
| Local retry wrapper around the direct Codex CLI call (up to 3 attempts per tick) | Claude |
| Stage, commit with `Fixes #N`, push branch | Claude |
| Open PR via `gh pr create` | Claude |
| Watch CI via `gh run watch` | Claude |
| Push at most 1 remote fix commit on red CI (fix diff re-delegated to Codex) | Claude |
| `gh pr merge --squash`, label cleanup, worktree release on win | Claude |
| Failure counter + circuit breaker | Claude |
| NDJSON loop log + Discord webhook | Claude |
| Schedule next tick | Claude |

### Why Codex can't run git

Git worktrees have their real `.git` directory at
`<main>/.git/worktrees/issue-<N>/`, **outside** the worktree path. Codex
CLI's `workspace-write` sandbox is rooted at `git rev-parse --show-toplevel`
of its `--cwd`, so when Codex runs with `--cwd <worktree>` the writable
root is the worktree and the parent `.git/worktrees/` dir is outside that
scope. Codex cannot acquire `.git/index.lock`, cannot write packed-refs,
and cannot run `git commit` from inside the worktree. That's why Claude —
which runs unsandboxed and can access the parent `.git/worktrees/` dir —
owns every git-mutating operation. Codex owns every source-file-editing
operation because it is the better coder.

### Why we bypass `codex:codex-rescue` here

The `codex:codex-rescue` subagent is a pure forwarder whose cwd is
inherited from Claude's harness process cwd (always the main checkout),
not from whatever Bash `cd` Claude has issued. It also does not forward
a `--cwd` flag — any `--cwd` in the forwarded text is treated as literal
prompt content. Result: Codex's sandbox would land on the main checkout,
and every write into the worktree would return `operation not permitted`.

This skill therefore invokes `codex-companion.mjs task --cwd <worktree>
--write --prompt-file ...` **directly via Bash**, bypassing rescue.
`resolveCommandCwd` in codex-companion resolves `--cwd` against
`process.cwd()`, then `resolveWorkspaceRoot` computes
`git rev-parse --show-toplevel` of that cwd, which — for a worktree path
— returns the worktree itself. Sandbox root lands on the worktree, and
file writes succeed. This is the one and only place in the codebase
where direct codex-companion invocation is the correct pattern; all other
Codex work still goes through `codex:codex-rescue`.

If the Codex attempt loop never produces a passing local gate, Claude
flips the issue to `state:blocked` and increments the per-tick failure
counter. Three consecutive tick failures trip the circuit breaker (touch
`.clankerism/PAUSED`, exit).

### Budgets at a glance

- **3 local attempts per tick.** Claude wraps the direct
  `codex-companion.mjs task` Bash call in a retry loop of up to 3
  iterations. Each iteration passes the prior attempt's failure excerpt
  back to Codex as `PRIOR_FAILURE_LOG`.
- **5 total failed attempts per issue across all runs/ticks.** Tracked in
  `.clankerism/attempts/issue-<N>.ndjson` (main checkout, not the
  worktree, so it survives `worktree.mjs release`). Exceed 5 → issue
  flips to `state:blocked` and waits for a human.
- **At most 1 remote fix commit per PR, in the run that opened it.** If CI
  goes red after Claude's initial push, Claude may re-delegate a fix diff
  to Codex once, local-verify it, push one follow-up commit, and re-watch
  CI. If the second run is also red, flip to `state:blocked`.

## Working directory

The main checkout at `/Users/advena/project/poddershub` is a launchpad.
The first action of every tick is `cd /Users/advena/project/poddershub`
— this is the stable cwd where the PAUSED brake check, zombie sweep,
preflight, and all writes to `.clankerism/attempts/issue-<N>.ndjson`
happen.

Once the tick claims or resumes an issue, it creates (or reattaches) a
dedicated worktree at `/Users/advena/project/poddershub-worktrees/issue-<N>`.
Step 7 invokes `codex-companion.mjs task --cwd <worktree> --write`
directly via Bash (not the `codex:codex-rescue` Agent), so Codex's
sandbox root is explicitly the worktree — not the main checkout inherited
from Claude's process cwd. The main checkout is never modified by Codex.

After each Codex attempt returns, Claude appends the NDJSON attempt
record from the **main-checkout cwd** (absolute path
`$MAIN/.clankerism/attempts/issue-<N>.ndjson`), then either loops, or
publishes the commit/PR from inside the worktree cwd. On the next tick,
Step 1 `cd`s back to main so the loop is resilient to worktrees being
released between ticks.

---

## Tick flow

### Step 1 — `cd`, detect parallel mode, and load state

```bash
cd /Users/advena/project/poddershub
[ -f .clankerism/loop-state.json ] || cat > .clankerism/loop-state.json <<'EOF'
{"consecutive_failures":0,"last_outcome":"none","last_tick_ts":0,"last_issue":null,"empty_streak":0,"paused_notified":false}
EOF

# Parallel-mode sentinel — if present, this tick will hand the PR off to
# /queue instead of watching/merging it directly (see Step 7.5 fork).
# Multiple /build-codex sessions can run concurrently against disjoint
# issues when this is set, because the serialized merge gate moves to
# /queue. Create with `touch .clankerism/PARALLEL` to enable, `rm` to
# disable.
if [ -f .clankerism/PARALLEL ]; then
  PARALLEL_MODE=1
else
  PARALLEL_MODE=0
fi
```

**Atomic loop-state lock.** Multiple concurrent sessions race on the
shared `.clankerism/loop-state.json` and `.clankerism/loop-log.ndjson`.
Guard every read-modify-write on those files with an mkdir-based lock
(mkdir is atomic on POSIX — the first caller to create the directory
wins, every other caller's mkdir returns non-zero):

```bash
acquire_loop_state_lock() {
  local deadline=$(( $(date +%s) + 30 ))
  while ! mkdir .clankerism/loop-state.lock 2>/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      # Stale lock (another tick crashed holding it). Steal it — the
      # lock directory only protects short read-modify-write windows,
      # so a 30s stale directory is never a legitimate owner.
      rmdir .clankerism/loop-state.lock 2>/dev/null || true
      mkdir .clankerism/loop-state.lock
      break
    fi
    sleep 1
  done
}
release_loop_state_lock() {
  rmdir .clankerism/loop-state.lock 2>/dev/null || true
}
```

Use this lock around: Step 1's initial loop-state read, Step 3's
updates that mutate `resumable_issues[]`, Step 8's terminal NDJSON
append to `attempts/issue-<N>.ndjson` (which is per-issue and doesn't
need the global lock — only `loop-state.json` and `loop-log.ndjson`
do), and Step 9's loop-state write + loop-log append. Acquire only
for the short read-modify-write window; never hold across an
`Agent`/`Bash` subprocess call to Codex.

Read `.clankerism/loop-state.json` with the Read tool under the lock.
You need `consecutive_failures`, `empty_streak`, and `paused_notified`
for later steps.

### Step 2 — PAUSED brake (hard stop)

```bash
[ -f .clankerism/PAUSED ] && cat .clankerism/PAUSED
```

If the file exists:
1. Append a tick record with `outcome: "paused"` to `.clankerism/loop-log.ndjson`.
2. If `paused_notified` is `false` in loop-state, send a Discord webhook
   "⏸ /build-codex paused: \<contents of PAUSED file\>" and set
   `paused_notified: true` in loop-state. (Avoids spamming on repeated
   manual reruns.)
3. **Do NOT call ScheduleWakeup.** The loop ends. The user removes the
   brake and re-runs `/loop /build-codex` to resume.

If the file does NOT exist, set `paused_notified: false` in loop-state
(reset the latch).

### Step 3 — Zombie sweep

The sweep reconciles `state:in-progress` issues left behind by a previous
crashed tick. Under the new retry model, a red CI does **not** always
mean "block" — if the attempts budget still has room, the issue is
eligible for **resume** on the current tick. Always run before claiming
new work.

```bash
gh issue list --state open --label state:in-progress \
  --json number,title --jq '.[].number'
```

For each issue number `$N`, gather:

```bash
# PR metadata
gh pr list --head "build/issue-$N" --state all \
  --json number,state,mergedAt,statusCheckRollup --jq '.[0]'

# Attempts budget (from MAIN checkout)
ATTEMPTS_FILE=".clankerism/attempts/issue-$N.ndjson"
if [ -f "$ATTEMPTS_FILE" ]; then
  PRIOR_FAILS=$(grep -c '"outcome":"gate_failed"\|"outcome":"hard_error"' "$ATTEMPTS_FILE" 2>/dev/null || echo 0)
else
  PRIOR_FAILS=0
fi

# Is a fix commit already on the branch? (compare commit count vs main)
FIX_COMMITS=$(git -C . rev-list --count "origin/main..origin/build/issue-$N" 2>/dev/null || echo 0)
# First commit is the feature commit; any extra commit is a fix commit.
```

Reconcile by case. **`wait_for_in_flight` pauses the tick**;
**`resumable_issues[]` is handed to Step 5/6 which picks it before
walking state:ready**.

| PR state | Attempts state | Extra commits | Action |
|----------|----------------|---------------|--------|
| Merged (`mergedAt` non-null) | any | any | Release worktree, `rm -f $ATTEMPTS_FILE`, `gh issue edit --remove-label state:in-progress` (idempotent cleanup after a /queue merge) |
| Open, has `queue:ready` or `queue:deferred` label | any | any | **Not a zombie.** The PR was handed off to /queue by a prior parallel-mode tick and is waiting its turn in the serialized merge lane. Skip entirely — do NOT add to `resumable_issues[]`, do NOT flip labels, do NOT release the worktree. Continue the sweep. |
| Open, all checks SUCCESS or pending | any | any | `wait_for_in_flight = true`. Leave worktree alone. A prior tick's watch is finishing. |
| Open, any check FAILURE/CANCELLED | `PRIOR_FAILS >= 5` | any | Budget exhausted. Comment "Sweep: attempt budget (5/5) exhausted. state:blocked.", `gh issue edit --remove-label state:in-progress --add-label state:blocked`, leave worktree + NDJSON for `/fix`. |
| Open, any check FAILURE/CANCELLED | `PRIOR_FAILS < 5` | `FIX_COMMITS >= 2` (1 fix commit already pushed) | Remote fix commit didn't save it. Comment "Sweep: remote fix commit exhausted. state:blocked.", flip to `state:blocked`, leave worktree + NDJSON. |
| Open, any check FAILURE/CANCELLED | `PRIOR_FAILS < 5` | `FIX_COMMITS <= 1` | Add `$N` to `resumable_issues[]`. Do not flip labels. Do not release the worktree. The current tick will resume this issue. |
| No PR returned, branch exists on origin | any | — | Claim was interrupted pre-PR-open. Comment "Sweep: claimed but no PR opened. Re-queueing.", `gh issue edit --remove-label state:in-progress --add-label state:ready`, `git push origin --delete build/issue-$N` (best-effort), `rm -f $ATTEMPTS_FILE`, release the worktree. |
| No PR, no branch | any | — | `gh issue edit --remove-label state:in-progress --add-label state:ready`, `rm -f $ATTEMPTS_FILE`, release any orphan worktree dir. |
| `state:in-progress` label already gone (user intervention) | any | — | Leave alone. Log a warning. Human owns it. |

If `wait_for_in_flight` is true after the sweep:

1. Append tick record `outcome: "wait_in_flight"`.
2. `ScheduleWakeup(120, "in-flight PR from prior tick still running CI", "/loop /build-codex")`.
3. Return — do not claim a new issue.

Otherwise, remember `resumable_issues[]` for Step 5 — the claim step
picks a resumable issue **before** walking the `state:ready` priority
list. **Resume trumps claim.**

### Step 3b — Blocked-repair sweep

Before walking fresh state:ready work, scan for PRs that `/queue` has
flipped to `queue:blocked` whose linked issue sits at `state:blocked`.
Without this sweep, once an issue rots into `state:blocked` nothing in
the normal claim path (which only reads `state:ready`) will ever pick
it back up. This sweep handles two repairable failure modes inline:

1. **Missing metadata** — PR body lacks `## Lock group` / `## Write
   set`. Fix: derive from `git diff --name-only origin/main...HEAD`,
   rewrite the PR body, relabel `queue:blocked → queue:ready`. No
   worktree, no Codex, no local gate — this is a 5-second fix.
2. **Merge conflict** — PR is mergeable=`CONFLICTING` or
   mergeStateStatus=`DIRTY`. Fix: take a repair lock, worktree the
   branch, `git rebase origin/main`, hand conflict markers to Codex
   for resolution if the rebase didn't apply cleanly, run the local
   gate, `git push --force-with-lease`, relabel.

Eligibility for either mode:

- PR is open with `queue:blocked` label
- Linked issue has `state:blocked` label
- CI `build-and-test` conclusion is `SUCCESS` or pending (NOT `FAILURE`
  — red CI is a different class of break; `/fix` handles that)
- Repair attempts budget `.clankerism/attempts/repair-pr-<PR>.ndjson`
  has `< 3` prior `gate_failed`/`hard_error` entries
- A `repair/pr-<PR>` branch does NOT already exist on origin (another
  tick owns the repair — race loss)

```bash
MAIN="/Users/advena/project/poddershub"
repair_metadata_done=()
repair_rebase_prs=()

while read -r PR_N; do
  [ -z "$PR_N" ] && continue

  # Linked issue number (prefer `Fixes #N` in body, fall back to branch name)
  PR_JSON=$(gh pr view "$PR_N" --json body,headRefName,mergeable,mergeStateStatus,statusCheckRollup,labels)
  BODY=$(printf '%s' "$PR_JSON" | jq -r '.body')
  ISSUE_N=$(printf '%s' "$BODY" | grep -oiE 'Fixes #[0-9]+' | head -1 | grep -oE '[0-9]+')
  if [ -z "$ISSUE_N" ]; then
    HEAD_REF=$(printf '%s' "$PR_JSON" | jq -r '.headRefName')
    ISSUE_N=$(printf '%s' "$HEAD_REF" | grep -oE 'issue-[0-9]+' | grep -oE '[0-9]+')
  fi
  [ -z "$ISSUE_N" ] && continue

  ISSUE_LABELS=$(gh issue view "$ISSUE_N" --json labels --jq '.labels[].name' | tr '\n' ' ')
  echo "$ISSUE_LABELS" | grep -q 'state:blocked' || continue

  CI_CONCLUSION=$(printf '%s' "$PR_JSON" | jq -r '[.statusCheckRollup[] | select(.name=="build-and-test") | .conclusion] | .[0] // "PENDING"')
  [ "$CI_CONCLUSION" = "FAILURE" ] && continue

  REPAIR_ATTEMPTS_FILE="$MAIN/.clankerism/attempts/repair-pr-$PR_N.ndjson"
  if [ -f "$REPAIR_ATTEMPTS_FILE" ]; then
    REPAIR_FAILS=$(grep -c '"outcome":"gate_failed"\|"outcome":"hard_error"' "$REPAIR_ATTEMPTS_FILE" 2>/dev/null || echo 0)
  else
    REPAIR_FAILS=0
  fi
  [ "$REPAIR_FAILS" -ge 3 ] && continue

  # Repair-lock collision check
  git ls-remote --exit-code --heads origin "repair/pr-$PR_N" >/dev/null 2>&1 && continue

  # Classify failure mode
  HAS_LG=$(printf '%s' "$BODY" | grep -cE '^## Lock group' || true)
  HAS_WS=$(printf '%s' "$BODY" | grep -cE '^## Write set' || true)
  MERGEABLE=$(printf '%s' "$PR_JSON" | jq -r '.mergeable')

  if [ "$HAS_LG" = "0" ] || [ "$HAS_WS" = "0" ]; then
    REASON=metadata
  elif [ "$MERGEABLE" = "CONFLICTING" ]; then
    REASON=rebase
  else
    # Unknown block reason — skip, let a human triage
    continue
  fi

  if [ "$REASON" = "metadata" ]; then
    # --- Metadata fast path (inline, no worktree) ---
    HEAD_REF=$(printf '%s' "$PR_JSON" | jq -r '.headRefName')
    WRITE_SET=$(gh pr view "$PR_N" --json files --jq '.files[].path' | sort -u)
    LOCK_GROUP=$(printf '%s\n' "$WRITE_SET" | awk -F/ '
      NF >= 3 && ($1 == "src" || $1 == "dashboard") { print $2 "/" $3; next }
      NF >= 2 { print $1 "/" $2; next }
      { print $1 }
    ' | sort | uniq -c | sort -rn | awk 'NR==1 {print $2}')
    LOCK_GROUP=${LOCK_GROUP:-misc}

    NEW_BODY_FILE=$(mktemp)
    {
      printf '%s\n\n' "$BODY"
      printf '## Lock group\n\n%s\n\n' "$LOCK_GROUP"
      printf '## Write set\n\n%s\n' "$WRITE_SET"
    } > "$NEW_BODY_FILE"

    if gh pr edit "$PR_N" --body-file "$NEW_BODY_FILE" \
       && gh pr edit "$PR_N" --remove-label queue:blocked --add-label queue:ready \
       && gh issue edit "$ISSUE_N" --remove-label state:blocked --add-label state:in-progress; then
      mkdir -p "$MAIN/.clankerism/attempts"
      printf '{"ts":"%s","outcome":"metadata_repaired","pr":%s}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PR_N" >> "$REPAIR_ATTEMPTS_FILE"
      repair_metadata_done+=("$PR_N")
    else
      printf '{"ts":"%s","outcome":"gate_failed","pr":%s,"stage":"metadata"}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PR_N" >> "$REPAIR_ATTEMPTS_FILE"
    fi
    rm -f "$NEW_BODY_FILE"
    continue
  fi

  # REASON = rebase — queue for the heavy path below
  repair_rebase_prs+=("$PR_N:$ISSUE_N")
done < <(gh pr list --state open --label queue:blocked --json number --jq '.[].number')
```

If `repair_metadata_done` is non-empty, the queue now has new
`queue:ready` PRs and `/queue` will pick them up on its own cadence.
This tick continues to the rebase-repair path below if any candidates
exist.

#### Rebase repair path

For each entry in `repair_rebase_prs`, take a repair lock and try to
rebase the branch onto current `origin/main`. If the rebase is clean,
run the local gate and force-with-lease push. If the rebase left
conflict markers, hand them to Codex via the same retry loop Step 7
uses for fresh implementations, then gate + push.

```bash
for entry in "${repair_rebase_prs[@]}"; do
  IFS=':' read -r PR_N ISSUE_N <<< "$entry"
  REPAIR_BRANCH="repair/pr-$PR_N"
  BUILD_BRANCH="build/issue-$ISSUE_N"
  REPAIR_ATTEMPTS_FILE="$MAIN/.clankerism/attempts/repair-pr-$PR_N.ndjson"

  cd "$MAIN"
  git fetch origin "$BUILD_BRANCH" main

  # Take the repair lock — push failure means another tick owns it
  git branch -f "$REPAIR_BRANCH" "origin/$BUILD_BRANCH"
  if ! git push -u origin "$REPAIR_BRANCH" 2>&1; then
    git branch -D "$REPAIR_BRANCH" 2>/dev/null || true
    printf '{"ts":"%s","outcome":"repair_race_lost","pr":%s}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PR_N" >> "$REPAIR_ATTEMPTS_FILE"
    continue
  fi

  # Flip issue state so the normal sweep treats this as live work next tick
  gh issue edit "$ISSUE_N" --remove-label state:blocked --add-label state:in-progress

  # Create a repair worktree on $BUILD_BRANCH (reuse if already present)
  WT=$(node "$MAIN/scripts/worktree.mjs" claim "issue-$ISSUE_N" 2>/dev/null \
       || node "$MAIN/scripts/worktree.mjs" resume "issue-$ISSUE_N")
  cd "$WT"

  # Attempt the rebase
  git fetch origin main
  if git rebase origin/main; then
    REPAIR_HAD_CONFLICTS=0
  else
    REPAIR_HAD_CONFLICTS=1
    # Leave conflict markers in the worktree — Codex will resolve them.
    # Do NOT `git rebase --abort`; Codex needs to see the in-progress state.
  fi

  # If conflicts, delegate to Codex with a conflict-resolution prompt
  # (see Step 7 — reuse the retry loop with prompt variant
  # `repair-rebase-conflicts.md`). The prompt instructs Codex to:
  #   - read `git status` for conflicted files
  #   - resolve each conflict preserving the intent of BOTH branches
  #   - `git add` resolved files and `git rebase --continue`
  #   - run the local gate (build/lint/format/test/test:dashboard)
  #
  # On rebase success (clean OR Codex-resolved), run the local gate
  # from the worktree cwd. On failure, append gate_failed and continue
  # to the next repair entry — the repair lock gets released at the
  # end of this iteration regardless.

  if [ "$REPAIR_HAD_CONFLICTS" = "1" ]; then
    # Hand off to Step 7's retry loop in conflict-resolution mode.
    # Set IS_REPAIR=1 and REPAIR_PR=$PR_N so Step 7.5 knows to skip
    # `gh pr create` and take the republish path instead.
    IS_REPAIR=1
    REPAIR_PR=$PR_N
    N=$ISSUE_N
    # Fall through to Step 7 in repair mode — DO NOT continue the loop.
    # This tick spends its remaining budget on this one repair.
    break
  fi

  # Clean rebase — run the local gate directly
  if corepack pnpm install --frozen-lockfile \
     && corepack pnpm run build \
     && corepack pnpm run lint \
     && corepack pnpm run format:check \
     && corepack pnpm test \
     && corepack pnpm run test:dashboard; then
    # Republish: force-with-lease push, relabel, release lock
    git push --force-with-lease "origin" "HEAD:$BUILD_BRANCH"
    gh pr edit "$PR_N" --remove-label queue:blocked --add-label queue:ready
    git push origin --delete "$REPAIR_BRANCH" 2>/dev/null || true
    cd "$MAIN"
    printf '{"ts":"%s","outcome":"rebase_repaired","pr":%s}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PR_N" >> "$REPAIR_ATTEMPTS_FILE"
  else
    printf '{"ts":"%s","outcome":"gate_failed","pr":%s,"stage":"rebase_gate"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PR_N" >> "$REPAIR_ATTEMPTS_FILE"
    git push origin --delete "$REPAIR_BRANCH" 2>/dev/null || true
    cd "$MAIN"
  fi
done
```

**Repair-mode fall-through.** When `IS_REPAIR=1` after the rebase
sweep, the tick skips the normal "Step 5 — Pick the next issue" logic
entirely and flows directly into Step 7 with `$N` set to the linked
issue and `$WT` already in place. Step 7 uses the
`repair-rebase-conflicts.md` prompt template instead of the normal
implementation prompt. Step 7.5 detects `IS_REPAIR=1` and takes the
republish path (force-with-lease + relabel + lock release) instead of
`gh pr create`.

If `IS_REPAIR=0` after this sweep (no rebase candidates or all were
cleanly rebased inline), the tick falls through to Step 4 normally and
claims fresh work.

### Step 4 — Preflight

The main checkout is a launchpad — we don't reset it. We only need a
fresh `origin/main` so the worktree we're about to create is based on
the current tip.

```bash
cd /Users/advena/project/poddershub
git fetch origin main
```

If `git fetch` fails, append tick record `outcome: "preflight_dirty"`,
send a Discord webhook, `ScheduleWakeup(600, "fetch failed, retrying", "/loop /build-codex")`.

### Step 5 — Pick the next issue (resume trumps claim)

**Resume-first rule.** If Step 3 filled `resumable_issues[]`, the tick
picks the first entry from that list — those issues already have
`state:in-progress`, a worktree on disk, and attempt budget remaining.
Resuming them clears blocked-but-repairable work before it rots.

```bash
if [ ${#resumable_issues[@]} -gt 0 ]; then
  N="${resumable_issues[0]}"
  IS_RESUME=1
else
  IS_RESUME=0
  N=""
  for prio in p0 p1 p2 p3; do
    N=$(gh issue list --state open --label state:ready --label "$prio" \
          --limit 1 --json number --jq '.[0].number')
    [ -n "$N" ] && break
  done
fi
```

If `$N` is empty (no resumable issues AND no `state:ready` work across
all priorities):

1. Increment `empty_streak` in loop-state.
2. Append tick record `outcome: "queue_empty"`.
3. If `empty_streak == 5` (or any multiple of 5), send Discord
   "💤 /build-codex idle: queue empty for 5 ticks straight. Next check in 20m."
4. `ScheduleWakeup(1200, "queue empty, backing off 20m", "/loop /build-codex")`.
5. Return.

`empty_streak` increments **only** when BOTH the resume list is empty
AND the priority walk finds nothing. A full queue of resumable in-progress
issues does not count as "empty".

If `$N` is non-empty, set `empty_streak: 0` in loop-state. Read the issue
fully:

```bash
gh issue view $N --json title,body,labels
```

Extract the title, the acceptance criteria (`- [ ]` checkboxes from the
body), and the priority label. You will substitute these into the Codex
prompt template in Step 7.

### Step 6 — Claim OR resume (with cross-tick budget check)

Two paths: **fresh claim** for new `state:ready` work, **resume** for
`state:in-progress` work surfaced by the sweep. The branch-push-as-lock
rule only applies to the fresh claim path — a resume reuses the existing
branch and label.

```bash
MAIN="/Users/advena/project/poddershub"
BRANCH="build/issue-$N"
ATTEMPTS_DIR="$MAIN/.clankerism/attempts"
ATTEMPTS_FILE="$ATTEMPTS_DIR/issue-$N.ndjson"
mkdir -p "$ATTEMPTS_DIR"

# --- 6a. Cross-tick budget check (before touching any branch) ---
if [ -f "$ATTEMPTS_FILE" ]; then
  PRIOR_ATTEMPTS=$(grep -c '^{' "$ATTEMPTS_FILE" 2>/dev/null || echo 0)
  PRIOR_FAILS=$(grep -c '"outcome":"gate_failed"\|"outcome":"hard_error"' "$ATTEMPTS_FILE" 2>/dev/null || echo 0)
else
  PRIOR_ATTEMPTS=0
  PRIOR_FAILS=0
fi

if [ "$PRIOR_FAILS" -ge 5 ]; then
  # Budget already exhausted on a prior tick. Shouldn't normally reach
  # here because the sweep catches this, but defensive.
  gh issue comment $N --body "/build-codex: attempt budget exhausted (5/5). Flipping to state:blocked for human triage."
  gh issue edit $N --remove-label state:in-progress --add-label state:blocked
  # Record soft_failure in loop-state, log, ScheduleWakeup(120), return.
fi

# --- 6b. Decide claim vs resume ---
WT_PATH="$(node "$MAIN/scripts/worktree.mjs" path "issue-$N")"

if [ "$IS_RESUME" = "1" ] || [ -d "$WT_PATH" ]; then
  # RESUME path: worktree exists (from a prior tick), branch is on
  # origin, label is already state:in-progress. Do NOT re-push the
  # branch and do NOT re-flip the label.
  WT=$(node "$MAIN/scripts/worktree.mjs" resume "issue-$N")
  cd "$WT"
else
  # FRESH CLAIM path: the push of build/issue-$N is the lock.
  WT=$(node "$MAIN/scripts/worktree.mjs" claim "issue-$N") || {
    # Worktree already existed or branch already existed — another
    # session probably holds it. Append outcome: "branch_race_lost",
    # ScheduleWakeup(60), return.
    :
  }
  cd "$WT"
  if ! git push -u origin "$BRANCH"; then
    cd "$MAIN"
    node scripts/worktree.mjs release "issue-$N"
    # Append outcome: "branch_race_lost", ScheduleWakeup(60), return.
    :
  fi
  gh issue edit $N --remove-label state:ready --add-label state:in-progress
fi
```

Claude's cwd is now inside the worktree. Step 7 invokes Codex via
`node codex-companion.mjs task --cwd <worktree> --write` directly via
Bash — not through the `codex:codex-rescue` Agent — so Codex's sandbox
root lands on the worktree regardless of Claude's process cwd. Codex
will edit files and run the local gate; all git/gh writes happen from
Claude in Step 7.5.

Before Step 7 runs for the first time on a given worktree, Claude must
ensure `node_modules` exists in the worktree. Fresh `git worktree add`
directories start without dependencies installed — run
`corepack pnpm install --frozen-lockfile` from the worktree cwd once,
at the end of Step 6. The `postinstall` hook inside the worktree may
emit a harmless `mkdir .git: Not a directory` warning because a
worktree's `.git` is a file pointer, not a directory — ignore it.

**Critical**: on the resume path, do not `git push origin "$BRANCH"` and
do not `gh issue edit --remove-label state:ready`. Both are already
done. Re-flipping labels triggers GitHub webhook churn and races with
the sweep.

Record the start timestamp now — Step 9 needs it for the duration field.

### Step 7 — Delegate to Codex (retry loop)

Wrap a direct `node codex-companion.mjs task --cwd <worktree> --write
--prompt-file <prompt>` Bash call in a 3-attempt retry loop. **Do not
use `codex:codex-rescue` here** — the rescue subagent inherits Claude's
process cwd (always the main checkout) and cannot forward `--cwd` to
codex-companion, so its sandbox root would land on the main checkout
instead of the worktree. Direct invocation is the only way to make
Codex's `workspace-write` root equal the worktree. See "Why we bypass
`codex:codex-rescue` here" above for the full mechanism.

Each attempt writes a fresh prompt file, shells out to codex-companion
with the three-line structured status contract, and classifies Codex's
reply. Claude appends the NDJSON attempt record from the main checkout
cwd after every attempt (pass or fail).

```
TICK_MAX=3
TICK_ATTEMPT=1
REMAINING=$(( 5 - PRIOR_FAILS ))
TICK_CAP=$(( REMAINING < TICK_MAX ? REMAINING : TICK_MAX ))

# Seed cross-tick failure context if this is a resume.
if [ "$PRIOR_FAILS" -gt 0 ]; then
  # Last record from the NDJSON becomes the prior-failure log Codex sees
  # on attempt 1 of this tick.
  PRIOR_FAILURE_LOG=$(tail -n 1 "$ATTEMPTS_FILE" \
    | jq -r '"Attempt \(.attempt) failed at \(.gate_step):\n\(.output_excerpt)"' 2>/dev/null)
else
  PRIOR_FAILURE_LOG=""
fi

START_TS=$(date +%s%3N)

CODEX_COMPANION="/Users/advena/.claude/plugins/cache/openai-codex/codex/1.0.2/scripts/codex-companion.mjs"

while [ "$TICK_ATTEMPT" -le "$TICK_CAP" ]; do
  # --- Render the prompt file (substitute N, TITLE, ACCEPTANCE, etc.) ---
  PROMPT_FILE="/tmp/codex-prompt-${N}-${TICK_ATTEMPT}.md"
  CODEX_OUT_FILE="/tmp/codex-out-${N}-${TICK_ATTEMPT}.txt"
  # ... build $PROMPT_FILE from the template below ...

  # --- Direct Bash invocation of codex-companion. NOT codex:codex-rescue.
  # --cwd <worktree> is the whole point: resolveWorkspaceRoot(cwd) returns
  # the worktree path, so Codex's workspace-write sandbox lands on the
  # worktree and edits succeed. No --model, no --effort (match rescue
  # defaults). --write enables workspace-write mode.
  #
  # IMPORTANT: Claude invokes this Bash call with run_in_background: true
  # and waits for the task-notification — NOT with a subshell `$(...)`
  # capture. Two reasons:
  #   1. Direct `> file 2>&1` redirection writes the codex trace to
  #      disk as it arrives, so Claude can `tail -f` or Read the file
  #      mid-attempt for live progress. A subshell `$(... 2>&1)` buffers
  #      the whole trace until the process exits — no visibility during
  #      long refactors (10–20 min is routine).
  #   2. Bash run_in_background + task-notification lets Claude's loop
  #      proceed without blocking on the conversation thread. The
  #      notification fires on process exit, replacing ScheduleWakeup
  #      polling for attempt-in-flight.
  # Still no codex-companion `--background` flag (that spawns a detached
  # codex session and only returns a job id — breaks the structured
  # status contract). The direct-to-file foreground-but-bash-backgrounded
  # pattern is the right default.
  node "$CODEX_COMPANION" task \
    --cwd "$WT" \
    --write \
    --prompt-file "$PROMPT_FILE" > "$CODEX_OUT_FILE" 2>&1

  # --- Parse Codex's structured status. Codex's LAST message must end
  # with exactly three lines:
  #   STATUS=passing            (or gate_failed or hard_error)
  #   GATE_STEP=<step>          (build|lint|format:check|test|test:dashboard|adversarial-review|none)
  #   EXCERPT_PATH=<path>       (relative or absolute; "none" if passing)
  # Parse the last 3 non-empty lines of $CODEX_OUT_FILE. If the contract
  # is violated, treat as hard_error.
  LAST_LINES=$(awk 'NF' "$CODEX_OUT_FILE" | tail -n 3)
  STATUS=$(echo "$LAST_LINES" | grep '^STATUS=' | cut -d= -f2)
  GATE_STEP=$(echo "$LAST_LINES" | grep '^GATE_STEP=' | cut -d= -f2)
  EXCERPT_PATH=$(echo "$LAST_LINES" | grep '^EXCERPT_PATH=' | cut -d= -f2)
  if [ -z "$STATUS" ] || [ -z "$GATE_STEP" ] || [ -z "$EXCERPT_PATH" ]; then
    STATUS=hard_error
    GATE_STEP=none
    EXCERPT_PATH=none
  fi

  # --- Load the excerpt file Codex wrote (if any). ---
  EXCERPT=""
  if [ "$EXCERPT_PATH" != "none" ] && [ -f "$EXCERPT_PATH" ]; then
    EXCERPT=$(sed -e 's/\x1b\[[0-9;]*m//g' "$EXCERPT_PATH" | head -n 40)
  fi

  # --- Compute diff summary from worktree against origin/main. ---
  DIFF_NUMSTAT=$(git -C "$WT" diff --numstat origin/main 2>/dev/null)
  FILES_CHANGED=$(echo "$DIFF_NUMSTAT" | wc -l | tr -d ' ')
  LINES_ADDED=$(echo "$DIFF_NUMSTAT" | awk '{a+=$1} END {print a+0}')
  LINES_REMOVED=$(echo "$DIFF_NUMSTAT" | awk '{r+=$2} END {print r+0}')

  # --- Append NDJSON record (CLAUDE writes, from MAIN checkout path). ---
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  GLOBAL_ATTEMPT=$((PRIOR_ATTEMPTS + TICK_ATTEMPT))
  jq -nc \
    --arg ts "$TS" \
    --arg tick_id "$TICK_ID" \
    --argjson attempt "$GLOBAL_ATTEMPT" \
    --arg run "build-codex" \
    --arg outcome "$STATUS" \
    --arg gate_step "$GATE_STEP" \
    --arg excerpt "$EXCERPT" \
    --argjson files_changed "$FILES_CHANGED" \
    --argjson lines_added "$LINES_ADDED" \
    --argjson lines_removed "$LINES_REMOVED" \
    '{ts:$ts, tick_id:$tick_id, attempt:$attempt, run:$run, outcome:$outcome, gate_step:$gate_step, output_excerpt:$excerpt, diff_summary:{files_changed:$files_changed, lines_added:$lines_added, lines_removed:$lines_removed}, terminal:false}' \
    >> "$ATTEMPTS_FILE"

  if [ "$STATUS" = "passing" ]; then
    break   # go to Step 7.5 (publish)
  fi

  if [ "$STATUS" = "hard_error" ]; then
    # Codex has given up. Don't burn more tick budget on the same issue.
    # Step 8 will classify this tick's outcome.
    break
  fi

  # gate_failed — feed the excerpt back in for the next attempt.
  PRIOR_FAILURE_LOG="Attempt $TICK_ATTEMPT of $TICK_CAP failed at step '$GATE_STEP':\n$EXCERPT"
  TICK_ATTEMPT=$((TICK_ATTEMPT + 1))
done

END_TS=$(date +%s%3N)
DURATION_MS=$((END_TS - START_TS))
```

If the loop exits with `STATUS != "passing"` (either exhausted `TICK_CAP`
or a `hard_error`), **skip Step 7.5 entirely** and fall through to the
verify + cleanup path. Step 8 will classify as `soft_failure` (budget
or gate_failed) or `hard_failure` (hard_error / contract violation).

#### Codex prompt template

Substitute `<N>`, `<BRANCH>`, `<WT_PATH>`, `<TITLE>`, `<ACCEPTANCE>`,
`<TICK_ATTEMPT>`, and `<PRIOR_FAILURE_LOG>` (empty string if this is the
very first attempt for a fresh issue).

```
You are working in a git worktree at <WT_PATH> on branch <BRANCH>. The
worktree is sandboxed — you can edit source files and run local commands,
but you CANNOT run `git commit`, `git push`, `git stash`, `gh pr create`,
`gh pr merge`, or `gh issue edit`. Those are Claude's job. Stay out of
.git/, and do NOT modify anything under .clankerism/.

Your job for this attempt:

1. Read GitHub issue #<N> ("<TITLE>") and its acceptance criteria below.
2. Produce the smallest diff that satisfies the acceptance criteria.
3. **Pre-flight hygiene (mandatory before the gate).** After your last
   edit and before step 4, run Prettier in --write mode on every file
   you just touched so the `format:check` step is a guaranteed no-op:
     corepack pnpm exec prettier --write <path1> <path2> ...
   A `format:check` failure at the end of a 10–20 minute refactor wastes
   a retry budget. Prevent it by formatting your own edits first. You
   may also run `corepack pnpm exec prettier --write src/ dashboard/src/
   test/` as a blanket sweep if you edited a wide slice — it's
   idempotent and safe.
4. Run the local CI gate in this exact order, short-circuiting on the
   first failing step. Prefix every command with `corepack` because
   `pnpm` is not on the sandboxed shell's PATH — `corepack pnpm …` is:
     corepack pnpm run build
     corepack pnpm run lint
     corepack pnpm run format:check
     corepack pnpm test
     corepack pnpm run test:dashboard
5. On the FIRST failure, stop, capture the last 40 lines of output to
   <WT_PATH>/codex-attempt-<TICK_ATTEMPT>.log, and return the structured
   status below.

Acceptance criteria for issue #<N>:
<ACCEPTANCE>

Hard rules:
- Do NOT run git commit, git push, git stash, gh pr create, gh pr merge,
  gh pr edit, gh issue edit, gh issue comment, gh pr comment, or any
  label-mutating gh command. Claude will handle all of that.
- Do NOT touch .clankerism/, .git/, .github/, scripts/hooks/, or the
  pre-push hook.
- Do NOT use --no-verify, --no-gpg-sign, force operations, or CLANKERISM_ALLOW_*
  environment overrides.
- One issue per session. No drive-by refactors. No bundled PRs.
- Fix the ROOT CAUSE of the PRIOR ATTEMPT FAILURE CONTEXT below (if any).
  Do not resubmit the same diff hoping for a different result.

<!-- Only present if PRIOR_FAILURE_LOG is non-empty -->
PRIOR ATTEMPT FAILURE CONTEXT:
<PRIOR_FAILURE_LOG>
<!-- end prior attempt section -->

Final message contract — your LAST message MUST end with exactly three
lines, one per line, no extra whitespace:
  STATUS=passing
  GATE_STEP=none
  EXCERPT_PATH=none

If a gate failed, the three lines are:
  STATUS=gate_failed
  GATE_STEP=<build|lint|format:check|test|test:dashboard|adversarial-review>
  EXCERPT_PATH=<WT_PATH>/codex-attempt-<TICK_ATTEMPT>.log

If you hit an unrecoverable error (tooling, environment, acceptance
criteria impossible):
  STATUS=hard_error
  GATE_STEP=none
  EXCERPT_PATH=<WT_PATH>/codex-attempt-<TICK_ATTEMPT>.log

Full conventions in CLAUDE.md. Reference skill:
`.claude/skills/build/SKILL.md` — execute Steps 3 (Understand), 4 (Plan),
5 (Implement & verify), and 6 (Adversarial review). SKIP Steps 7–9
(commit/push/watch/exit) — those belong to Claude.
```

#### Repair-conflict prompt variant (`IS_REPAIR=1` only)

When Step 3b handed a rebase-repair to Step 7 with conflicts in
flight, use this prompt instead. `<WT_PATH>` is the same worktree
Step 3b left mid-rebase. The expected local gate sequence is
identical, but the first job is resolving conflict markers, not
implementing from an issue body.

```
You are working in a git worktree at <WT_PATH> on branch <BRANCH>.
A git rebase is currently IN PROGRESS — running `git status` will
show files with conflict markers. The worktree is sandboxed — you
can edit source files, `git add`, and `git rebase --continue`, but
you CANNOT run `git push`, `git commit --amend`, `git reset --hard`,
`gh pr create`, `gh pr merge`, or `gh issue edit`. Those are Claude's
job. Stay out of `.git/`, and do NOT modify anything under
`.clankerism/`.

Your job for this attempt:

1. Run `git status` to see the conflicted files.
2. For each conflicted file:
   - Read the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
   - Resolve by preserving the intent of BOTH sides. Our branch adds
     new behavior (read GitHub issue #<N> "<TITLE>" for intent);
     main may have refactored the surrounding code. Keep the new
     behavior working on top of the refactor.
   - Do NOT wholesale discard either side. If you truly cannot
     reconcile, return `STATUS=hard_error`.
3. `git add` every resolved file.
4. `git rebase --continue`. If more conflicts appear, loop back to
   step 2. If the rebase finishes cleanly, continue.
5. **Pre-flight hygiene.** Run Prettier in --write mode on every
   file you touched:
     corepack pnpm exec prettier --write <path1> <path2> ...
6. Run the local CI gate in order:
     corepack pnpm run build
     corepack pnpm run lint
     corepack pnpm run format:check
     corepack pnpm test
     corepack pnpm run test:dashboard
7. On the FIRST failure, stop, capture the last 40 lines of output
   to <WT_PATH>/codex-attempt-<TICK_ATTEMPT>.log, and return the
   structured status below.

Linked issue context (original intent of the branch you're rebasing):
<ACCEPTANCE>

Hard rules:
- Do NOT run git push, git commit --amend, git reset --hard, gh pr
  create, gh pr merge, gh pr edit, gh issue edit, or any label-
  mutating gh command. Claude will handle all of that.
- Do NOT touch .clankerism/, .git/, .github/, scripts/hooks/, or the
  pre-push hook.
- Do NOT use --no-verify, --no-gpg-sign, force operations, or
  CLANKERISM_ALLOW_* environment overrides.
- Fix the ROOT CAUSE of the PRIOR ATTEMPT FAILURE CONTEXT below (if
  any). Do not resubmit the same resolution hoping for a different
  result.

<!-- Only present if PRIOR_FAILURE_LOG is non-empty -->
PRIOR ATTEMPT FAILURE CONTEXT:
<PRIOR_FAILURE_LOG>
<!-- end prior attempt section -->

Final message contract — same as the fresh-implementation prompt:
  STATUS=passing / gate_failed / hard_error
  GATE_STEP=<build|lint|format:check|test|test:dashboard|rebase>
  EXCERPT_PATH=<WT_PATH>/codex-attempt-<TICK_ATTEMPT>.log or `none`
```

On `passing`, Step 7.5 takes the repair-republish fork. On
`gate_failed` or `hard_error` exhausting the repair budget, Step 8
records the failure to
`.clankerism/attempts/repair-pr-<PR>.ndjson`, deletes the
`repair/pr-<PR>` lock branch, flips the linked issue back to
`state:blocked`, and schedules the next tick.

Three invariants the retry loop depends on:

- **No codex-companion `--background` flag.** Never pass `--background`
  to `codex-companion.mjs task` — that spawns a detached codex session
  and only returns a job id, breaking the three-line structured status
  contract. The task itself runs in codex-companion's foreground mode.
- **Claude runs the Bash call with `run_in_background: true`.** That's
  Claude's Bash tool, not codex-companion's flag — the two are
  unrelated. Backgrounding the Bash call lets Claude's conversation loop
  proceed while the codex trace streams directly to `$CODEX_OUT_FILE`;
  Claude receives a `<task-notification>` on process exit and resumes
  the retry loop then. The trace is also available for live `tail -f`
  or `Read` mid-attempt because it goes straight to disk (no subshell
  buffering). This replaces fixed-delay `ScheduleWakeup` polling for
  attempt-in-flight waits.
- **The three-line final-message contract is the integration point.**
  Claude parses the last 3 lines of Codex's last assistant message. If
  Codex omits any line or uses a different format, Claude treats the
  attempt as `hard_error` and does not retry within the tick.
- **`PRIOR_FAILURE_LOG` is empty** for attempt 1 of a fresh issue. For
  attempt 2+ of the same tick, it's the excerpt from attempt N-1. For
  attempt 1 of a **resumed** issue (`PRIOR_FAILS > 0`), it's the last
  record from the NDJSON file — so Codex sees failures from prior ticks.
  Don't substitute an empty `PRIOR_FAILURE_LOG`; remove the whole
  section from the prompt instead.

### Step 7.5 — Claude publishes (only when Step 7 returned `passing`)

Claude commits, pushes, opens the PR, watches CI, optionally pushes one
fix commit, and merges. **Codex never touches git here.**

#### Repair-republish fork (`IS_REPAIR=1`)

If this tick came from the blocked-repair path in Step 3b, the PR
already exists — Step 7.5 does **not** open a new PR. Instead:

1. `git add -A && git rebase --continue` to finish any in-flight
   rebase Codex resolved. If there's no in-flight rebase (clean
   rebase case already handled in Step 3b), the commits are already
   on `HEAD`.
2. `git push --force-with-lease origin HEAD:build/issue-$N` — the
   force push is the whole point of the repair; refuse to force if
   upstream moved under us (that's what `--force-with-lease` enforces).
3. `gh pr edit "$REPAIR_PR" --remove-label queue:blocked --add-label queue:ready`
4. `git push origin --delete repair/pr-$REPAIR_PR` — release the
   repair lock so a future tick can re-enter if needed.
5. Append `{"outcome":"rebase_repaired","pr":$REPAIR_PR}` to
   `.clankerism/attempts/repair-pr-$REPAIR_PR.ndjson`.
6. **Do NOT** `rm $ATTEMPTS_FILE` or release the worktree. The issue
   is still `state:in-progress` and the normal zombie sweep on the
   next tick will reconcile it if `/queue` merges the PR.
7. Classify this tick as `clean_win_repair` for Step 8 (treat like
   `clean_win` for cadence purposes — schedule a fast next tick).

The normal fresh-claim path below runs only when `IS_REPAIR=0`.

#### Fresh-claim publish path (`IS_REPAIR=0`)

```bash
# --- Commit + push (Claude's cwd is still inside $WT) ---
git add -A
COMMIT_BODY="$(jq -r '.output_excerpt // ""' <(tail -n 1 "$ATTEMPTS_FILE"))"
git commit -m "$(cat <<EOF
$TITLE

$COMMIT_BODY

Fixes #$N

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
Co-Authored-By: Codex via codex-companion <noreply@anthropic.com>
EOF
)"
git push -u origin "$BRANCH"

# --- Open PR ---
# Derive `## Lock group` and `## Write set` from git state so the
# serialized queue's metadata gate passes without a human touching the
# PR body. Scout-style issues don't carry those sections explicitly, so
# we compute them here:
#
#   * WRITE_SET = files the PR actually changed (git diff against main)
#   * LOCK_GROUP = the most common 2-segment module prefix of those
#     files (e.g. `src/process/summarize.ts` → `process/summarize`,
#     `dashboard/src/routes/Chat.tsx` → `src/routes`). Fallback `misc`
#     when nothing resolves (zero-file PRs never reach this block).
WRITE_SET=$(git diff --name-only origin/main...HEAD | sort -u)
LOCK_GROUP=$(printf '%s\n' "$WRITE_SET" | awk -F/ '
  NF >= 3 && ($1 == "src" || $1 == "dashboard") { print $2 "/" $3; next }
  NF >= 2 { print $1 "/" $2; next }
  { print $1 }
' | sort | uniq -c | sort -rn | awk 'NR==1 {print $2}')
LOCK_GROUP=${LOCK_GROUP:-misc}

PR_URL=$(gh pr create --base main --head "$BRANCH" \
  --title "$TITLE" \
  --body "$(cat <<EOF
## Summary

$COMMIT_BODY

## Linked issue
Fixes #$N

## Lock group

$LOCK_GROUP

## Write set

$WRITE_SET
EOF
)")
PR_NUMBER=$(gh pr view "$PR_URL" --json number --jq '.number')

# --- Parallel-mode fork: hand off to /queue instead of watching CI here ---
# When $PARALLEL_MODE=1 (the `.clankerism/PARALLEL` sentinel is set in
# Step 1), the serialized merge gate lives in a separate `/queue`
# session. This tick labels the PR `queue:ready`, classifies the
# outcome as `handed_to_queue`, and exits immediately — it does NOT
# run `gh run watch`, does NOT attempt a remote fix commit, and does
# NOT release the worktree or delete the NDJSON. The worktree stays
# in place because a red CI in /queue flips the issue to
# `state:blocked`, and a future repair tick reads the NDJSON.
if [ "$PARALLEL_MODE" = "1" ]; then
  gh pr edit "$PR_NUMBER" --add-label queue:ready
  CLASSIFICATION=handed_to_queue
  # Fall through to Step 8 — the reconciliation table handles the
  # handed_to_queue classification (no label flip, no cleanup, schedule
  # next tick).
else

# --- Wait for the first run to register, then capture its ID ---
sleep 5
RUN_ID=$(gh run list --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId')

REMOTE_FIX_USED=0
while :; do
  if gh run watch "$RUN_ID" --exit-status; then
    # --- GREEN: merge, label cleanup, worktree release, exit clean_win ---
    gh pr merge "$PR_NUMBER" --squash --delete-branch 2>/dev/null || true
    gh issue edit $N --remove-label state:in-progress 2>/dev/null || true
    cd "$MAIN"
    rm -f "$ATTEMPTS_FILE"
    node scripts/worktree.mjs release "issue-$N"
    CLASSIFICATION=clean_win
    break
  fi

  # --- RED: decide whether a fix commit is allowed ---
  if [ "$REMOTE_FIX_USED" -eq 1 ]; then
    # We already burned our one fix commit. Block.
    CLASSIFICATION=hard_failure
    break
  fi

  # Budget check (CI failure counts toward the 5-attempt ceiling).
  CURRENT_FAILS=$(grep -c '"outcome":"gate_failed"\|"outcome":"hard_error"' "$ATTEMPTS_FILE" 2>/dev/null || echo 0)
  if [ "$((CURRENT_FAILS + 1))" -ge 5 ]; then
    CLASSIFICATION=soft_failure   # budget exhaustion, not a crash
    break
  fi

  # --- Capture the failure log from the remote CI run ---
  FAILURE_LOG=$(gh run view "$RUN_ID" --log-failed 2>/dev/null \
    | sed -e 's/\x1b\[[0-9;]*m//g' | head -n 40)

  # Append an NDJSON record for the remote-ci failure.
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  GLOBAL_ATTEMPT=$((CURRENT_FAILS + 1))
  jq -nc \
    --arg ts "$TS" --arg tick_id "$TICK_ID" --argjson attempt "$GLOBAL_ATTEMPT" \
    --arg run "build-codex" --arg outcome "gate_failed" --arg gate_step "remote-ci" \
    --arg excerpt "$FAILURE_LOG" \
    '{ts:$ts, tick_id:$tick_id, attempt:$attempt, run:$run, outcome:$outcome, gate_step:$gate_step, output_excerpt:$excerpt, diff_summary:null, terminal:false}' \
    >> "$ATTEMPTS_FILE"

  # --- Re-delegate a ONE-SHOT fix to Codex via the same direct
  # codex-companion invocation. Use FAILURE_LOG as PRIOR_FAILURE_LOG,
  # TICK_ATTEMPT = remote-fix, NO retry loop around this call. Codex
  # writes its own excerpt to <WT>/codex-attempt-remote-fix.log and
  # must end with the same 3-line contract. Local gate must pass before
  # Claude pushes the fix.

  FIX_PROMPT_FILE="/tmp/codex-prompt-${N}-remote-fix.md"
  FIX_OUT_FILE="/tmp/codex-out-${N}-remote-fix.txt"
  # ... build $FIX_PROMPT_FILE ...
  # Same direct-to-file + Bash run_in_background pattern as Step 7.
  node "$CODEX_COMPANION" task \
    --cwd "$WT" \
    --write \
    --prompt-file "$FIX_PROMPT_FILE" > "$FIX_OUT_FILE" 2>&1
  LAST_LINES=$(awk 'NF' "$FIX_OUT_FILE" | tail -n 3)
  # parse STATUS GATE_STEP EXCERPT_PATH as before
  FIX_EXCERPT=$(sed -e 's/\x1b\[[0-9;]*m//g' "$EXCERPT_PATH" 2>/dev/null | head -n 40)

  # Append the fix attempt record.
  jq -nc ... >> "$ATTEMPTS_FILE"

  if [ "$STATUS" != "passing" ]; then
    # Local gate on the fix also failed — don't push a broken fix.
    CLASSIFICATION=hard_failure
    break
  fi

  # --- Push the fix commit ---
  git add -A
  git commit -m "fix(ci): address CI failure on #$N

$FAILURE_LOG

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
Co-Authored-By: Codex via codex-companion <noreply@anthropic.com>"
  git push

  REMOTE_FIX_USED=1

  # --- Poll for the new run ID (gh run watch watches a specific run ID,
  # not the branch, so we must re-query) ---
  sleep 5
  NEW_RUN_ID="$RUN_ID"
  POLL_DEADLINE=$(( $(date +%s) + 30 ))
  while [ "$NEW_RUN_ID" = "$RUN_ID" ] && [ "$(date +%s)" -lt "$POLL_DEADLINE" ]; do
    NEW_RUN_ID=$(gh run list --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId')
    [ "$NEW_RUN_ID" = "$RUN_ID" ] && sleep 3
  done
  if [ "$NEW_RUN_ID" = "$RUN_ID" ]; then
    # New run never materialized — likely a skipped workflow.
    CLASSIFICATION=hard_failure
    break
  fi
  RUN_ID="$NEW_RUN_ID"
  # loop back to gh run watch
done

fi   # end of if [ "$PARALLEL_MODE" = "1" ]; then ... else ... fi
```

**Race guard**: before any final `gh issue edit --add-label state:blocked`
in the cleanup path, re-read the labels — if a human has already set
`state:blocked`, skip the flip (human intervention wins).

**Concurrency note**: running `/queue` in parallel is safe. The queue's
`gh pr merge`, `gh issue edit`, and `worktree.mjs release` are all
idempotent; if the queue reached the PR first, Claude's calls above
fail harmlessly under `|| true`.

### Step 8 — Verify outcome and finalize

Step 7 already set `CLASSIFICATION` for the happy path. If Step 7
returned `passing` and Step 7.5 ran to completion, `CLASSIFICATION` is
already one of `clean_win`, `soft_failure`, or `hard_failure`. If Step 7
exited early (Codex never reached `passing`), classify now:

```bash
if [ -z "$CLASSIFICATION" ]; then
  if [ "$STATUS" = "hard_error" ]; then
    CLASSIFICATION=hard_failure
  else
    # Exhausted TICK_CAP with gate_failed every attempt.
    CLASSIFICATION=soft_failure
  fi
fi
```

Then reconcile with the current GitHub state (defense against missed
state transitions — a concurrent `/queue` merge, a human flipping the
label, a network blip mid-publish):

```bash
gh issue view $N --json state,labels,closedAt
gh pr list --head "$BRANCH" --state all \
  --json number,state,mergedAt,statusCheckRollup --jq '.[0]'
```

| CLASSIFICATION from Step 7/7.5 | Reconciliation with live state | Final outcome + cleanup |
|---|---|---|
| `clean_win` (merged in 7.5) | Issue closed, label cleared, worktree released, NDJSON deleted | nothing more to do |
| `handed_to_queue` (parallel-mode fork ran) | PR open with `queue:ready` label, issue still `state:in-progress` | Do NOT flip labels, do NOT release the worktree, do NOT delete the NDJSON. The `/queue` session will merge (or flip to `queue:blocked` → sweep picks up as repair) on its own cadence. Schedule next tick at the `clean_win` cadence so the loop can grab more work. |
| `soft_failure` (budget/TICK_CAP) | Still `state:in-progress` | Comment "attempt budget exhausted after $TICK_ATTEMPT tick attempts, $PRIOR_FAILS prior runs", flip → `state:blocked` (but re-read labels first and skip if human already set `state:blocked`), append `terminal:true` marker to NDJSON, **leave** worktree + NDJSON for `/fix` |
| `hard_failure` (hard_error, contract violation, fix-commit path failed) | Still `state:in-progress`, PR may or may not exist | Comment with Codex's last 200 chars of output, flip → `state:blocked` (race-guarded), append `terminal:true`, leave worktree + NDJSON |
| PR open, all checks SUCCESS but not merged (anomaly) | Merge step never ran in 7.5 | `wait_in_flight` — log "anomaly: green CI but not merged", do not flip labels |
| User already set `state:blocked` mid-run | any | Honor it — do not re-flip, classify as `soft_failure`, leave everything |

Cleanup for `soft_failure` and `hard_failure`:

```bash
# Race-guard the label flip. If a human beat us to it, skip.
CURRENT_LABELS=$(gh issue view $N --json labels --jq '.labels[].name' | tr '\n' ' ')
if ! echo "$CURRENT_LABELS" | grep -q 'state:blocked'; then
  gh issue comment $N --body "/build-codex tick end: $CLASSIFICATION after $TICK_ATTEMPT attempts (prior failed: $PRIOR_FAILS). Duration: ${DURATION_MS}ms."
  gh issue edit $N --remove-label state:in-progress --add-label state:blocked
fi

# Append terminal marker to NDJSON (from MAIN, not worktree).
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
jq -nc --arg ts "$TS" --arg tick_id "$TICK_ID" \
  '{ts:$ts, tick_id:$tick_id, attempt:null, run:"build-codex", outcome:"terminal", gate_step:null, output_excerpt:"flipped to state:blocked", diff_summary:null, terminal:true}' \
  >> "$ATTEMPTS_FILE"

# Leave the worktree + NDJSON for a future repair session. DO NOT release
# them on soft_failure/hard_failure — /fix reads the NDJSON to see what
# Codex tried.
cd "$MAIN"
```

**Critical**: on `soft_failure`/`hard_failure`, do NOT `git push origin
--delete "$BRANCH"` and do NOT `worktree.mjs release`. The worktree and
the branch are the repair-session scaffolding. The only path that
releases them is `clean_win` (handled in Step 7.5) and the sweep's
closed-merged path on a future tick.

For `wait_in_flight`, do not flip labels and do not touch the NDJSON.
Step 9 schedules a 120s wakeup so the next tick can re-verify.

### Step 9 — Update state, log, and decide next tick

**Update `.clankerism/loop-state.json`**:

| Outcome | `consecutive_failures` change |
|---------|-------------------------------|
| `clean_win` | reset to 0 |
| `handed_to_queue` | reset to 0 (parallel-mode handoff is a success from this tick's perspective — /queue owns the merge outcome) |
| `soft_failure` | += 1 |
| `hard_failure` | += 1 |
| `wait_in_flight` | unchanged |
| `queue_empty` | unchanged |
| `preflight_dirty` | unchanged |
| `branch_race_lost` | unchanged |

Always update `last_outcome`, `last_tick_ts` (epoch ms), `last_issue`.

**Append a record to `.clankerism/loop-log.ndjson`** (single line, no pretty-print):

```json
{"ts":"2026-04-11T05:14:22Z","tick_id":"01HXXXX","issue":142,"branch":"build/issue-142","outcome":"clean_win","duration_ms":712340,"consecutive_failures_after":0,"notes":""}
```

Use `tick_id` = current epoch ms in hex (or any unique short string).
The file is append-only audit history — never rewrite or truncate it.

**Discord on hard failure** (regardless of breaker state):

```
⚠️ /build-codex hard failure on #<N>: Codex did not open/merge a PR. Flipped to state:blocked.
```

**Circuit breaker check**: if `consecutive_failures >= 3`:

```bash
cat > .clankerism/PAUSED <<EOF
Loop circuit breaker tripped at $(date -u +%FT%TZ).
Reason: 3 consecutive failed ticks.
Last issue: #$LAST_ISSUE ($LAST_OUTCOME).
Resume by removing this file and re-running /loop /build-codex.
EOF
```

Send Discord:
```
🛑 /build-codex circuit breaker: 3 consecutive failures. Last issue: #<N> (<outcome>). PAUSED brake engaged.
```

**Do NOT call ScheduleWakeup.** The loop ends here.

**Otherwise**, schedule the next tick:

| Outcome | Delay | Reason string |
|---------|-------|---------------|
| `clean_win` | 60s | "tick clean, checking queue" |
| `handed_to_queue` | 60s | "handed PR to /queue, checking next issue" |
| `soft_failure` | 120s | "soft failure, brief cooldown" |
| `hard_failure` | 180s | "hard failure, longer cooldown" |
| `wait_in_flight` | 120s | "in-flight PR still running CI" |
| `queue_empty` | 1200s | "queue empty, 20m backoff" |
| `preflight_dirty` | 600s | "preflight dirty, retrying" |
| `branch_race_lost` | 60s | "branch race lost, retrying with next" |

```
ScheduleWakeup({
  delaySeconds: <delay>,
  reason: "<reason>",
  prompt: "/loop /build-codex"
})
```

The tick ends. The harness fires `/loop /build-codex` again at the
scheduled time, and the cycle repeats.

---

## State file: `.clankerism/loop-state.json`

```json
{
  "consecutive_failures": 0,
  "last_outcome": "clean_win",
  "last_tick_ts": 1744377600000,
  "last_issue": 142,
  "empty_streak": 0,
  "paused_notified": false
}
```

- `consecutive_failures`: resets to 0 on `clean_win`. Increments on
  `soft_failure` or `hard_failure`. Unchanged on the rest.
- `paused_notified`: latch so we Discord-notify only the first tick
  after PAUSED is engaged, not every retry.

## Log file: `.clankerism/loop-log.ndjson`

One JSON record per line. Append-only. Greppable:

```bash
grep '"outcome":"hard_failure"' .clankerism/loop-log.ndjson | tail -20
jq -s 'group_by(.outcome) | map({outcome: .[0].outcome, count: length})' .clankerism/loop-log.ndjson
```

Schema:
```json
{
  "ts": "ISO 8601 UTC",
  "tick_id": "short unique string",
  "issue": 142,
  "branch": "build/issue-142",
  "outcome": "clean_win|soft_failure|hard_failure|wait_in_flight|queue_empty|paused|preflight_dirty|branch_race_lost",
  "duration_ms": 712340,
  "consecutive_failures_after": 0,
  "notes": ""
}
```

For tick types that don't claim an issue (`paused`, `queue_empty`,
`preflight_dirty`), set `issue: null` and `branch: null`.

## Discord webhook

Posts go to `$ALERT_WEBHOOK_URL` (already in env per CLAUDE.md). Fire
only on these events:

| Event | Message |
|-------|---------|
| Circuit breaker trip | `🛑 /build-codex circuit breaker: 3 consecutive failures. Last issue: #N (outcome). PAUSED brake engaged.` |
| PAUSED brake engaged (first tick after) | `⏸ /build-codex paused: <PAUSED file contents>` |
| Hard failure | `⚠️ /build-codex hard failure on #N: Codex did not open/merge a PR. Flipped to state:blocked.` |
| Empty queue streak (every 5th tick) | `💤 /build-codex idle: queue empty for 5 ticks. Next check in 20m.` |

Posting helper (one line, ignores failures):

```bash
[ -n "$ALERT_WEBHOOK_URL" ] && curl -fsS -m 5 -H 'Content-Type: application/json' \
  -X POST "$ALERT_WEBHOOK_URL" \
  -d "$(jq -nc --arg c "$MSG" '{content:$c}')" || true
```

Discord is observability, not control flow. A failed webhook call must
not abort the tick.

## Failure modes

| Situation | What you do |
|-----------|-------------|
| `.clankerism/PAUSED` exists | Log, Discord (once via latch), exit. No ScheduleWakeup. |
| All priorities empty AND no resumable issues | Log, increment empty_streak, 1200s backoff. |
| Branch push race on fresh claim (origin already has the branch) | Release local worktree, log, 60s retry. |
| `gh` auth expired | Codex surfaces it as `hard_error` → hard_failure. 3 consecutive ticks trip the breaker. |
| Codex hangs / very long Codex session | The Agent call blocks for the full Codex session. The codex-companion runtime has its own timeouts; trust it. If Codex returns with an error, treat as hard_failure. |
| `ALERT_WEBHOOK_URL` unset | Discord helper is a no-op. Loop continues silently. |
| `jq` not installed | Fall back to a heredoc-built JSON string for the curl payload. |
| Cross-tick attempt budget exhausted (`PRIOR_FAILS >= 5`) | Sweep catches it first, comments "budget exhausted", flips to `state:blocked`, records `soft_failure`. If the sweep misses it, Step 6's 6a check catches it. |
| Local tick retries exhausted (`TICK_CAP` Codex attempts all `gate_failed`) | Record `soft_failure`, flip `state:blocked` (race-guarded), append `terminal:true` to NDJSON, leave worktree + NDJSON, 180s cooldown. |
| Codex's final message doesn't end with the 3-line `STATUS=...` contract | Treat as `hard_error` → `hard_failure`. Log the last 200 chars of Codex's output as the NDJSON excerpt. Do not retry within the tick — contract violation usually means a bug in the prompt or the Codex CLI, not a flake. |
| Remote CI goes red on first try, local fix gate passes, pushed fix also goes red | `hard_failure`. No second fix commit. `state:blocked`, leave worktree + NDJSON. |
| Remote CI red, Codex's fix attempt fails its own local gate | `hard_failure`. Do not push a broken fix. `state:blocked`, leave worktree + NDJSON. |
| `gh run list` after fix push returns the old run ID for 30+ seconds | `hard_failure`. Log "CI run never materialized for fix commit". The workflow may have been skipped (paths filter, etc.) — human triage. |
| Attempts NDJSON file cannot be written (disk full, permission) | Append a one-line warning to `loop-log.ndjson`, send a Discord webhook, flip the issue to `state:blocked`, exit. Running without the audit trail would silently overflow the budget. |
| Attempts NDJSON file has a malformed line (partial write from a crash) | Tolerate: count only lines matching `^{`. Counting ignores malformed lines; the audit trail keeps them for inspection. |
| Stale NDJSON file exists but worktree was GC'd | `scripts/worktree.mjs gc` deletes the NDJSON as part of its sweep. Defensive: Step 6 treats a stale NDJSON + no worktree as "fresh claim" after the gc pass. |
| Concurrent `/queue` session merges the PR mid-watch | Step 7.5's `gh pr merge`/`gh issue edit`/`worktree.mjs release` are all idempotent under `|| true`. Duplicate cleanup is harmless. |
| User manually adds `state:blocked` mid-run | Race-guard in the cleanup path re-reads labels before the final `--add-label state:blocked` and skips the flip. Human wins the tie. |
| User manually removes `state:in-progress` mid-run | Next tick's sweep logs a warning ("worktree exists, no in-progress label") and leaves it alone. Human owns it. |

## Hard rules

- **Never run /build-codex outside `/loop /build-codex`.** The skill
  assumes the dynamic-pacing harness will re-fire it on
  `ScheduleWakeup`. Standalone runs execute one tick and exit.
- **Never modify `.clankerism/scout-state.md`.** That belongs to /scout.
- **Never bypass the PAUSED brake.** If PAUSED exists, the loop ends.
- **Never delete `.clankerism/loop-log.ndjson` or
  `.clankerism/loop-state.json`.** They are the audit trail and the
  failure counter.
- **Never call `codex:codex-rescue` from this skill.** The rescue
  subagent cannot forward `--cwd`, so its sandbox root would land on
  the main checkout and every worktree write would fail with
  `operation not permitted`. This skill invokes
  `node codex-companion.mjs task --cwd <worktree> --write
  --prompt-file <file>` directly via Bash. Never pass `--background` —
  the retry loop parses structured status from synchronous stdout.
- **Never push to main from this skill.** Codex never pushes anything.
  The pre-push hook will block main pushes anyway.
- **Never use `--no-verify`** anywhere, in this skill or the Codex prompt.
- **Never run multiple ticks in parallel against the same issue.** The
  branch-push-as-lock in Step 6 makes that a claim race the second
  session will lose (and exit `branch_race_lost`). Multiple sessions
  working on **disjoint issues** is fine and is the whole point of
  parallel mode — see the "Parallel mode" section below. Under parallel
  mode the shared-file writes (`loop-state.json`, `loop-log.ndjson`)
  are protected by the `mkdir`-based lock introduced in Step 1. Per-issue
  files (`attempts/issue-<N>.ndjson`, the per-issue worktree path) are
  already serialized by issue number.
- **Never have Codex run git or gh.** Codex cannot acquire
  `.git/index.lock` inside a worktree because the real `.git` dir lives
  at `<main>/.git/worktrees/issue-<N>/`, outside Codex's sandbox. Claude
  runs every `git commit`, `git push`, `gh pr create`, `gh pr merge`,
  and `gh issue edit`. Codex only edits source files and runs the local
  CI gate via `pnpm`.
- **Never push more than one fix commit per PR per tick.** The budget is
  exactly one remote fix commit. Second red run = `state:blocked`.
  Subsequent fixes happen via a future `/build` repair session on a
  fresh `repair/pr-<N>` lock — a different run entirely.
- **Never write attempt records inside the worktree.**
  `.clankerism/attempts/issue-<N>.ndjson` lives in the main checkout so
  records survive `worktree.mjs release` between ticks. The absolute
  path is `$MAIN/.clankerism/attempts/issue-<N>.ndjson`.
- **Never substitute an empty `PRIOR_FAILURE_LOG`** into the Codex
  prompt. On attempt 1 of a fresh issue, remove the whole "PRIOR
  ATTEMPT FAILURE CONTEXT" section from the prompt template. Substitute
  only when there is real failure context — from a prior tick
  (`PRIOR_FAILS > 0`) or from a prior attempt in this tick
  (`TICK_ATTEMPT > 1`).
- **Never increment `consecutive_failures` more than once per tick.** A
  single tick that burns all 3 local Codex attempts is still one tick
  failure, not three. Increment only on `hard_failure` / `soft_failure`,
  once per tick-level outcome.

## Things you'll be tempted to do and must not

- **Push a second fix commit to an already-failed fix.** No. One fix
  commit per PR per run. Second failure = `state:blocked`. The retry
  system is designed around this cap on purpose.
- **Retry the same Codex prompt hoping CI is flaky.** No. Every retry
  must feed `PRIOR_FAILURE_LOG` back to Codex. If Codex can't make
  progress with failure context, more attempts with the same blind
  prompt won't either.
- **Use `--background` for "throughput".** No. Verification depends on
  parsing Codex's structured status from synchronous stdout of the
  direct `codex-companion.mjs task` call. Background mode returns a
  job ID immediately and breaks everything.
- **Route Codex through `codex:codex-rescue` here.** No. Rescue's
  forwarder strips nothing from `--cwd` but also doesn't pass it to
  codex-companion — it ends up in the natural-language prompt text, so
  codex-companion resolves cwd to Claude's process cwd (the main
  checkout). Sandbox root lands on main, every worktree write fails
  with `operation not permitted`, and you get an attempts file full of
  `hard_error` records. Call codex-companion directly.
- **Skip the sweep on first tick.** No. The sweep is what cleans up
  after a previous Claude session that crashed mid-loop — and what
  surfaces resumable issues for the new retry model.
- **Let Codex commit, push, or merge "just this once".** No. The
  sandbox rationale is architectural (worktree `.git` path is outside
  Codex's writable root). "Just this once" turns into a mysterious
  `index.lock` error and a paused brake.
- **Write attempt records inside the worktree.** No.
  `.clankerism/attempts/` lives in the main checkout. Writing from the
  worktree cwd using a relative path would create ephemeral files that
  vanish on `worktree.mjs release`.
- **Skip writing the attempt record on a pass.** No. The schema counts
  only `outcome != "pass"` toward the 5-attempt ceiling, but `pass`
  records are still part of the audit trail and needed by `/fix` to
  understand what worked before the remote CI failure.
- **Decrement `consecutive_failures` for `wait_in_flight`.** No. It's
  unchanged, not reset. Resetting hides genuine flake patterns.
- **Pick a new `state:ready` issue when a resumable one exists.** No.
  Resume trumps claim. Starving blocked-but-repairable work to chase
  shiny new issues is how the queue rots.
- **Claim two issues "while you're here".** No. One tick, one issue.
  The branch claim (or the resume) is the lock.
- **Pretty-print the NDJSON log.** No. One record per line. Pretty
  formatting breaks `grep '^{'`, `jq -s`, and the malformed-line
  tolerance rule.

## Parallel mode

`/build-codex` is designed for one tick at a time, but the default
serial cadence caps throughput at roughly one issue every 15–30 min.
Parallel mode lets multiple `/build-codex` sessions run at once
(each in its own Claude Code conversation) by making the merge gate
asynchronous: instead of each tick running `gh run watch` and
`gh pr merge` itself, the tick hands the PR off to a separate
`/queue` session that serializes merges across all parallel builders.

### Enabling parallel mode

```bash
touch /Users/advena/project/poddershub/.clankerism/PARALLEL
```

`rm` the file to return to serial mode. The sentinel is checked in
Step 1 of every tick, so flipping it in-flight takes effect on the
next tick. A tick that is currently mid-`gh run watch` will finish its
current merge under whichever mode it started in.

You MUST run a `/queue` loop somewhere (in a separate Claude Code
session, or via the GitHub Action) whenever the `PARALLEL` sentinel is
set. Otherwise PRs pile up at `queue:ready` with nothing to merge them,
and every future tick's sweep will spend time walking the backlog
before finding real zombies.

### What changes per tick

1. **Step 1** reads `.clankerism/PARALLEL` and sets `$PARALLEL_MODE`.
2. **Step 3 sweep** skips any open PR that already has `queue:ready`
   or `queue:deferred` (those are waiting in `/queue`'s lane — not
   zombies for this session to recover).
3. **Step 6** is unchanged. Per-issue worktree paths
   (`<main>-worktrees/issue-<N>`) and branch-push-as-lock give each
   issue a unique writer by construction. Two parallel sessions
   trying to claim the same issue will lose one side's push to
   origin — the loser exits `branch_race_lost` and retries in 60s.
4. **Step 7.5** forks at the top of the publish block:
   - `$PARALLEL_MODE=0` → unchanged: local watch, optional remote
     fix commit, merge, worktree release.
   - `$PARALLEL_MODE=1` → add `queue:ready` label, set
     `CLASSIFICATION=handed_to_queue`, return. No `gh run watch`,
     no merge, no worktree release, no NDJSON wipe. `/queue`
     handles the rest.
5. **Step 8** treats `handed_to_queue` as the parallel-mode success
   path (do not flip labels, leave everything in place).
6. **Step 9** resets `consecutive_failures` on `handed_to_queue` (same
   as `clean_win`) and schedules the next tick at the 60s clean
   cadence.

### Shared state serialization

Multiple parallel ticks race on these shared files:

| File | Protection |
|------|------------|
| `.clankerism/loop-state.json` | `mkdir`-based lock from Step 1 |
| `.clankerism/loop-log.ndjson` | same lock (read-modify-write is really just append, but the lock serializes the writer so records don't interleave mid-line) |
| `.clankerism/PAUSED` | read-only from all sessions; set/removed by humans |
| `.clankerism/PARALLEL` | read-only from all sessions; set/removed by humans |
| `.clankerism/attempts/issue-<N>.ndjson` | per-issue — already serialized by issue number, no lock needed |
| `<main>-worktrees/issue-<N>` | per-issue — already serialized by issue number |

Never hold the lock across a Codex invocation — the call may run for
20 min and would stall every other parallel session. Acquire only for
the short read-modify-write window, release, then fire Codex.

### Backing out

If parallel mode misbehaves (merge queue saturated, attempts files
corrupted, NDJSON log interleaving), pause immediately:

```bash
touch /Users/advena/project/poddershub/.clankerism/PAUSED
rm /Users/advena/project/poddershub/.clankerism/PARALLEL
```

Every in-flight tick will finish its current Codex attempt, honor the
PAUSED brake on its next loop iteration, and exit cleanly. On resume,
the next tick runs under serial mode and the sweep recovers any open
`queue:ready` PRs as normal in-flight work (they're safe to leave —
`/queue` or a future tick will still merge them).
