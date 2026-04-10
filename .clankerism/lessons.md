# Clankerism Lessons

Durable, still-relevant lessons distilled from 390+ legacy `/evolve` cycles.
This is **not** a changelog — per-cycle history lives in git + `archive/`.

Rule: add a lesson only when it is non-obvious AND has cost us time more than
once. Delete it the moment it stops being true.

---

## Core principle

**Product completeness > code quality.** 128 cycles of code audits shipped
while the dashboard still couldn't add a source. Always check: can the user
complete the core workflow end-to-end?

---

## Recurring bug patterns

- **Epoch ms vs seconds** — `to_timestamp(created_at)` treats ms as seconds.
  All epoch-ms columns are `BIGINT` (Migration 13). Watch any new code touching
  `created_at`.
- **BIGINT returned as strings** — node-postgres OID 20 has no type parser.
  We set `pg.types.setTypeParser(20, parseInt)` once in `db/connection.ts`.
- **`json_agg` without `ORDER BY`** — non-deterministic row order. Any
  `result[0]` from `json_agg` is vulnerable.
- **Zod empty strings** — `z.string()` allows `""`. All LLM-output name/title
  fields must have `.min(1)`.
- **`console.error` bypasses pino** — always use the logger for anything that
  might contain a secret.
- **Dashboard ↔ API gaps** — backend endpoints shipped but never surfaced in
  UI. Cross-check `server*.ts` routes against dashboard `fetch()` calls before
  closing a feature.
- **`set-state-in-effect` fetch gate** — cycle 386. Effects that depend on
  the `StatusProvider` disabled-feature map MUST wait for `statusReady` before
  firing, or they'll probe a known-503 endpoint and waste the request.
- **Source identity is a composite key** — cycle 390. `(source, sourceId)`
  is the only correct identifier. Bare `sourceId` collides across source
  kinds (Discord guild:123 vs Twitter handle:123).
- **URL-encoded path comparisons** — cycle 389. Test fetch stubs that compare
  `parsed.pathname` must `decodeURIComponent()` first — we `encodeURIComponent`
  on `sourceId` before building request URLs.

---

## Build strategy

- **Parallel agents need clean file boundaries.** When one agent touches two
  files that another agent also touches, merge conflicts kill the
  parallelism win. Split by file, not by "concern".
- **Audit passes catch real bugs.** Every time an audit was skipped due to
  time pressure, a production bug landed within two cycles. Audit is not
  optional — it's part of the build.
- **Structural tests (regex-match source code) are brittle.** They break on
  Prettier reformatting and don't actually verify behavior. Prefer
  behavior-level tests (render + assert DOM, or hit API + assert response).
- **Feature builds need 5–6 specialized agents** (schema, impl, integration,
  prompt, dashboard, test) rather than one do-everything agent. Briefs must
  be precise enough that agents can run in parallel without stepping on
  each other.

---

## CI + deploy pitfalls

- **Health check: check-for-any-response, not 200.** Auth-required endpoints
  return 401 to unauthenticated curl; `/health` itself returns 503 for
  data-level degradation (not server failure). Pattern:
  `curl -s -o /dev/null -w '%{http_code}'` and verify `!= "000"`.
- **Non-blocking CI gates rot.** If lint/format/test is `continue-on-error`,
  it will drift until the baseline is un-fixable. Either fix it now or turn
  it off — "soft warning" is a lie.
- **Don't mock the database in integration tests.** Mocked tests pass while
  the real migration fails. We've been burned by this — if it needs a DB,
  use the CI Postgres service.

---

## Scouting strategy

- **Alternate audit types**: product-level → system-level → code-level.
  Product-level checks UI completeness. System-level traces data flows.
  Code-level audits specific files. Each finds a different class of bug.
- **New features are the highest-yield audit targets.** New code always has
  more bugs than mature code. Scout the last cycle's diff first.
- **False positives need verification.** Cross-reference new findings
  against prior intentional changes and CLAUDE.md design decisions before
  filing the issue.
