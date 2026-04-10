# Scout State

Persistent memory for the `/scout` clanker. This file is editable only by
`/scout` during a scout run — not by `/build`, `/fix`, or humans (except to
reset state).

## Last full sweep

- **Cursor**: never-run
- **Commit**: —
- **Date**: —

## Next sweep plan

`/scout` decides the next audit type by rotating:
`product-level → system-level → code-level → <repeat>`.

Next sweep type: **product-level** (first run)

## Open findings (scout-local)

None. All legacy findings have been migrated to GitHub Issues under
`source:migration`. `/scout` will fingerprint new findings into issues
directly and dedupe via `gh issue search clanker-fingerprint:<ID>`.

## Notes for the next scout

- The legacy queues carried 23 open items across 6 months. See
  `.clankerism/archive/research-queue.md` and
  `.clankerism/archive/evolve-state.md` for the pre-migration state.
- The Clankerism rollout happened at commit `<PHASE-1-COMMIT>` — before that
  date, findings were tracked in markdown; after, they're GitHub Issues.
- Don't re-file anything that already carries a `source:migration` label
  unless the legacy description was materially wrong.
