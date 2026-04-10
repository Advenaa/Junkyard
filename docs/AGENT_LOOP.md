# Agent Loop

This document defines the shared operating model for both Claude Code and Codex in this repository.

Goal: either agent should be able to pick up the same task, on the same branch, with the same artifacts, and continue cleanly if the other agent is rate-limited or interrupted.

## Default Mode

- Claude and Codex do the same job by default: inspect code, implement one slice, verify it, and leave a clean handoff.
- Do not assume specialization unless the user explicitly asks for it.
- Work on one vertical slice or one research finding at a time.
- If docs and code disagree, treat the code as truth and update docs only when the task requires it.

## Canonical Artifacts

- **GitHub Issues** (labeled `state:ready`, `p0`–`p3`, `type:*`, `source:*`) —
  source of truth for actionable findings and fixable tasks. Under Clankerism
  this replaced the old `.research-queue.md` / `.evolve-state.md` files.
- `.clankerism/README.md` — 4-role model, label taxonomy, soft-brake
  mechanism.
- `.clankerism/lessons.md` — reusable build / test / research lessons.
  Append sparingly; delete stale entries.
- `.clankerism/scout-state.md` — `/scout` cursor and next-sweep plan.
- `.clankerism/archive/` — frozen legacy state files (`evolve-state.md`,
  `research-queue.md`, etc.) for historical context only. Don't write here.
- `git status` and `git diff` — current execution state and the fastest
  handoff surface.

## Shared Slice Loop

1. Read `PRODUCT.md`, the active harness file (`AGENTS.md` or `CLAUDE.md`), this document, and any subsystem docs/files needed for the task.
2. Restate the task internally and choose exactly one slice to complete in this pass.
3. Inspect the real code before changing anything.
4. Make the smallest diff that fully solves the slice. Avoid drive-by refactors.
5. Verify with `npm run build` and the narrowest relevant tests. If the change touches shared infrastructure or a bug fix with existing unit coverage, also run `npm test` when practical.
6. If the task comes from a GitHub issue, follow the Clankerism consumer flow (full procedure in `AGENTS.md` / `CLAUDE.md` → "Clankerism Workflow"):
   - Claim atomically by pushing `build/issue-<N>` to origin *before* starting work; if the push is rejected, another agent won the race — exit, don't retry under a different name.
   - Flip `state:ready` → `state:in-progress` once the branch is on origin.
   - Open the PR with a `Fixes #<N>` footer so GitHub auto-closes on merge.
   - Watch CI synchronously with `gh run watch <run-id> --exit-status`, not `gh pr merge --auto` (auto-merge is unreliable without branch protection on this free-plan repo).
   - On green: `gh pr merge --squash --delete-branch`, then `gh issue edit <N> --remove-label state:in-progress` to clear the stale label (GitHub does not strip it on auto-close).
   - On a real blocker or red CI: flip to `state:blocked`, comment, exit. Do NOT push a "fix" commit onto the same branch.
7. Leave a clean handoff in the final report:
   - what changed
   - files touched
   - validation run
   - next step or blocker
8. Do not commit unless the user explicitly asks.
9. If the user wants ongoing remote checkpoints, keep that preference active and push every 3 completed cycles by default, but only at clean verified feature boundaries:
   - a clean feature boundary is a coherent, verified slice that stands on its own
   - examples: token management, account management, chat citations, summary detail flow
   - if cycle 3 lands mid-feature, wait until the next clean verified boundary instead of pushing a partial slice
   - if the user says `push now`, push immediately even if the current boundary is not ideal

## Handoff Contract

When resuming work started by the other agent:

1. Start with `git status --short`.
2. Read the relevant GitHub issue (the one the branch name references) or the user task statement.
3. Read the touched files before editing further.
4. Continue from the existing diff; do not redo settled work unless you find a concrete problem.
5. Preserve uncommitted user changes and prior agent changes unless the user explicitly asks for a revert.

## Slice Shape

Prefer these slice sizes:

- one `state:ready` GitHub issue
- one feature slice that can be verified end-to-end
- one narrowly scoped module fix

Avoid these slice sizes:

- mixed unrelated fixes
- broad refactors without a task forcing them
- "while I was here" cleanup across multiple subsystems

## Reporting Format

Use a short closeout with:

- scope
- validation
- remaining risk or next step

If blocked, say exactly what is blocked and what the next agent should inspect.

## Browser Verification

- For dashboard or end-to-end UI verification, use browser automation when it is available in the active harness.
- In Codex, prefer the global `dev-browser` skill for real browser interaction instead of guessing from code alone.
- Keep this optional and harness-specific. Do not make browser tooling a required dependency of the shared loop.
