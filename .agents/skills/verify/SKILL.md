---
name: verify
description: Browser-level regression watcher. Drives a real browser against the dashboard (local dev server or the VPS) to catch behavior that unit tests miss — layout breaks, JS runtime errors, broken nav, silent data-fetch failures. Files any regression it finds as a GitHub Issue.
---

# /verify — Clankerism Regression Watcher

The food taster. Unit tests prove the ingredients work; `/verify` confirms
the dish is actually edible in a real browser. Drives Playwright through
the key dashboard flows, looks for anything a unit test would miss
(layout collapse, JS runtime errors, 5xx responses, blank screens,
navigation that "works" but lands on an error state).

`/verify` is the 4th Clankerism role. Unlike `/scout` (which reads source
code) and `/build` (which writes source code), `/verify` is the only
clanker that drives a real browser.

**Invocation**:

- `/verify` — run the full smoke suite against the default target (local)
- `/verify local` — force local dev server (`http://localhost:3000`)
- `/verify prod` — run against the VPS (`http://77.90.51.87:3000` — read-only flows only)
- `/verify pr <N>` — run against a PR branch (checks out, boots, tests, cleans up)

## Hard rules

1. **Never write to production.** In `prod` mode, only read-only flows
   run: load pages, click through nav, observe. No form submits, no
   config changes, no source toggles. The only allowed writes on prod
   are Discord OAuth login to establish a session.
2. **Never modify source code.** Like `/scout`, `/verify` is read-only
   against the codebase. It only writes GitHub Issues (for regressions)
   and its own screenshots/artifacts under `.clankerism/verify-runs/`
   (gitignored).
3. **Check the PAUSED brake.** If `.clankerism/PAUSED` exists, exit.
4. **No new issue types.** Regressions found by `/verify` are filed as
   `type:bug` with `source:scout` (yes — `/verify` files under scout
   because it's a finding, not a build task).
5. **Never claim or close issues.**
6. **Screenshots are mandatory** for any regression filed. A regression
   without visual evidence is not a regression — it's a guess. Attach
   the screenshot to the issue.

## What a smoke run covers

### Must-pass flows (fail the run if any break)

1. **Auth**: Land on `/`, follow login, reach the home page authenticated.
2. **Nav**: Click every item in the main nav. Every landing page must
   render without a visible error state and without console errors.
3. **Reports list**: `/reports` loads at least one report row OR shows a
   valid empty state (not a blank screen).
4. **Report detail**: Click the first report. Detail page loads. No
   unhandled rejection in console.
5. **Raw feed**: `/feed` loads. Either shows at least one source OR shows
   the no-sources empty state.
6. **Chat**: `/chat` loads. Input box is reachable. (Don't actually send
   a message in prod mode.)
7. **Settings** (local mode only): Every tab opens. Save button on each
   tab is enabled for a valid config.

### Passive observations (file issues but don't fail the run)

- Console warnings / errors that don't block the page
- Slow responses (>3s for any page load)
- Broken image URLs (404 on `<img src>`)
- Network requests returning 4xx/5xx that aren't handled as explicit
  empty/error states
- Layout breaks at common breakpoints (desktop, tablet, mobile)

## Prerequisites

- Playwright MCP server available (check via `/verify` spawning the
  `playwright__browser_navigate` tool — if it errors out, exit with
  "playwright unavailable").
- For local mode: `npm run dev` running on port 3000, OR the skill starts
  it in the background and tears it down after.
- Authenticated Discord session cookie (for prod mode — store in
  `.clankerism/verify-session.json`, gitignored, user-seeded once).

## Flow

### Step 1: Preflight

```bash
if [ -f .clankerism/PAUSED ]; then
  echo "PAUSED — exiting"
  exit 0
fi

# Decide target
TARGET="${1:-local}"
case "$TARGET" in
  local) BASE_URL="http://localhost:3000" ;;
  prod)  BASE_URL="http://77.90.51.87:3000" ;;
  pr)    # check out the PR branch locally, run `npm run build`, start it
         ;;
  *)     echo "unknown target: $TARGET"; exit 1 ;;
esac
```

For `local` target: verify the dev server is up (`curl -s -o /dev/null
-w '%{http_code}' $BASE_URL/api/v1/health` returns a response). If not,
start it in the background and wait until the health check comes back.

### Step 2: Auth setup

- **local**: use a seeded viewer account or bypass auth via the
  development bootstrap admin ID.
- **prod**: load `.clankerism/verify-session.json`, inject the
  `podders_session` cookie into the Playwright context.

If auth setup fails, file a p1 issue "Cannot authenticate for verify run"
and exit.

### Step 3: Walk the must-pass flows

For each flow in the must-pass list:

1. Navigate.
2. Wait for network idle.
3. Screenshot.
4. Read console messages.
5. Assert:
   - No uncaught exceptions in console.
   - Page has rendered (not a blank `<div id="root"></div>`).
   - Expected landmark element exists (e.g., `<h1>` on reports list).
6. If the assertion fails, save the screenshot + console log to
   `.clankerism/verify-runs/<timestamp>/<flow>/` and mark the flow as
   failed.

### Step 4: Walk the passive observations

Same pattern, but failures become p2 or p3 issues rather than p1.

### Step 5: File regressions

For each failed flow:

```bash
gh issue create \
  --title "verify regression: <flow name> on <target>" \
  --body "$(cat <<EOF
## Summary
The must-pass <flow name> flow failed on $TARGET during verify run <run-id>.

## Evidence
- Screenshot: attached
- Console log: attached
- Timestamp: <ISO 8601>
- Commit: $(git rev-parse --short HEAD)

## Steps to reproduce
1. ...
2. ...
3. ...

## What happened
<observed>

## What should happen
<expected>

<!-- clanker-fingerprint:verify-<flow>-<short-hash> -->
EOF
)" \
  --label state:ready \
  --label "<p1|p2|p3>" \
  --label type:bug \
  --label source:scout
```

Dedup via the fingerprint marker, same mechanism as `/scout`.

### Step 6: Report

Tell the user:

```
Target: <local|prod|pr>
Flows: <N passed>, <M failed>
Passive findings: <K>
Regressions filed: #<N1>, #<N2>, ...
Artifacts: .clankerism/verify-runs/<timestamp>/
Duration: <Ns>
```

Exit.

## When to run /verify

- **Before every release**: `/verify prod`. Confirms the live site still
  works.
- **After a large refactor PR merges**: `/verify local` against main.
- **Nightly cron** (future): `/verify prod` as a regression canary.
- **User-initiated**: user says "check the dashboard" → `/verify local`.

## Things you will be tempted to do and must not

- **Fix the regression you just found.** No. File it. `/fix` or `/build`
  handle the fix.
- **Retry a flaky flow 5 times to make it pass.** No — retry once, if
  still failing, file the regression. Flaky is its own bug.
- **Drive writes on prod** "just to test". Never.
- **Disable auth checks** because they're annoying. Never.
- **Delete verify-runs artifacts without the user's ok.** They may be
  the only record of a transient regression.
