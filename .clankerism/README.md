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
