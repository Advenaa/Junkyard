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

| Layer | Owner |
|-------|-------|
| `cd` to repo, PAUSED brake check | Claude (this skill) |
| Zombie sweep (state:in-progress with no merged PR) | Claude |
| Preflight (clean tree, fetch, reset to origin/main) | Claude |
| Queue scan + atomic branch claim + label flip | Claude |
| Read issue, plan, implement, test, adversarial review | **Codex** |
| Commit, push, open PR, watch CI, merge | **Codex** |
| Clear `state:in-progress` label on success | **Codex** |
| Verify Codex's outcome via `gh` | Claude |
| Failure counter + circuit breaker | Claude |
| NDJSON log + Discord webhook | Claude |
| Schedule next tick | Claude |

If Codex did not produce a merged PR, Claude flips the issue to
`state:blocked` and increments the failure counter. Three consecutive
failures trip the circuit breaker (touch `.clankerism/PAUSED`, exit).

## Working directory

This skill always operates in `/Users/advena/project/poddershub`. The
first action of every tick is `cd /Users/advena/project/poddershub`. The
codex:rescue subagent inherits Claude's cwd, so this `cd` is what gives
Codex the right repo.

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

The sweep cleans up `state:in-progress` issues left behind by a previous
crashed tick. Always run before claiming new work.

```bash
gh issue list --state open --label state:in-progress \
  --json number,title --jq '.[].number'
```

For each issue number `$N`:

```bash
gh pr list --head "build/issue-$N" --state all \
  --json number,state,mergedAt,statusCheckRollup --jq '.[0]'
```

Reconcile by case:

| PR state | Action |
|----------|--------|
| Merged (`mergedAt` non-null) | `gh issue edit $N --remove-label state:in-progress`. Issue is auto-closed; this clears the stale label. |
| Open, all checks `SUCCESS` | Mark `wait_for_in_flight = true`. Don't touch — the previous tick's Codex is still finishing. |
| Open, any check `FAILURE` or `CANCELLED` | `gh issue comment $N --body "Sweep: prior CI failed. Flipping to state:blocked."`, then `gh issue edit $N --remove-label state:in-progress --add-label state:blocked`. |
| No PR returned, branch exists on origin | `gh issue comment $N --body "Sweep: claimed but no PR opened. Re-queueing."`, `gh issue edit $N --remove-label state:in-progress --add-label state:ready`, `git push origin --delete build/issue-$N` (best-effort, ignore errors). |
| No PR, no branch | `gh issue edit $N --remove-label state:in-progress --add-label state:ready`. |

If `wait_for_in_flight` is true after the sweep:
1. Append tick record `outcome: "wait_in_flight"`.
2. `ScheduleWakeup(120, "in-flight PR from prior tick still running CI", "/loop /build-codex")`.
3. Return — do not claim a new issue.

### Step 4 — Preflight

```bash
git fetch origin main
git checkout main
git reset --hard origin/main
test -z "$(git status --porcelain)"
```

If the working tree is not clean after the reset, something is very
wrong. Append tick record `outcome: "preflight_dirty"`, send a Discord
webhook, `ScheduleWakeup(600, "tree dirty, retrying", "/loop /build-codex")`.

### Step 5 — Pick the next ready issue

Walk priorities `p0 → p1 → p2 → p3`:

```bash
N=""
for prio in p0 p1 p2 p3; do
  N=$(gh issue list --state open --label state:ready --label "$prio" \
        --limit 1 --json number --jq '.[0].number')
  [ -n "$N" ] && break
done
```

If `$N` is empty (queue is empty across all priorities):
1. Increment `empty_streak` in loop-state.
2. Append tick record `outcome: "queue_empty"`.
3. If `empty_streak == 5` (or any multiple of 5), send Discord
   "💤 /build-codex idle: queue empty for 5 ticks straight. Next check in 20m."
4. `ScheduleWakeup(1200, "queue empty, backing off 20m", "/loop /build-codex")`.
5. Return.

If `$N` is non-empty, set `empty_streak: 0` in loop-state. Read the issue
fully:

```bash
gh issue view $N --json title,body,labels
```

Extract the title, the acceptance criteria (`- [ ]` checkboxes from the
body), and the priority label. You will substitute these into the Codex
prompt template in Step 7.

### Step 6 — Atomic branch claim

The branch push IS the lock. If the push fails, another agent (or a
stale ref) holds the branch — back off and try the next tick.

```bash
BRANCH="build/issue-$N"
git checkout -b "$BRANCH"
if ! git push -u origin "$BRANCH"; then
  git checkout main
  git branch -D "$BRANCH"
  # Append tick record `outcome: "branch_race_lost"`.
  # ScheduleWakeup(60, "branch race lost, retrying", "/loop /build-codex")
  # Return.
fi
gh issue edit $N --remove-label state:ready --add-label state:in-progress
```

Record the start timestamp now — Step 9 needs it for the duration field.

### Step 7 — Delegate to Codex

Spawn the `codex:codex-rescue` subagent via the Agent tool. The prompt
**must** start with `--wait` so the rescue subagent runs Codex in
foreground. The subagent's default for long tasks is `--background`,
which would return a job ID immediately and break Step 8 verification.

```
Agent({
  description: "Codex /build for issue #<N>",
  subagent_type: "codex:codex-rescue",
  prompt: <substituted template — see below>
})
```

**Prompt template** — substitute `<N>`, `<BRANCH>`, `<TITLE>`, and
`<ACCEPTANCE>` (the bulleted acceptance criteria from Step 5):

```
--wait

Branch `<BRANCH>` is checked out and pushed to origin. Issue #<N>
("<TITLE>") is labeled state:in-progress in the Clankerism queue. Your
job: ship this issue to merged-on-main with no human intervention.

Acceptance criteria for issue #<N>:
<ACCEPTANCE>

Hard rules (non-negotiable):
1. Use a `Fixes #<N>` line in the commit message footer for GitHub
   auto-close.
2. Use `gh run watch <run-id> --exit-status` to block on CI. Do NOT use
   `gh pr merge --auto` — it is unreliable on this free-plan repo.
3. On green CI: `gh pr merge <pr> --squash --delete-branch`, then
   `gh issue edit <N> --remove-label state:in-progress` (GitHub
   auto-closes the issue but does not clear the label).
4. On red CI: do NOT push fix commits. Comment on the issue, flip it to
   state:blocked, exit cleanly.
5. Never use `--no-verify`, `--no-gpg-sign`, force-push to main, amend
   published commits, or modify `.clankerism/scout-state.md`.
6. One issue per session. No drive-by refactors. No bundled PRs.
7. The pre-push hook will reject pushes to main. Don't try to override
   it. Push only to `<BRANCH>`.

Full flow: read `.claude/skills/build/SKILL.md` and execute Steps 3
(Understand the problem) through Step 10 (Exit cleanly). Project
conventions are in `CLAUDE.md`.

Exit when: PR is merged AND label cleared, OR issue is flipped to
state:blocked, OR you hit a hard error you cannot recover from.
```

The Agent call blocks until Codex returns (foreground / `--wait`). When
it returns, record the end timestamp — `end - start` is the
`duration_ms` field for the log record.

### Step 8 — Verify Codex's outcome

Re-query the issue and any PR:

```bash
gh issue view $N --json state,labels,closedAt
gh pr list --head "$BRANCH" --state all \
  --json number,state,mergedAt,statusCheckRollup --jq '.[0]'
```

Classify the outcome:

| Issue state | PR state | Classification | Cleanup |
|-------------|----------|----------------|---------|
| `closed`, no `state:in-progress` label | merged | `clean_win` | none |
| `closed`, still has `state:in-progress` label | merged | `clean_win` | `gh issue edit $N --remove-label state:in-progress` |
| `open`, `state:blocked` label | any | `soft_failure` | none |
| `open`, `state:in-progress` label | open, all checks SUCCESS | `wait_in_flight` | leave alone |
| `open`, `state:in-progress` label | open, any check FAILURE | `hard_failure` | run cleanup below |
| `open`, `state:in-progress` label | no PR | `hard_failure` | run cleanup below |

For any `hard_failure`, Claude itself runs the cleanup:

```bash
gh issue comment $N --body "Loop verification: Codex run did not complete cleanly. Flipping to state:blocked for human triage. Tick: <ts>, duration: <ms>."
gh issue edit $N --remove-label state:in-progress --add-label state:blocked
git checkout main
git branch -D "$BRANCH" 2>/dev/null || true
git push origin --delete "$BRANCH" 2>/dev/null || true
```

For `wait_in_flight` from Step 8 (PR open, CI green, but not yet
merged), do not flip labels. Append tick record `outcome:
"wait_in_flight"`, then in Step 9 schedule a 120s wakeup so the next
tick can re-verify.

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
| Working tree dirty after `git reset --hard` | Should not happen; if it does, log + 600s backoff. |
| All priorities empty (`state:ready` count = 0) | Log, increment empty_streak, 1200s backoff. |
| Branch push race (origin already has the branch) | Cleanup local branch, log, 60s retry. |
| `gh` auth expired | Codex detects it; surfaces as hard_failure. After 3 in a row, breaker stops the loop. |
| Codex hangs / very long Codex session | The Agent call blocks for the full Codex session. The codex-companion runtime has its own timeouts; trust it. If Codex returns with an error, treat as hard_failure. |
| `ALERT_WEBHOOK_URL` unset | Discord helper is a no-op. Loop continues silently. |
| `jq` not installed | Fall back to a heredoc-built JSON string for the curl payload. |

## Hard rules

- **Never run /build-codex outside `/loop /build-codex`.** The skill
  assumes the dynamic-pacing harness will re-fire it on
  `ScheduleWakeup`. Standalone runs execute one tick and exit.
- **Never modify `.clankerism/scout-state.md`.** That belongs to /scout.
- **Never bypass the PAUSED brake.** If PAUSED exists, the loop ends.
- **Never delete `.clankerism/loop-log.ndjson` or
  `.clankerism/loop-state.json`.** They are the audit trail and the
  failure counter.
- **Never call codex:rescue without `--wait` in the prompt.** The
  default for long tasks is background, which breaks verification.
- **Never push to main from this skill.** Codex never pushes to main
  either. The pre-push hook will block it.
- **Never use `--no-verify`** anywhere, in this skill or the Codex prompt.
- **Never run multiple ticks in parallel.** Dynamic pacing serializes
  for a reason — branch claims and label flips need a single writer.

## Things you'll be tempted to do and must not

- **Push a "fix" commit when Codex's PR fails CI.** No. The /build flow
  says `state:blocked` is the answer. Loop respects that.
- **Use `--background` for "throughput".** No. You can't verify if you
  don't wait. Verify is what makes the loop self-healing.
- **Skip the sweep on first tick.** No. The sweep is what cleans up
  after a previous Claude session that crashed mid-loop.
- **Decrement `consecutive_failures` for `wait_in_flight`.** No. It's
  unchanged, not reset. Resetting hides genuine flake patterns.
- **Claim two issues "while you're here".** No. One tick, one claim.
  The branch claim is the lock.
- **Pretty-print the NDJSON log.** No. One record per line. Pretty
  formatting breaks `grep` and `jq -s`.
