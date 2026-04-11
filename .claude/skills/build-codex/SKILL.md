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

### Step 1 — `cd` and load state

```bash
cd /Users/advena/project/poddershub
[ -f .clankerism/loop-state.json ] || cat > .clankerism/loop-state.json <<'EOF'
{"consecutive_failures":0,"last_outcome":"none","last_tick_ts":0,"last_issue":null,"empty_streak":0,"paused_notified":false}
EOF
```

Read `.clankerism/loop-state.json` with the Read tool. You need
`consecutive_failures`, `empty_streak`, and `paused_notified` for later
steps.

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
  # ... build $PROMPT_FILE from the template below ...

  # --- Direct Bash invocation of codex-companion. NOT codex:codex-rescue.
  # --cwd <worktree> is the whole point: resolveWorkspaceRoot(cwd) returns
  # the worktree path, so Codex's workspace-write sandbox lands on the
  # worktree and edits succeed. No --model, no --effort (match rescue
  # defaults). --write enables workspace-write mode. Foreground by
  # default — no --background, no --wait, no --fresh, no --resume.
  CODEX_OUT=$(node "$CODEX_COMPANION" task \
    --cwd "$WT" \
    --write \
    --prompt-file "$PROMPT_FILE" 2>&1) || true

  # --- Parse Codex's structured status. Codex's LAST message must end
  # with exactly three lines:
  #   STATUS=passing            (or gate_failed or hard_error)
  #   GATE_STEP=<step>          (build|lint|format:check|test|test:dashboard|adversarial-review|none)
  #   EXCERPT_PATH=<path>       (relative or absolute; "none" if passing)
  # Parse the last 3 non-empty lines of $CODEX_OUT. If the contract is
  # violated, treat as hard_error.
  LAST_LINES=$(printf '%s\n' "$CODEX_OUT" | awk 'NF' | tail -n 3)
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
3. Run the local CI gate in this exact order, short-circuiting on the
   first failing step. Prefix every command with `corepack` because
   `pnpm` is not on the sandboxed shell's PATH — `corepack pnpm …` is:
     corepack pnpm run build
     corepack pnpm run lint
     corepack pnpm run format:check
     corepack pnpm test
     corepack pnpm run test:dashboard
4. On the FIRST failure, stop, capture the last 40 lines of output to
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

Three invariants the retry loop depends on:

- **Foreground execution is mandatory.** The direct `codex-companion.mjs
  task` call runs in foreground by default — never pass `--background`.
  Structured-status verification depends on parsing the last three lines
  of the synchronous stdout; a queued job only returns a job ID.
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
PR_URL=$(gh pr create --base main --head "$BRANCH" \
  --title "$TITLE" \
  --body "Fixes #$N

<short summary from Codex's last passing attempt>")
PR_NUMBER=$(gh pr view "$PR_URL" --json number --jq '.number')

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
  # ... build $FIX_PROMPT_FILE ...
  FIX_OUT=$(node "$CODEX_COMPANION" task \
    --cwd "$WT" \
    --write \
    --prompt-file "$FIX_PROMPT_FILE" 2>&1) || true
  parse STATUS GATE_STEP EXCERPT_PATH as before
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
- **Never run multiple ticks in parallel.** Dynamic pacing serializes
  for a reason — branch claims, NDJSON appends, and label flips need a
  single writer per issue.
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
