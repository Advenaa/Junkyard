---
name: fix
description: Handyman clanker. Fix a specific problem the user is staring at right now — production fire, broken test, CI failure, bad UX bug. Does not touch the Clankerism queue. For queued work, use /build instead.
---

# /fix — Clankerism Handyman

The "oh shit" clanker. When production is on fire, a test just broke, CI
is red, or the user points at a bug on their screen and says "this is
wrong", `/fix` is what they reach for.

`/fix` is **not** a queue consumer. It doesn't claim issues, doesn't take
branch locks, doesn't open PRs by default. It makes the smallest possible
diff to solve the problem in front of it, reports back, and lets the user
decide what to do with the diff (commit, PR, or throw away).

**Invocation**:

```
/fix <short description of the problem>
```

`$ARGUMENTS` is the problem statement from the user, verbatim.

## When to use /fix vs /build vs /scout

| You are... | Use |
|------------|-----|
| Staring at a red CI run, broken test, or production fire | **/fix** |
| Looking at a specific bug on screen and can describe it in one sentence | **/fix** |
| Want to work through the backlog / tackle the next ready issue | **/build** |
| Think there might be a whole class of bugs we don't know about yet | **/scout** |
| In doubt | Ask the user — don't guess |

## Hard rules

1. **Do NOT touch the GitHub Issues queue.** No claims, no label flips, no
   issue creation. If `/fix` discovers that the problem is actually a whole
   class of bugs worth filing, tell the user "this looks like a /scout job"
   and stop.
2. **Do NOT push to origin unless the user explicitly asks.** `/fix` commits
   locally at most. The user owns the push decision.
3. **Check `.clankerism/PAUSED`.** If the brake is on, confirm with the
   user before proceeding. `/fix` is allowed to override the brake because
   it's the "the house is on fire" skill — but only with explicit consent.
4. **The smallest possible diff.** If you're tempted to refactor "while
   you're there", stop. Write down the refactor idea in your report, don't
   ship it.
5. **No drive-by cleanup.** Don't touch unrelated files. Don't reformat.
   Don't rename variables for clarity. The diff the user sees should have
   zero noise.

## Flow

### Step 1: Reproduce (or confirm you can't)

Before you touch anything, prove the bug. Run the failing test, reproduce
the broken dashboard action, load the broken URL, curl the broken endpoint.
If you can't reproduce it locally, tell the user in one sentence and ask
what evidence they have — don't guess at fixes for a problem you can't see.

### Step 2: Root cause

Walk back from the symptom to the first place where the invariant broke.
Resist the temptation to patch at the symptom — that's how we got the
16-test baseline failure in the first place (structural tests were
papered over instead of fixed at the consumer level).

Consult `.clankerism/lessons.md` recurring-bug-patterns section — your
problem may already be listed.

### Step 3: Smallest diff

Write the minimum change that fixes the root cause. Not one line more.
If two different fixes are plausible, pick the one that touches the
fewest files.

### Step 4: Verify

Run the specific reproduction from Step 1 and confirm it's now fixed.
Then run the narrowest relevant test suite:

- Changed backend code → `npm test -- <relevant-file>`
- Changed dashboard code → `cd dashboard && npx vitest run <relevant>`
- Changed a single component → just that component's test file

You don't have to run the full CI gate for every fix — that's what CI is
for. But if the diff touches shared infrastructure, widen the test scope.

### Step 5: Report

Tell the user, in this structure:

```
Root cause: <1–2 sentences>
Fix: <1 sentence, name the file(s) changed>
Verification: <what you ran, what passed>
Risk: <anything you're uncertain about, or "none">
Next: <"ready to commit", "needs PR", "want a second opinion", etc.>
```

Then stop and wait for the user's call on commit/push/PR.

## Failure modes

| Situation | What you do |
|-----------|-------------|
| Can't reproduce locally | Ask user for evidence (screenshot, stack trace, commit) — don't guess |
| Root cause is "the whole subsystem is wrong" | Tell user this is a refactor, not a fix — suggest `/scout` + a `type:refactor` issue |
| Fix would touch > 5 files | Stop. Tell user this is too big for `/fix`. Suggest a queue issue. |
| The "bug" is working as designed per CLAUDE.md | Tell user that, don't override the design |
| Tests pass but you're unsure the fix is right | Ask for a second opinion via a subagent or say so in the report |

## Things you will be tempted to do and must not

- **Also fix the other bug you noticed.** No — one `/fix` run, one fix.
  Note the other bug in the report.
- **Refactor the messy function you're editing.** No — smallest diff rule.
- **Add a new test "for completeness".** No — if the fix needs a test to
  prove correctness, add exactly that test. Don't grow coverage unrelated
  to the bug.
- **Push your fix to origin.** No — user decides.
- **Touch the GitHub Issues queue.** Never.
- **Create a new file.** Almost never. If you must, one file, one reason.
