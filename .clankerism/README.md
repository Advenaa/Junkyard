# Clankerism

Clankerism is the work-queue model that replaced the old single-agent `/evolve` loop.
Work is represented as **GitHub Issues**, not files in this directory. This folder
holds only the state that doesn't fit in issues themselves.

## Directory layout

```
.clankerism/
  README.md         # this file
  labels.json       # the 14-label taxonomy (source of truth for labels)
  lessons.md        # durable build lessons — short, curated (not a changelog)
  scout-state.md    # /scout's memory: last full-sweep cursor, open findings
  PAUSED            # touch this file to halt every clanker gracefully (soft brake)
  archive/          # legacy state files preserved for history
```

## The 4 roles

| Skill    | Role           | Analogy                                      |
|----------|----------------|----------------------------------------------|
| `/scout` | Producer       | Restaurant inspector — finds problems, files issues |
| `/build` | Consumer       | Line cook — claims an issue, ships a PR      |
| `/fix`   | On-demand      | Handyman — called when something's on fire   |
| `/verify`| Regression     | Food taster — browser-level smoke tests      |

## Label taxonomy

Every issue carries exactly **one** label from each axis:

- **state** — `ready` | `in-progress` | `blocked` | `stale`
- **priority** — `p0` | `p1` | `p2` | `p3`
- **type** — `bug` | `refactor` | `feature`
- **source** — `scout` | `manual` | `migration`

See `labels.json` for colors and descriptions.

## Soft brake

```bash
touch .clankerism/PAUSED
```

Every clanker checks for this file before taking destructive action (claiming
an issue, pushing a branch, opening a PR). Remove the file to resume.

## Safety model (no GitHub Pro)

This repo is private on the free GitHub plan, so branch protection /
rulesets are unavailable. Enforcement lives locally instead of on GitHub's
servers. Four layers, in order:

1. **Pre-push hook** (`scripts/hooks/pre-push`, auto-installed by
   `npm ci` via `postinstall`). Hard-rejects:
   - Any push to `main` (unless `CLANKERISM_ALLOW_MAIN=1` is set)
   - Any force-push anywhere (unless `CLANKERISM_ALLOW_FORCE=1` and the
     branch is not `main`)

2. **`gh run watch` in `/build`**. Instead of relying on GitHub's
   `--auto` merge (flaky without branch protection), the clanker blocks
   on `gh run watch <run-id> --exit-status` and only calls `gh pr merge
   --squash` when CI is green. If CI is red, the PR stays open, the
   issue is flipped to `state:blocked`, and the clanker exits.

3. **Deploy job `needs: build-and-test`** (in `.github/workflows/ci.yml`).
   Even if a bad commit somehow lands on main, the deploy step refuses
   to fire unless CI is green on that commit. The VPS stays on the last
   known-good hash.

4. **PAUSED brake** (above). Emergency stop when something looks wrong.

### Emergency override procedure

Every override is logged to `.clankerism/override-log.txt` for post-hoc
review.

```bash
# Direct push to main (requires a human to acknowledge)
CLANKERISM_ALLOW_MAIN=1 git push origin main

# Force-push a feature branch (main is still off-limits)
CLANKERISM_ALLOW_FORCE=1 git push --force origin <some-branch>
```

Never set both at once. Never use `--no-verify` — that bypasses the
hook entirely and defeats the safety model.

### Known uncovered risks

- A clanker running on a machine without the pre-push hook installed.
  Mitigation: `npm ci` auto-installs the hook via `postinstall`. Any
  environment that runs `npm ci` (local, CI, a future contractor's box)
  gets the hook for free.
- A skill file deliberately edited to use `--no-verify`. Mitigation:
  every skill change goes through a PR; human reviewer checks the diff.
  `grep -r '--no-verify' .agents/ .claude/` must stay empty.

If any of this becomes load-bearing (e.g. you add a contributor), upgrade
to GitHub Pro and turn on real branch protection — this convention-based
layer is a stopgap, not a permanent answer.
