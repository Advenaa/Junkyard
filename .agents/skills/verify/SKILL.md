---
name: verify
description: Prod-only browser regression watcher for the Podders dashboard. Drives a real browser against the live VPS to catch layout breaks, JS exceptions, broken nav, and silent data-fetch failures. Read-only. Files any regression it finds as a GitHub Issue. Safe to run in a /loop — degrades to health-only mode when walk prereqs are missing.
---

# /verify — Clankerism Regression Watcher

The food taster. Unit tests prove the ingredients work; `/verify` confirms
the dish is actually edible in a real browser pointed at the live site.

`/verify` is the 4th Clankerism role. It is the only clanker that drives a
real browser, and the only clanker that talks to prod. It never writes —
not to the codebase, not to the database, not to prod. Its entire job is
to walk the dashboard, observe, and file issues for anything broken.

Every run has two parts: a **preflight + health parse** that always runs
(talking to the public `/` and `/api/v1/health` endpoints, no auth
required), and a **browser walk** that only runs if the walk prereqs are
met. Missing walk prereqs downgrade the run to health-only mode — they do
not abort it. This is what makes `/verify` safe in a `/loop`.

## Invocation

```
/verify
```

No flags, no modes. One target: prod. The prod URL is read from
`.clankerism/verify-target` (one line, http or https, no trailing slash).
If that file is missing, exit with a setup error.

## Hard rules

1. **Read-only, always.** No form submits, no config changes, no source
   toggles, no chat messages, no webhook tests. Navigation and observation
   only. The only network writes allowed are whatever Playwright itself
   does to attach cookies and load pages.
2. **Never modify source code.** `/verify` writes GitHub Issues and its own
   artifacts under `.clankerism/verify-runs/` (gitignored). Nothing else.
3. **Check the PAUSED brake.** If `.clankerism/PAUSED` exists, exit. The
   remote `CLANKERISM_PAUSED` variable is enforced by CI workflows
   separately and is not this skill's concern.
4. **Never claim, close, or label issues other than the ones you file.**
5. **Screenshots are mandatory** for any regression filed during the
   browser walk. A regression without visual evidence is not a regression
   — it's a guess. (Health-only findings don't need screenshots; the
   health JSON is the evidence.)
6. **One retry for flake, then file it.** If a flow fails, reload once. If
   it fails again, file the regression. Don't loop to make it pass.

## Prerequisites

**Hard prereqs** — if any fails, exit immediately with a setup error:

1. `.clankerism/PAUSED` must not exist.
2. `.clankerism/verify-target` must exist and contain a single URL (http
   or https, no trailing slash). No target = nothing to ping. No issue
   filed on this path; it's a local setup error, not a prod signal.

**Soft prereqs** — if missing, degrade to health-only mode (run Step 1,
skip Steps 2–5, still emit Step 6 report):

3. `.clankerism/verify-session.json` with a valid `podders_session`
   cookie. If the file is **missing or malformed**, skip the walk and
   record "walk skipped: no session cookie" in the final report — do
   **not** file an issue (the user may deliberately be running in
   health-only mode and nagging every tick is noise). If the file is
   present but the cookie is **expired** (discovered at Step 2 when the
   target root redirects to `/login`), file a p1 issue
   `verify: session expired` with fingerprint
   `verify-setup-session-expired`, skip the rest of the walk, and still
   emit the report.
4. Playwright MCP tools — the `playwright__browser_*` tool family. If
   missing, skip the walk and record "walk skipped: playwright MCP
   unavailable" in the report. Do **not** file an issue (same reasoning
   as the session cookie).

A run where both soft prereqs are met is called **full mode**; a run
missing at least one is **health-only mode**.

## Flow

**Gating summary**: Step 1 always runs (hard prereqs permitting). Steps
2–5 only run if both soft prereqs are satisfied. Step 6 always runs and
emits the gating state so the caller can see exactly which parts ran.

### Step 1: Preflight (always runs)

- Read the target URL from `.clankerism/verify-target`.
- **Reachability check**: `curl -s -o /dev/null -w '%{http_code}' "$TARGET/"` —
  expect 2xx within 5s. The dashboard root serves the SPA shell and is the
  most honest answer to "is the site up." If this fails (connection error
  or non-2xx), file a p0 issue "verify: $TARGET unreachable" and exit.
  Do **not** preflight against `/api/v1/health` — that endpoint reports
  degraded (HTTP 503) whenever any internal check fails, even while the
  SPA is perfectly browseable. A 503 from `/api/v1/health` is a signal to
  observe, not a reason to abort.
- **Health snapshot**: `curl -s "$TARGET/api/v1/health"` and parse the JSON
  body. For each entry in `checks[]`:
    - `status: "critical"` → file a p1 issue `verify: health critical: <name>`
      with the `message` field in the body. Fingerprint
      `verify-health-<name>` so recurring alerts deduplicate cleanly.
    - `status: "warn"` → file a p2 issue, same fingerprint pattern.
    - `status: "ok"` → nothing.
  If the health endpoint is unreachable or the JSON is unparseable, file a
  single p1 "verify: health endpoint unparseable" (fingerprint
  `verify-health-unparseable`) and continue — the browser walk, if
  gated-in, is still meaningful.
- Create `.clankerism/verify-runs/<ISO-timestamp>/` to hold this run's
  artifacts.

### Step 2: Auth setup (walk-gated)

**Gate**: skip this step and Steps 3–5 if `.clankerism/verify-session.json`
is missing/malformed or the Playwright MCP is unavailable. Record the
reason in the final report.

- Read `.clankerism/verify-session.json`. Inject the `podders_session`
  cookie into the Playwright browser context before the first navigation.
- Navigate to the target root. If the page redirects to `/login`, the
  session is dead — file the p1 "verify: session expired" issue described
  in the soft-prereqs section, skip the rest of the walk, and still emit
  the Step 6 report.

### Step 3: Walk the must-pass flows (walk-gated)

For each flow: navigate, wait for network idle, screenshot, read console
messages, assert, and record pass/fail. Each failure saves its screenshot
and console log under `.clankerism/verify-runs/<timestamp>/<flow>/`.

Must-pass flows (any failure → p1 regression filed, run marked failed):

1. **Home** — `/` renders a report view or a valid empty state. Not a
   blank `<div id="root">`.
2. **Reports list** — `/reports` renders at least one row or a valid
   empty state. `<h1>` or equivalent landmark present.
3. **Report detail** — click the first row on `/reports` (or navigate to
   a known report id if the list is empty). Detail page renders, no
   uncaught console errors.
4. **Raw feed** — `/feed` renders. At least one source row or a valid
   "no sources configured" empty state.
5. **Chat** — `/chat` renders, input box is reachable. Do not send a
   message.
6. **Search** — `/search` renders, input box is reachable. Do not submit.
7. **Settings** — `/settings` renders. Observe only. Do not click save,
   do not toggle anything.

Nav sanity: every item in the main `<Header />` nav must be reachable
and land on a non-error page. If a nav item 404s or throws, that's a p1.

### Step 4: Walk the passive observations (walk-gated)

Same navigation pattern, but findings here become p2 or p3 — they don't
fail the run.

- **p2**: console `error` level messages that don't block rendering;
  network requests returning 5xx on any walked page; `<img>` 404s;
  uncaught promise rejections.
- **p3**: console `warn` level messages; network 4xx that aren't handled
  as explicit empty/error states; page loads that take longer than 3s to
  reach network idle.

### Step 5: File regressions (walk-gated)

For each finding, dedup by fingerprint first. The fingerprint is a short
hash of `(flow, symptom, URL path)` so the same broken nav item doesn't
produce a new issue every run.

```bash
# Phrase-exact body search. A bare --search "clanker-fingerprint:foo"
# tokenizes on punctuation and produces false positives against any
# issue body that merely mentions one of the tokens — don't use it.
gh issue list --state open --search '"clanker-fingerprint:verify-<flow>-<hash>" in:body' --limit 5
```

If an open issue with the same fingerprint exists, skip. Otherwise:

```bash
gh issue create \
  --title "verify: <flow> failed on prod" \
  --body "$(cat <<EOF
## Summary
The <flow> flow failed against $TARGET during verify run <run-id>.

## Evidence
- Screenshot: .clankerism/verify-runs/<timestamp>/<flow>/screenshot.png
- Console log: .clankerism/verify-runs/<timestamp>/<flow>/console.log
- Timestamp: <ISO 8601>
- Commit at time of run: $(git rev-parse --short HEAD)

## Observed
<what happened>

## Expected
<what should happen>

<!-- clanker-fingerprint:verify-<flow>-<hash> -->
EOF
)" \
  --label state:ready \
  --label "<p0|p1|p2|p3>" \
  --label type:bug \
  --label source:manual
```

Label notes:
- **Priority**: p0 only for "target root unreachable" — the SPA shell
  doesn't load at all, or the TCP connection fails. Never p0 for a
  degraded `/api/v1/health` response; that's the health endpoint doing
  its job. p1 for any must-pass browser flow failure, for every
  `critical` health check, for unparseable health output, and for an
  expired session cookie. p2 for `warn` health checks and the
  passive-observation rules above. p3 per the passive-observation rules.
- **Source**: `source:manual`. `/verify` is not `/scout` — its findings
  are empirical observations of prod, filed by a human-invoked (or
  loop-invoked) run. If you ever want a dedicated `source:verify` label,
  that's a separate change to `.clankerism/labels.json`.

### Step 6: Report (always runs)

Print a compact summary:

```
Target: <url>
Mode: full | health-only
  Walk skipped because: <reason>        (only in health-only mode)
Health checks: <ok count> ok, <warn count> warn, <critical count> critical
Must-pass walk: <N passed> / <M total>  (or: skipped)
Passive walk:   <K findings>            (or: skipped)
New issues: #<N1>, #<N2>, ...
Dedup'd (existing): #<N3>
Artifacts: .clankerism/verify-runs/<timestamp>/
Duration: <Ns>
```

Exit.

## Setup, one-time

To use `/verify` in a fresh checkout:

1. **Required**: write the target URL. This alone unlocks health-only
   mode — enough for a `/loop` canary.
   ```bash
   echo "http://your-prod-url" > .clankerism/verify-target   # http or https
   ```

2. **Optional** (unlocks the full browser walk): seed the session cookie:
   ```bash
   node scripts/oauth-login.mjs  # or log in via a browser and copy the cookie value
   # then write the cookie value to .clankerism/verify-session.json
   ```

3. **Optional** (unlocks the full browser walk): load the Playwright MCP
   plugin in your Claude Code session.

Both `.clankerism/verify-target` and `.clankerism/verify-session.json` are
gitignored. Re-seed the session whenever `/verify` files the "session
expired" issue.

## When to run /verify

- **In a `/loop` as a cheap canary**: `/loop 2h /verify` (or similar).
  Health-only mode is the expected steady state for looped runs —
  fingerprint dedup keeps the queue clean.
- **Before a release**: point verify at prod and confirm nothing has
  silently rotted. Full mode preferred.
- **After a dashboard-heavy PR merges to main**: same idea — main is
  deployed; did anything break that the unit tests missed?
- **When the user says "check the dashboard"**: that's a verify run.

## Things you will be tempted to do and must not

- **Fix the regression you just found.** No. File it. `/fix` handles the
  fix; `/verify` is strictly observe-and-report.
- **Retry a flaky flow until it passes.** One reload, no more. Flaky is
  its own bug and deserves its own issue.
- **Drive writes on prod "just to test the happy path".** Never. If you
  need to test a write flow, that's a unit test or an integration test,
  not `/verify`.
- **Skip the screenshot because the failure is "obvious".** No. Future
  you, reading the issue three weeks later, will thank present you.
- **Delete `.clankerism/verify-runs/` artifacts without the user's ok.**
  They may be the only record of a transient regression.
- **Abort a looped run because the walk prereqs are missing.** The whole
  point of the hard/soft prereq split is that a loop can keep polling
  health even without a seeded cookie. Degrade, don't abort.
