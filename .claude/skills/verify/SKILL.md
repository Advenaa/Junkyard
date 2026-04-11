---
name: verify
description: Prod-only browser regression watcher for the Podders dashboard. Drives a real browser against the live VPS to catch layout breaks, JS exceptions, broken nav, and silent data-fetch failures. Read-only. Files any regression it finds as a GitHub Issue.
---

# /verify — Clankerism Regression Watcher

The food taster. Unit tests prove the ingredients work; `/verify` confirms
the dish is actually edible in a real browser pointed at the live site.

`/verify` is the 4th Clankerism role. It is the only clanker that drives a
real browser, and the only clanker that talks to prod. It never writes —
not to the codebase, not to the database, not to prod. Its entire job is
to walk the dashboard, observe, and file issues for anything broken.

## Invocation

```
/verify
```

No flags, no modes. One target: prod. The prod URL is read from
`.clankerism/verify-target` (one line, no trailing slash). If that file is
missing, exit with a setup error.

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
5. **Screenshots are mandatory** for any regression filed. A regression
   without visual evidence is not a regression — it's a guess.
6. **One retry for flake, then file it.** If a flow fails, reload once. If
   it fails again, file the regression. Don't loop to make it pass.

## Prerequisites

Checked in order at the top of every run. If any check fails, report the
specific missing piece to the user and exit — do not proceed to the walk.

1. `.clankerism/PAUSED` must not exist.
2. `.clankerism/verify-target` must exist and contain a single https URL.
3. `.clankerism/verify-session.json` must exist. This file holds the
   `podders_session` cookie value seeded manually once via
   `scripts/oauth-login.mjs` (or by hand). `/verify` does not try to log in
   interactively — if the session is expired or missing, it files a p1
   issue "verify: session expired, re-seed `.clankerism/verify-session.json`"
   and exits.
4. Playwright MCP tools must be available in the current session (the
   `playwright__browser_*` tool family). If they aren't, exit with
   "playwright unavailable — load the Playwright MCP plugin". Do not try
   to fall back.

## Flow

### Step 1: Preflight

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
  single p1 "verify: health endpoint unparseable" and continue — the
  browser walk is still meaningful.
- Create `.clankerism/verify-runs/<ISO-timestamp>/` to hold this run's
  artifacts.

### Step 2: Auth setup

- Read `.clankerism/verify-session.json`. Inject the `podders_session`
  cookie into the Playwright browser context before the first navigation.
- Navigate to the target root. If the page redirects to `/login`, the
  session is dead — file the p1 "session expired" issue described in the
  prerequisites section and exit.

### Step 3: Walk the must-pass flows

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

### Step 4: Walk the passive observations

Same navigation pattern, but findings here become p2 or p3 — they don't
fail the run.

- **p2**: console `error` level messages that don't block rendering;
  network requests returning 5xx on any walked page; `<img>` 404s;
  uncaught promise rejections.
- **p3**: console `warn` level messages; network 4xx that aren't handled
  as explicit empty/error states; page loads that take longer than 3s to
  reach network idle.

### Step 5: File regressions

For each finding, dedup by fingerprint first. The fingerprint is a short
hash of `(flow, symptom, URL path)` so the same broken nav item doesn't
produce a new issue every run.

```bash
gh issue list --label type:bug --search "clanker-fingerprint:verify-<flow>-<hash>" --state open
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
  `critical` health check, and for unparseable health output. p2 for
  `warn` health checks and the passive-observation rules above. p3 per
  the passive-observation rules.
- **Source**: `source:manual`. `/verify` is not `/scout` — its findings
  are empirical observations of prod, filed by a human-invoked run. If
  you ever want a dedicated `source:verify` label, that's a separate
  change to `.clankerism/labels.json`.

### Step 6: Report to the user

Print a compact summary:

```
Target: <url>
Must-pass: <N passed> / <M total>
Passive: <K findings>
New issues: #<N1>, #<N2>, ...
Dedup'd (existing): #<N3>
Artifacts: .clankerism/verify-runs/<timestamp>/
Duration: <Ns>
```

Exit.

## Setup, one-time

To use `/verify` in a fresh checkout:

1. Write the target URL:
   ```bash
   echo "https://your-prod-url" > .clankerism/verify-target
   ```
2. Seed the session cookie:
   ```bash
   node scripts/oauth-login.mjs  # or log in via a browser and copy the cookie value
   # then write the cookie value to .clankerism/verify-session.json
   ```
3. Ensure the Playwright MCP plugin is loaded in your Claude Code session.

Both files are gitignored. Re-seed the session whenever `/verify` files
the "session expired" issue.

## When to run /verify

- **Before a release**: after you think main is shippable, point verify
  at prod and confirm nothing has silently rotted.
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
