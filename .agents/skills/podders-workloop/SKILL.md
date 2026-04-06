---
name: podders-workloop
description: Execute one Podders task slice end-to-end using the shared Claude/Codex loop. Usage: /podders-workloop <task-or-finding>
user-invocable: true
context: fork
---

# Podders Workloop

Execute exactly one task slice described by `$ARGUMENTS`.

If `$ARGUMENTS` is empty, ask the user for a single task, feature slice, or finding ID before proceeding.

## Step 1: Load the shared operating context

Read these first:

- `./docs/AGENT_LOOP.md`
- `./AGENTS.md` or `./CLAUDE.md`
- `./PRODUCT.md`

Then read only the subsystem docs and source files needed for the specific task.

## Step 2: Scope to one slice

Choose exactly one of:

- one finding from `.research-queue.md`
- one feature slice that can be verified end-to-end
- one narrowly scoped module fix

Do not batch unrelated work.

## Step 3: Inspect before editing

- Start with `git status --short` if resuming existing work.
- Read the relevant code paths fully enough to understand the real control flow.
- If the task references a finding ID, read the matching `.research-queue.md` entry before coding.

## Step 4: Implement

- Make the smallest diff that fully solves the slice.
- Match surrounding style and conventions.
- Do not do drive-by refactors.
- Preserve unrelated user changes and prior agent changes.

## Step 5: Verify

- Run `npm run build`.
- Run the narrowest relevant tests for the slice.
- If the change touches shared infrastructure or an existing bug fix with unit coverage, also run `npm test` when practical.
- If the slice changes dashboard behavior or user flows, prefer the global `dev-browser` skill for real UI verification when it is available.

If verification fails, either fix the problem or report the exact blocker.

## Step 6: Update shared task state

If the task came from `.research-queue.md`:

- change `open` to `pending` only after the fix is implemented and verified
- change to `blocked` if a real blocker prevents completion

Do not commit unless the user explicitly asks.

## Step 7: Report cleanly

Report:

- what changed
- files touched
- validation run
- remaining risk or next step

If another agent may need to resume later, make the handoff explicit and concise.
