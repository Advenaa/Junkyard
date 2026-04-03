---
name: podders-fix
description: Fix a specific finding from the research queue. Reads .research-queue.md, applies the fix following Podders conventions, verifies with build+test, and marks resolved. Usage: /podders-fix <finding-id> (e.g., /podders-fix EN-005)
user-invocable: true
context: fork
---

# Podders Fix — Apply a Single Research Finding Fix

You fix exactly one finding from the research queue. The finding ID is: `$ARGUMENTS`

**Working directory**: `/Users/advena/project/poddyarchie`

## Step 1: Parse the finding

Read `/Users/advena/project/poddyarchie/.research-queue.md` and locate the finding matching ID `$ARGUMENTS`.

Extract these fields:
- **ID** (e.g., `EN-005`, `C-001`, `W-003`)
- **File path** and **line number(s)**
- **Description** — what the issue is
- **Severity** — critical / high / medium / low
- **Suggested fix** — if provided

If the finding ID is not found, report the error and stop. List available finding IDs so the user can pick one.

If the finding is already marked as resolved, report that and stop.

## Step 2: Understand the context

Read the referenced source file. Do NOT read only the exact line — read a generous window around it (at least 50 lines before and 50 lines after) to understand:

- What the function does
- What calls it and what it calls
- Related imports, types, and interfaces
- Any existing error handling patterns nearby
- Whether similar code exists elsewhere in the file

If the finding references multiple files, read all of them.

Also read these for project conventions:
- `/Users/advena/project/poddyarchie/CLAUDE.md` — conventions and coding guidelines
- Any relevant doc from the `docs/` folder if the finding touches a specific subsystem

## Step 3: Apply the fix

Fix the issue following Podders conventions strictly:

### Convention checklist (verify every fix against these)

- **ESM only** — all imports use `.js` extensions in import paths
- **TypeScript strict** — `strict: true`, no `any` escape hatches, no `as` casts that hide runtime errors
- **zod for LLM output validation** — if the fix involves LLM output parsing, use zod schemas with clamping/defaults
- **Atomic DB operations** — use `UPDATE...RETURNING`, not SELECT-then-UPDATE. Use `FOR UPDATE` in transactions where needed
- **SSRF validation** — any outbound URL fetch must go through `url-validator.ts` (`validateUrl()` or `fetchValidated()`)
- **BIGINT for epoch-ms columns** — never INTEGER for timestamps
- **toCamelCase for API responses** — database is snake_case, API is camelCase
- **Proper error handling** — never swallow errors silently. Log with appropriate level, re-throw or return error state
- **ULID for IDs** — except session IDs which use `crypto.randomBytes`
- **pino logging** — use the project's logger, mask secrets
- **No `any`** — use `unknown` + type narrowing, or proper generic types

### Fix principles

- **Minimal diff.** Change only what's needed to fix the finding. Don't refactor adjacent code.
- **Match surrounding style.** If the file uses certain patterns (early returns, guard clauses, etc.), follow them.
- **Preserve behavior.** The fix should address the specific issue without changing unrelated behavior.
- **Add type safety.** If the fix involves adding validation or type narrowing, be thorough.

## Step 4: Verify — build

Run `npm run build` in `/Users/advena/project/poddyarchie`.

If it fails:
1. Read the error output carefully
2. Fix the compilation error
3. Re-run `npm run build`
4. Repeat until clean

Do NOT proceed to the next step until the build passes.

## Step 5: Verify — test

Run `npm test` in `/Users/advena/project/poddyarchie`.

If tests fail:
1. Determine if the failure is caused by your fix or was pre-existing
2. If caused by your fix, update the fix or the test as appropriate
3. If pre-existing, note it in your report but proceed

## Step 6: Update the research queue

Edit `/Users/advena/project/poddyarchie/.research-queue.md`:

- Change the finding's status from `open` to `pending`
- Do NOT use a commit hash (there is no commit yet — the user or evolve handles committing)
- Do NOT remove the finding — just update its status marker

Example: change `- **Status**: open` to `- **Status**: pending`

Or if the queue uses a compact format, update the status indicator accordingly (e.g., change a checkbox or status tag).

## Step 7: Do NOT commit

Leave all changes staged or unstaged. The user or the evolve skill handles committing. Do not run `git add` or `git commit`.

## Step 8: Report

Output a concise summary:

```
## Fixed: $ARGUMENTS

**Severity**: {severity}
**File(s)**: {file paths changed}
**What was wrong**: {1-2 sentences}
**What was fixed**: {1-2 sentences}
**Build**: pass
**Tests**: pass | {failure details if pre-existing}
```

## Rules

- **One finding per invocation.** Do not batch multiple findings.
- **Read before writing.** Always read the full context before making changes.
- **Follow CLAUDE.md.** Every convention listed there applies.
- **Minimal changes.** Fix the finding, nothing else. No drive-by refactors.
- **No commits.** The user decides when to commit.
- **If you can't fix it, say so.** Some findings may require design decisions or more context. Report what you found and why you couldn't apply a fix, rather than applying a bad one.
