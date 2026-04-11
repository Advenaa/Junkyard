---
name: scout
description: Audit the codebase for new problems and file them as GitHub Issues in the Clankerism queue. This is the producer half of Clankerism — /scout finds the work, /build ships it.
---

# /scout — Clankerism Producer

The health inspector. Walks through a slice of the kitchen, finds things
that are wrong or about to be wrong, writes them up as tickets, and pins
them to the board. Doesn't cook — just audits and reports.

**Invocation**:

- `/scout` — run the next scheduled audit type (rotates product → system → code → runtime)
- `/scout product` — force a product-completeness sweep
- `/scout system` — force a system-level / integration sweep
- `/scout code` — force a code-level sweep of a specific subsystem
- `/scout runtime` — audit live runtime diagnostics through admin endpoints
- `/scout diff` — audit just the last N commits (fastest, highest-yield)

`$ARGUMENTS` may contain the audit type. If empty, read the next scheduled
type from `.clankerism/scout-state.md`.

## Hard rules

1. **Never modify code.** `/scout` is read-only against `src/` and
   `dashboard/src/`. The ONLY files it writes are:
   - `.clankerism/scout-state.md` (its own memory)
   - GitHub Issues (via `gh issue create`)
2. **Never touch `state:ready` / `state:in-progress` issues that already
   exist.** Dedup via the fingerprint marker (see below). If a finding
   overlaps an existing issue, add a comment instead of filing a new issue.
3. **Check the PAUSED brake.** If `.clankerism/PAUSED` exists, exit.
4. **Cap findings per run.** A single `/scout` invocation files at most:
   - 1 p0 (critical)
   - 3 p1 (high)
   - 8 p2 (medium)
   If you genuinely find more, file the top-N by severity and note in the
   scout-state notes that a follow-up sweep is warranted.
5. **Never file a p0 without evidence you can show the user.** p0 means
   "drop everything" — vague hunches don't qualify. A reproducible test,
   a production log line, or a minimal curl that returns a wrong answer.
6. **False positives cost more than missed findings.** Cross-check every
   candidate finding against `CLAUDE.md` design decisions, recent commits
   (`git log --oneline -30`), and the existing archived lessons file.

## Audit types

### Product (`/scout product`)

Walk the user-facing surface. Can every route in `server.ts` be reached
from the dashboard? Can every config in `app_config` be edited in
Settings? Can every source type be added? Does every empty state say
something useful? Does every error actually show up in the UI?

This is the highest-yield audit type. Cycle 129 found 27 issues (2
critical) in one product sweep while 128 prior code audits ran.

Start from `dashboard/src/pages/` and trace each page end-to-end. For
each page, ask:

- Can a user reach it? (check `Header.tsx` nav)
- Can they do every CRUD operation the backend supports?
- What happens when it's empty / loading / errored?
- Are there fields the backend returns that the UI silently drops?

### System (`/scout system`)

Trace a data flow end-to-end: ingest → normalize → chunk → Stage 1 →
correlate → Stage 3 → deliver. Look for:

- Config values defined but not wired through
- Pipeline stages that silently drop items (log line says "0 processed")
- Mutex / cron overlap bugs
- Missing backpressure between stages
- Schema fields that one stage writes but the next never reads

Good starting files: `src/scheduler.ts`, `src/process/*`, `src/deliver/*`,
`src/knowledge/*`.

### Code (`/scout code`)

Pick one subsystem (use `.clankerism/scout-state.md` coverage map to
rotate). Read every file in it top to bottom. Look for:

- Recurring patterns from `.clankerism/lessons.md` (epoch ms vs sec,
  BIGINT strings, json_agg without ORDER BY, Zod empty strings, etc.)
- Missing input validation at system boundaries
- Race conditions (claim-and-release, missed mutex)
- Security: SSRF, prompt injection, XSS, SQL injection, secret leakage
- Dead code that still runs

### Diff (`/scout diff`)

The laziest and highest-yield. Run:

```bash
git log --oneline origin/main~10..origin/main
git diff origin/main~10..origin/main
```

Audit only the changed lines. New code has more bugs than mature code —
the last 10 commits are where the bugs hide.

### Runtime (`/scout runtime`)

Use the live diagnostic endpoints to audit runtime health without SSH or
direct database access.

- Invocation: `/scout runtime`
- `PODDERS_DIAG_BASE_URL`: default `http://localhost:3000` for dev;
  use `https://podders.app` for prod
- `PODDERS_DIAG_ADMIN_TOKEN`: the Bearer API key the existing admin gate
  accepts; send it as `Authorization: Bearer $PODDERS_DIAG_ADMIN_TOKEN`
- `/api/v1/diag/stuck-items`: returns stuck-item counts and the oldest
  in-flight processing age
- `/api/v1/diag/backpressure`: returns ready/processing queue depth and
  oldest ready-item age
- `/api/v1/diag/halted-sources`: returns sources currently halted with
  halt reasons and timestamps
- `/api/v1/diag/health-events`: returns recent `error` / `critical`
  health events for repeated-failure detection

| Endpoint | Signal | Severity |
|---|---|---|
| `stuck-items` | `stuckCount > 0` | p1 |
| `backpressure` | `readyCount > 1000` OR `oldestReadyAgeMs > 3600000` | p1 |
| `halted-sources` | any halted source | p1 per source |
| `health-events` | any `critical` severity | p0 |
| `health-events` | `error` severity with same category in last 24h > 5 | p2 |

Per run, cap runtime findings the same way as any scout sweep:
`1 p0, 3 p1, 8 p2`.

Use the runtime fingerprint prefix:

```markdown
<!-- clanker-fingerprint:scout-runtime-<date>-<hash> -->
```

File runtime findings with:

```bash
gh issue create --label source:scout --label type:bug --label <severity>
```

## Dedup mechanism

Every issue created by `/scout` carries a hidden fingerprint in its body:

```markdown
<!-- clanker-fingerprint:scout-<YYYYMMDD>-<short-hash> -->
```

Where `<short-hash>` is `md5(title + primary-file-path)[0:8]`.

Before filing a new issue, search for the fingerprint:

```bash
gh issue search "clanker-fingerprint:scout-<date>-<hash>" --state all
```

If a match exists, post a comment on the existing issue with any new
evidence and move on. Never file a duplicate.

## Flow

### Step 1: Preflight

```bash
# Brake check
if [ -f .clankerism/PAUSED ]; then
  echo "PAUSED — exiting"
  exit 0
fi

# Read current scout state
cat .clankerism/scout-state.md
```

Determine the audit type:

- If `$ARGUMENTS` is set, use it.
- Else, read the "Next sweep type" from `scout-state.md` and rotate.

### Step 2: Select the target

- **product** → pick the page/flow that hasn't been audited most recently
- **system** → pick the pipeline stage least recently audited
- **code** → pick the subsystem from the coverage-map rotation
- **runtime** → query the diag endpoints against the configured base URL
- **diff** → just use `git log origin/main~10..origin/main`

### Step 3: Read aggressively

Open every relevant file in full before judging anything. Do not audit
from memory; do not trust your mental model of a file over its current
content. The biggest source of `/scout` false positives is "I thought
this file still did X" when it was refactored two weeks ago.

### Step 4: Draft findings

For each candidate finding, write out in scratch:

```
ID: (tentative)
Title: <imperative, < 70 chars>
Severity: p0 / p1 / p2 / p3
Type: bug / refactor / feature
Evidence: <file:line + 1-sentence quote or log line>
Why it matters: <1 sentence, what breaks, who it affects>
Suggested fix: <1-2 sentences>
```

Run every candidate through the false-positive filter:

- Is it forbidden by a CLAUDE.md design decision? → discard
- Is it already tracked by an open issue (fingerprint match)? → comment, skip
- Is it only reachable in a state that can't actually occur? → discard
- Is it "a different way to do it" rather than a bug? → discard unless it's
  actively hurting
- Does the "bug" have a regression test that proves it's intentional?
  → discard

Whatever survives is a real finding.

### Step 5: Cap + file

Apply the per-run caps (1 p0, 3 p1, 8 p2). If you have more than the cap,
file the top-N by severity and put the rest in `scout-state.md` under
"Next sweep plan".

For each finding that passes the cap, file the issue:

```bash
gh issue create \
  --title "<title>" \
  --body "$BODY_WITH_FINGERPRINT" \
  --label state:ready \
  --label "<p0|p1|p2|p3>" \
  --label "type:<bug|refactor|feature>" \
  --label source:scout
```

### Step 6: Update scout-state

Update `.clankerism/scout-state.md`:

- Last full sweep → today's date + commit hash
- Next sweep plan → next rotation slot
- Notes for the next scout → anything that came out of cap truncation or
  things you noticed but couldn't verify

### Step 7: Report

Tell the user:

```
Sweep type: <product|system|code|runtime|diff>
Scope: <what you audited>
Findings: <N filed>, <M deduped via comment>, <K discarded as false positive>
New issues: #<N1>, #<N2>, ...
Next sweep: <type> (<date>)
```

Then exit. Do NOT start another sweep. Do NOT claim any of the issues you
just filed.

## Things you will be tempted to do and must not

- **Fix the bug while you're there.** No. `/scout` is read-only. Files the
  issue, walks away.
- **File 40 findings because you're thorough.** No. Cap exists for a
  reason — 40 new issues just buries the queue. Pick the top-N.
- **File a p0 because it "feels bad".** No. Reproducible evidence only.
- **Claim the issue you just filed.** No. That's `/build`'s job.
- **Edit code "just to verify the bug".** No. If you can't prove it without
  editing, write a curl test or a one-off script — don't touch the real code.
- **Run another sweep because the first one was "easy".** No. One sweep per
  run. Exit when done.
