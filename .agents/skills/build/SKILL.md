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
7. **If CI fails after PR open, do NOT push a "fix" commit onto the same
   branch.** Instead: comment on the issue, flip to `state:blocked`, let a
   human triage. We don't let clankers chase their own tails.

## Preflight

```bash
# 1. Hard stop if brake is on
if [ -f .clankerism/PAUSED ]; then
  echo "PAUSED brake engaged — exiting"
  exit 0
fi

# 2. Must be on main, clean working tree
git fetch origin main
git checkout main
git reset --hard origin/main
if [ -n "$(git status --porcelain)" ]; then
  echo "working tree not clean — exiting"
  exit 1
fi
```

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

```bash
BRANCH="build/issue-$N"
git checkout -b "$BRANCH"
# The push IS the lock. If someone else pushed first, we lose.
if ! git push -u origin "$BRANCH"; then
  echo "branch already claimed by another clanker — exiting"
  git checkout main
  git branch -D "$BRANCH"
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
npm run build          # tsc + vite dashboard
npm run lint           # 0 errors
npm run format:check   # all files formatted
npm test               # backend unit tests
npm run test:dashboard # dashboard vitest
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

`git push` to the already-upstream branch.

## Step 9: Open the PR and watch CI

Because this repo is on the free GitHub plan (no branch protection /
rulesets), `gh pr merge --auto` is unreliable — it may either merge
immediately or refuse to arm. Instead, the clanker watches the CI run
synchronously and merges manually on green.

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

# 2. Find the CI run for this push
sleep 5  # give GitHub a moment to register the run
RUN_ID=$(gh run list --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId')
if [ -z "$RUN_ID" ]; then
  echo "no CI run found for $BRANCH — human triage required"
  gh issue comment "$N" --body "/build: no CI run detected after push. Human triage needed."
  gh issue edit "$N" --remove-label state:in-progress --add-label state:blocked
  exit 1
fi

# 3. Block until CI finishes. Exit code reflects CI result.
if ! gh run watch "$RUN_ID" --exit-status; then
  echo "CI red — NOT merging. PR stays open for human review."
  gh issue comment "$N" --body "/build: CI failed on run $RUN_ID. PR #$PR_NUMBER stays open for triage."
  gh issue edit "$N" --remove-label state:in-progress --add-label state:blocked
  exit 1
fi

# 4. CI green — merge. Squash so main history stays clean.
gh pr merge "$PR_NUMBER" --squash --delete-branch

# 5. GitHub auto-closes the issue via "Fixes #N", but the state label
#    does NOT clear on its own. Remove state:in-progress explicitly so
#    the closed issue doesn't show a misleading WIP label in queries.
gh issue edit "$N" --remove-label state:in-progress
```

If the merge succeeds, GitHub's "Fixes #N" in the commit message closes
the issue automatically and the deploy job fires. The clanker then
strips the stale `state:in-progress` label (closed issues accept label
edits). The clanker's work is done.

## Step 10: Exit cleanly

Exit. The PR will either:

- **Go green in CI** → auto-merges → deploy ships it → issue auto-closes.
- **Fail CI** → a human sees it. Do NOT push more commits trying to fix it
  from this same skill run.

If the PR fails CI after you exit, a future run of `/fix` or a human gets
to sort it out. That is by design — one clanker, one swing.

## Failure modes + what to do

| Situation | What you do |
|-----------|-------------|
| No ready issues in the queue | Exit with `no work` message |
| `.clankerism/PAUSED` present | Exit immediately, log the brake |
| Branch push rejected | Another clanker won the race — exit, delete local branch |
| Issue names a file that doesn't exist | Comment on issue, flip to `state:blocked`, exit |
| Local CI gate fails and you can't fix in-scope | Don't push. Comment on issue with details, flip to `state:blocked`, delete branch, exit |
| Adversarial review finds a material gap | Loop back to Step 5 once. If still broken, `state:blocked` + exit |
| `gh` auth expired | Exit with a clear message — human action required |

## Things you will be tempted to do and must not

- **Claim two issues because they're "related"**. No. One run, one issue.
- **Modify an unrelated file because you noticed a typo**. No. File a new
  issue via `/scout` if it matters.
- **Push a follow-up commit to fix CI**. No. `state:blocked`, exit.
- **Re-use a branch name another clanker already pushed to**. Never. The
  branch name IS the lock.
- **Create the issue yourself if none exist**. That is `/scout`'s job.
