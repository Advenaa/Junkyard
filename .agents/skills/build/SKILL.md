---
name: build
description: Claim one ready issue or resume one queue:blocked PR from the Clankerism queue, ship the fix, and hand it to the serialized queue. This is the consumer half of Clankerism.
---

# /build — Clankerism Consumer

The line cook of the Clankerism kitchen. `/build` does one of two things:

- claims one fresh `state:ready` issue and plates it as a PR
- resumes one open `queue:blocked` PR and hands it back to `/queue`

Never batches issues. Never picks its own work — it always takes the next
claimable ticket.

**Invocation**:

- `/build` — claim the next highest-priority repairable blocked PR or ready issue
- `/build <N>` — work a specific issue number, either as a fresh claim or a blocked repair

`$ARGUMENTS` may contain the issue number.

## Hard rules (never violate)

1. **One issue per run.** If you finish early, exit — don't start a second.
2. **One PR per run.** No "bundled" PRs combining multiple issues.
3. **Claim atomically.** Fresh work is locked by pushing `build/issue-$N` to
   origin. Blocked repairs are locked by pushing `repair/pr-$PR` to origin.
   If the push is rejected, another clanker got there first — exit gracefully,
   do NOT retry with a different name.
4. **Check the PAUSED brake.** If `.clankerism/PAUSED` exists, exit immediately
   with a one-line status. The remote `CLANKERISM_PAUSED` repo variable is
   also authoritative for unattended runs.
5. **Never force-push to main.** Never amend a published commit. Never
   disable hooks (`--no-verify`, `--no-gpg-sign`).
6. **Never modify `.clankerism/scout-state.md`.** That file belongs to
   `/scout`.
7. **Builders never merge.** Builders stop at `queue:ready`. Only `/queue`
   is allowed to merge to `main`.
8. **If the queue blocks the PR, do NOT fight it in the same run.** Leave it
   for a fresh `/build` repair run, `/fix`, or a human.
9. **Always release the repair lock branch.** If you claimed `repair/pr-$PR`,
   delete that remote lock branch before you exit, whether the repair worked or
   not.

## Preflight

```bash
# 1. Hard stop if brake is on
if ! corepack pnpm run clanker:status -- --exit-code-if-paused; then
  echo "PAUSED brake engaged — exiting"
  exit 0
fi

# 2. Must be on main, clean working tree
git fetch origin main
if [ -n "$(git status --porcelain)" ]; then
  echo "working tree not clean — exiting"
  exit 1
fi
git checkout main
git pull --ff-only origin main
```

## Step 1: Pick the work item

There are two valid targets:

- **Fresh issue**: open issue labeled `state:ready`
- **Blocked repair**: open PR labeled `queue:blocked` whose head branch is
  `build/issue-$N`

If `$ARGUMENTS` is a number:

1. Prefer the open blocked PR for `build/issue-$N` if one exists.
2. Otherwise, use the open `state:ready` issue `#N`.
3. If neither exists, exit cleanly.

If `$ARGUMENTS` is empty, walk priorities `p0 → p1 → p2 → p3`. For each
priority:

1. Look for the oldest open `queue:blocked` PR whose linked issue has that
   priority and whose repair lock is still claimable.
2. If none are claimable, look for the oldest open `state:ready` issue with
   that priority.
3. Stop on the first claimable target.

If there is no claimable blocked PR and no ready issue, exit with `no work`.

Once you have `N`, read the issue body in full via `gh issue view $N --json
title,body,labels`. Extract the acceptance criteria (`- [ ]` checkboxes in the
body). Those are your contract — you are not done until every box is checked in
reality.

## Step 2: Atomic claim

### Fresh issue

```bash
MODE="fresh"
BRANCH="build/issue-$N"

git checkout -b "$BRANCH"
# The push IS the lock. If someone else pushed first, we lose.
if ! git push -u origin "$BRANCH"; then
  echo "branch already claimed by another clanker — exiting"
  git checkout main
  git branch -D "$BRANCH"
  exit 0
fi

gh issue edit $N \
  --remove-label state:ready \
  --add-label state:in-progress
```

### Blocked repair

Assume the blocked PR number is `$PR`, and its head branch is
`build/issue-$N`.

```bash
MODE="repair"
BRANCH="build/issue-$N"
LOCK_BRANCH="repair/pr-$PR"

git fetch origin "$BRANCH"
git checkout -B "$LOCK_BRANCH" "origin/$BRANCH"

# The repair lock is a separate remote branch. If it already exists,
# another builder is already repairing this PR.
if ! git push -u origin "$LOCK_BRANCH"; then
  echo "repair already claimed by another clanker — exiting"
  git checkout main
  git branch -D "$LOCK_BRANCH"
  exit 0
fi

git checkout -B "$BRANCH" "origin/$BRANCH"

gh issue edit $N \
  --remove-label state:blocked \
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

## Step 5: Implement

Make the smallest diff that satisfies the acceptance criteria. Don't
drive-by refactor adjacent code unless the issue is literally a refactor.

- Follow the conventions in `CLAUDE.md`.
- ESM-only, `.js` import extensions, TypeScript strict.
- Validate at system boundaries only.
- No comments unless they explain a non-obvious WHY.

## Step 6: Verify

Run the full local CI gate, in this order. If ANY step fails, do not paper
over it — fix the root cause:

```bash
pnpm run build          # tsc + vite dashboard
pnpm run lint           # 0 errors
pnpm run format:check   # all files formatted
pnpm test               # backend unit tests
pnpm run test:dashboard # dashboard vitest
```

If your change touches integration paths, also mention in the PR body that
integration tests were not run locally (CI runs them on merge).

## Step 7: Adversarial self-review

Before opening the PR, spawn a **separate subagent** (the general-purpose
agent with a code-reviewer brief) whose only job is to look for:

- Acceptance-criteria boxes the implementation missed
- Security issues (XSS, SQL injection, SSRF, secret leakage, prompt injection)
- Missing test coverage for the code you changed
- Hidden coupling with modules the issue didn't mention

If the reviewer flags something material, go back to Step 5. If the reviewer
is satisfied, proceed.

> Future: if `scripts/codex-review.mjs` exists, call it as an additional
> adversarial pass. Until that script lands, the subagent review is the only
> gate.

## Step 8: Commit + push

Follow the existing commit-message style (see `git log --oneline -20`).
The commit title should reference the issue in a way GitHub auto-closes it:

```
<short imperative title>

<1–3 paragraph body explaining the why>

Fixes #<N>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

Push to the already-upstream work branch:

```bash
git push origin "$BRANCH"
```

## Step 9: Hand off to `/queue`

Because this repo now uses a serialized merge queue, the builder does not
watch CI to completion and does not merge manually. The builder opens or
reuses the PR, marks it ready for the queue, and exits.

### Fresh issue

```bash
PR_URL=$(gh pr create \
  --base main \
  --head "$BRANCH" \
  --title "<same as commit title>" \
  --body "$(cat <<EOF
## Summary
<1–3 bullets>

## Linked issue
Fixes #$N

## Lock group
<copy from issue>

## Write set
<copy from issue>

## Validation
- [x] pnpm run build
- [x] pnpm run lint
- [x] pnpm run format:check
- [x] pnpm test
- [x] pnpm run test:dashboard
- [ ] integration (CI / queue only)

## Queue checklist
- [x] Branch is ready for serialized merge
- [x] This PR does not knowingly overlap an older open PR in the same lock group
- [x] Add `queue:ready` only when the PR is genuinely ready for the queue
EOF
)")

gh pr edit "$PR_URL" --remove-label queue:blocked --add-label queue:ready
```

### Blocked repair

Use the existing PR. Do **not** open a replacement PR unless the branch is
hopelessly wedged and a human explicitly decides to supersede it.

```bash
gh pr edit "$PR" --remove-label queue:blocked --add-label queue:ready
```

If you claimed a repair lock, release it after the handoff:

```bash
git push origin --delete "$LOCK_BRANCH"
```

`/queue` will retest the GitHub merge ref on top of the newest `main`,
merge on green, and clear `state:in-progress` on the linked issue when the
branch is named `build/issue-$N`. If an older open PR already occupies the
same lock group, `/queue` may add `queue:deferred` and wait instead of racing
the merge.

## Step 10: Exit cleanly

Exit. The PR will either:

- **Pass queue validation** → `/queue` merges it → deploy ships it → issue auto-closes.
- **Wait behind an older sibling** → `/queue` adds `queue:deferred` until the same-lock-group lane is clear.
- **Fail queue validation** → `/queue` flips it to `queue:blocked` and leaves a comment.

If the queue blocks the PR after you exit, a future `/build` repair run,
`/fix`, or a human gets to sort it out.

## Failure modes + what to do

| Situation | What you do |
|-----------|-------------|
| No ready issues and no claimable blocked PRs | Exit with `no work` message |
| `.clankerism/PAUSED` present | Exit immediately, log the brake |
| Fresh issue branch push rejected | Another clanker won the race — exit, delete local branch |
| Repair lock push rejected | Another clanker is already repairing that blocked PR — skip or exit |
| Issue names a file that doesn't exist | Comment on issue, flip to `state:blocked`, exit |
| Local CI gate fails and you can't fix in-scope | Leave or restore `queue:blocked`, flip the issue to `state:blocked`, delete the repair lock if one exists, exit |
| Adversarial review finds a material gap | Loop back to Step 5 once. If still broken, `state:blocked` + exit |
| `gh` auth expired | Exit with a clear message — human action required |

## Things you will be tempted to do and must not

- **Claim two issues because they're "related"**. No. One run, one issue.
- **Modify an unrelated file because you noticed a typo**. No. File a new
  issue via `/scout` if it matters.
- **Hot-patch a queue-blocked PR in the same run that just got blocked**. No.
  Exit and let a fresh repair run claim it cleanly.
- **Re-use a branch name another clanker already pushed to**. Never. The
  branch name IS the lock.
- **Create the issue yourself if none exist**. That is `/scout`'s job.
