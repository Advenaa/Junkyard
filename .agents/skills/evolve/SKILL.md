---
name: evolve
description: Continue autonomous Podders product development in Codex. Reads .evolve-state.md, docs/ROADMAP.md, PRODUCT.md, AGENTS.md, and docs/AGENT_LOOP.md to choose the highest-value next slice, implement it, verify it, and leave a clean handoff. Use when the user says "continue evolve", "run an evolve cycle", "verify the last feature", "pick the next roadmap slice", or "add this to evolve priorities".
user-invocable: true
context: fork
---

# Evolve

Use this skill to run the Podders "evolve" loop inside Codex.

Treat this as a Codex-native adaptation of the existing Claude evolve workflow. Keep the same product-first decision engine, but follow the active Codex harness rules when they differ:

- `AGENTS.md` and `docs/AGENT_LOOP.md` are authoritative for this repo.
- Do not commit or push unless the user explicitly asks.
- Do not spawn subagents unless the user explicitly asks for delegation or parallel agent work.
- Complete one meaningful slice per invocation unless the user explicitly asks only for queue/state management.

## When to use it

Use this skill when the user wants any of the following:

- continue autonomous work on Podders
- run an "evolve cycle"
- choose and implement the next roadmap slice
- verify a recently finished feature
- add, reorder, or complete entries in `./.evolve-state.md`
- perform roadmap-gap or product-gap research for Podders

## Step 1: Load the operating context

Read these first, in parallel when practical:

1. `./AGENTS.md`
2. `./docs/AGENT_LOOP.md`
3. `./PRODUCT.md`
4. `./docs/ROADMAP.md`
5. `./.evolve-state.md`
6. `git status --short`
7. `git log --oneline -5`

Read additional subsystem docs and source files only for the slice you choose.

If the user referenced a specific feature, file, finding, or priority item, read that context before deciding anything else.

## Step 2: Interpret the user's intent first

Before picking work automatically, check whether the user asked for something specific:

- If they asked to add or edit an evolve priority, update `./.evolve-state.md` and stop unless they also asked you to implement it now.
- If they asked to verify a feature, run a verification slice instead of picking a new build slice.
- If they named a specific bug, finding, or feature, scope to that slice.
- If they just said "continue", "keep working on evolve", or similar, choose the next slice using the priority engine below.

## Step 3: Pick exactly one slice

Use this priority order and pick the first applicable item:

| Priority | Action | Trigger |
|----------|--------|---------|
| P0 | User-directed priority | The user explicitly asked for a feature, fix, verification pass, or queue update |
| P1 | Broken build or critical/high bug | Build is broken, tests fail due to current work, or a critical/high finding is the clearest blocker |
| P2 | Continue active feature | `./.evolve-state.md` shows an in-progress multi-cycle feature |
| P3 | Verify recently built feature | Build Progress shows a feature that is done but not yet verified |
| P4 | Build next roadmap slice | No urgent bug or active verification; next planned feature has dependencies met |
| P5 | Fill missing test coverage | Recent fix/build lacks the narrow regression coverage it obviously needs |
| P6 | Research | Queue is thin or user asked for gap discovery; rotate product-level, system-level, code-level, roadmap-gap |
| P7 | Skill/doc upkeep | Only when it directly improves future evolve cycles or unblocks current work |

Rules:

- User priorities win unless a critical blocker makes progress impossible.
- Do not abandon an active multi-cycle feature without a concrete reason.
- Prefer one shippable vertical slice over broad partial progress.
- Never batch unrelated work into one evolve pass.

## Step 4: Execute the slice

Follow the shared Podders workloop:

1. Read the relevant code before editing.
2. Make the smallest diff that fully solves the slice.
3. Preserve unrelated user changes and prior agent work.
4. Match repo conventions from `AGENTS.md`.
5. Avoid drive-by refactors.

If the slice is a feature build, decompose mentally into schema, backend, frontend, prompt, and test concerns, but only touch the parts needed for the current slice.

If the slice is a verification pass:

- act like a user, not just a compiler
- trace the data path end-to-end
- check edge cases, empty states, and contract mismatches
- prefer the `dev-browser` skill for real dashboard verification when available and useful

If the user explicitly asks for parallel agent work, you may delegate independent subtasks. Otherwise, do the work locally.

## Step 5: Verify

Run the narrowest useful validation for the slice:

- always run `npm run format:check` after code changes
- if `npm run format:check` fails because of your edits, run Prettier to fix the affected files before continuing, then rerun `npm run format:check`
- always run `npm run build` after code changes
- run focused tests for touched modules when they exist
- also run `npm test` when shared infrastructure changed or a bug fix should be covered by existing unit tests
- for UI behavior, use browser verification when practical instead of relying only on code inspection

Do not claim a slice is done if verification failed.

## Step 6: Update evolve state carefully

Update `./.evolve-state.md` only when the work actually changes project state.

Typical updates:

- increment `Cycle:` only after completing a real evolve slice
- update `Last action:` and `Last research type:` when relevant
- mark a user priority complete if you actually finished it
- advance the Feature Work Log when a multi-cycle feature progressed
- update Build Progress when a feature moved from planned -> in-progress -> done -> verified

Do not churn unrelated parts of the state file. Keep edits tight and preserve the existing format.

If the user only asked to manage priorities or explain evolve, do not fake a cycle increment or add validation results that did not happen.

## Step 7: Git behavior

Unless the user explicitly asks, do not:

- create a commit
- push to remote
- rewrite history

If the user later asks for a commit, keep it to one clear theme that matches the single slice completed.

## Step 8: Report

Close with a short handoff that covers:

- the slice chosen and why
- what changed
- validation run
- remaining risk, blocker, or next likely evolve step

## Research rotation

When you choose research, rotate the type using `Last research type:` in `./.evolve-state.md`:

- product-level: can Ardi actually use the current product surfaces?
- system-level: do end-to-end data flows and integrations really connect?
- code-level: are the current implementations correct and safe?
- roadmap-gap: what is still missing relative to `PRODUCT.md` and `docs/ROADMAP.md`?

Turn research into actionable findings or follow-up slices, not vague observations.

## Guardrails

- One slice per invocation.
- Code and running behavior beat stale docs when they disagree.
- Backward-compatible migrations only.
- Respect existing dirty worktrees.
- Prefer explicit file reads over assumptions.
- Keep evolve useful as an execution loop, not just a planning exercise.
