#!/usr/bin/env bash
# One-shot migration: .evolve-state.md + .research-queue.md → GitHub Issues.
# Idempotent via the <!-- clanker-fingerprint:LEGACY-ID --> marker in each body.
# Archived here after successful run — do not re-run blindly.
#
# Usage:
#   bash .clankerism/archive/migrate-queue.sh            # dry-run (default)
#   bash .clankerism/archive/migrate-queue.sh --execute  # actually create issues
set -euo pipefail

MODE="dry-run"
if [[ "${1:-}" == "--execute" ]]; then
  MODE="execute"
fi

# Issue definitions. Tab-separated: LEGACY_ID | PRIORITY | TYPE | TITLE
# Bodies live in a heredoc block keyed by LEGACY_ID, below.
ITEMS=$(cat <<'TSV'
C-019	p0	bug	VPS: add working LLM API key to .env
M-008	p2	refactor	Centralize PipelineTab /status fetch via useStatus()
M-011	p2	bug	Distinguish "not configured" vs "auth failed" for optional API keys
M-012	p2	bug	Add runtime integration test for invalid-key-at-runtime scenario
M-013	p2	bug	Add real-consumer 503 slip-through test for StatusProvider
H-057	p1	refactor	Split 2683-line src/server.ts god file into route modules
H-058	p1	bug	Fix insertEvents() N+1 with multi-row INSERT
H-059	p1	bug	Proactive token estimation before synthesize to avoid API overflow
H-060	p1	bug	Tighten Zod schemas in src/process/schemas.ts (remove .default([]))
M-081	p2	bug	Backpressure asymmetric — add ready-item count monitor/alert
M-082	p2	feature	Add structured metrics for chunking/entity resolution/LLM budgets
M-083	p2	bug	Align pre-summarizer/summarizer token budgets (4000 vs 6000 chars)
M-084	p2	bug	Make resolveAuthorCall() transactional (CTE or explicit tx)
M-085	p2	refactor	Add partial index on entity_mentions(sentiment)
M-086	p2	bug	LLM cost tracking: fix stale pi-ai pricing + per-model aggregation
M-087	p2	bug	Chat token tracking undercounts (ignores system prompt + tool results)
M-088	p2	bug	Entity relationship POST: add enum constraints
M-089	p1	refactor	Split ReportView 1648-line god component
M-090	p2	refactor	Extract useReportPreviewState() hook from Search page
M-091	p2	refactor	Shared dashboard formatting.ts + useAsyncData() hook
M-092	p2	refactor	Refactor 30+ brittle regex-match tests to behavior tests
M-093	p2	bug	Dashboard tests: add error/loading/empty state scenarios
M-094	p2	bug	Replace Record<string, unknown> mappers with pool.query<T> types
TSV
)

body_for() {
  case "$1" in
    C-019) cat <<'BODY'
## Context

Source: `.evolve-state.md` Cycle 369 (product-audit).

VPS has no LLM API key configured. `NORMALIZER_MODEL` / `CHUNK_MODEL` /
`THINKALOT_MODEL` default to `openai-codex:gpt-5.4-mini` but no
`OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is in `.env`. All LLM calls fail:
translation, Stage 1 summarize, Stage 3 synthesize, daily reports.

38 ingested items stuck as failed/filtered.

## Acceptance

- [ ] Valid LLM API key in VPS `.env` for the provider that the three tier
      vars are pointed at
- [ ] `npm run start` boots without auth errors from pi-ai
- [ ] A single Stage 1 summarize succeeds end-to-end against production data

## Notes

User action required — a clanker cannot provision secrets on the VPS.
Marked `state:blocked` until the user drops the key in.
BODY
    ;;
    M-008) cat <<'BODY'
## Context

Source: `.evolve-state.md` M-008 (codex-adversarial, cycle 386;
attempted cycle 388, reverted).

`dashboard/src/pages/Settings.tsx:2839` — PipelineTab still performs its
own `/status` fetch for the dashboard counter strip even though
`StatusProvider` already fetches the same endpoint.

Cycle 388 rewired PipelineTab to consume `status.*` from `useStatus()`
but reverted because 7 Settings tests render `<Settings />` without
wrapping in `<StatusProvider>`, so `statusReady` stays default-false
forever.

## Acceptance

- [ ] PipelineTab reads counters from `useStatus()` only — no local fetch
- [ ] All Settings tests either wrap in `<StatusProvider>` OR use the
      module-level `vi.mock('../../components/StatusProvider', ...)`
      pattern that the Phase 0 fix introduced
- [ ] No duplicate `/api/v1/status` requests in the dashboard
BODY
    ;;
    M-011) cat <<'BODY'
## Context

Source: `.evolve-state.md` M-011 (verify-edge-cases, cycle 387).

Runtime vs startup divergence for optional API keys.
`Boolean(config.fredApiKey)` passes at startup whenever the env var is a
non-empty string, so `config.disabledFeatures.macro.disabled` is `false`
even when the key is rejected by FRED at runtime.

`src/macro/fred.ts:95-98,146-150` logs the upstream 401/403 as a
per-series warning, returns `[]`, and the pipeline caches nothing. The
guarded `/api/v1/macro` endpoint then reads an empty
`getLatestMacroSnapshots(pool)` result
(`src/server-insight-routes.ts:57-61`) and returns
`404 "No macro data available yet"` instead of a `503 feature_disabled`.

Same pattern applies to `COINGECKO_API_KEY` and `GEMINI_API_KEY`.

Net effect: an operator with a misconfigured (wrong/expired) key sees an
empty dashboard card with no hint that the upstream auth failed — the
"not configured" vs "misconfigured" states are indistinguishable.

## Acceptance

- [ ] Track upstream auth failures in a runtime flag on each tracker
      (e.g., `createFredMacroFetcher` sets a `keyRejected` flag on 401/403)
- [ ] Expose it via `disabledFeatures` alongside the startup-time flag
- [ ] Surface a distinct "auth failed" copy variant in FeatureDisabledCard
BODY
    ;;
    M-012) cat <<'BODY'
## Context

Source: `.evolve-state.md` M-012 (verify-edge-cases, cycle 387).

Missing runtime regression test for the invalid-key-at-runtime scenario.

`test/unit/features.test.ts`, `test/unit/feature-guards-api.test.ts`, and
`test/unit/cycle386-dashboard-feature-disabled.test.ts` are all
structural source-string scans or pure-function unit tests. No test
boots the pipeline with `FRED_API_KEY=badkey` /
`COINGECKO_API_KEY=badkey` / `GEMINI_API_KEY=badkey` to verify that:

1. The fetch cycle logs the auth failure
2. `/status` reports the right disabled-features shape
3. The UI renders the correct empty state vs error state

Without this, M-011 and any future refactor of the fetcher error-handling
path can silently regress.

## Acceptance

- [ ] Integration test in `test/integration/` runs the scheduler once
      with bad keys and asserts logger output + endpoint responses
- [ ] Depends on M-011 landing first
BODY
    ;;
    M-013) cat <<'BODY'
## Context

Source: `.evolve-state.md` M-013 (codex-adversarial, cycle 388).

`dashboard/src/components/__tests__/StatusProvider.test.tsx` — the
runtime tests added for M-010 prove provider bookkeeping (ready flip,
registerDisabledFeature merge, dedupe) but never mount a real consumer
page under StatusProvider to exercise a real 503 slip-through.

A regression of the cycle 386 load-order bug (consumer effect fires
before `statusReady`) could still slip through.

## Acceptance

- [ ] Integration-style tests render a real page
      (Settings, ReportView, or ReportList) wrapped in
      `<StatusProvider>` + `<MemoryRouter>` with mocked `/api/v1/status`
      and a mocked 503 on the consumer endpoint
- [ ] Assert "no downstream request before ready"
- [ ] Assert "FeatureDisabledCard renders when a 503 slips through"
- [ ] Blast radius: touches M-008's test-wrapping problem — may need
      a shared `renderSettings(...)` test helper
BODY
    ;;
    H-057) cat <<'BODY'
## Context

Source: `.research-queue.md` H-057.

`src/server.ts` is a 2683-line god file with 35+ routes, 41 inline
queries, and duplicated logic.

Progress: Cycles 380-381 extracted the insight/watchlist cluster and
calendar-event CRUD routes into dedicated modules
(`src/server-insight-routes.ts`, `src/server-calendar-routes.ts`).

Still remaining: report/search/source/entity/admin route clusters.

## Acceptance

- [ ] Extract report routes into `src/server-report-routes.ts`
- [ ] Extract search routes into `src/server-search-routes.ts`
- [ ] Extract source routes into `src/server-source-routes.ts`
- [ ] Extract entity routes into `src/server-entity-routes.ts`
- [ ] Extract admin routes into `src/server-admin-routes.ts`
- [ ] `src/server.ts` < 500 lines
- [ ] All existing tests still pass

Can be landed incrementally across multiple PRs (one per cluster).
BODY
    ;;
    H-058) cat <<'BODY'
## Context

Source: `.research-queue.md` H-058.

`src/db/queries.ts:430-468` — `insertEvents()` does one INSERT per
event (N+1).

## Acceptance

- [ ] Convert to a single multi-row INSERT (or `COPY`) with a parameterized
      batch
- [ ] Benchmark: inserting 1000 events is at least 10x faster than the
      current loop
- [ ] Same test coverage as today passes
BODY
    ;;
    H-059) cat <<'BODY'
## Context

Source: `.research-queue.md` H-059.

`src/process/synthesize.ts` has no proactive token estimation before
synthesis. Huge prompts hit the provider before we know they'll overflow.

## Acceptance

- [ ] Estimate tokens (content/4 heuristic or pi-ai tokenizer) before
      the synthesize LLM call
- [ ] Trim the input or abort if above the model's context budget
- [ ] Log the trim decision so we can observe it
- [ ] New unit test covers the trim/abort path
BODY
    ;;
    H-060) cat <<'BODY'
## Context

Source: `.research-queue.md` H-060.

`src/process/schemas.ts:36-56` — Zod schemas use `.default([])` allowing
the LLM to omit critical fields silently.

## Acceptance

- [ ] Remove `.default([])` on entity fields
- [ ] Add cross-field validation (e.g., a claim must reference at least
      one entity)
- [ ] Existing prompt regression tests in `test/prompts/` still pass
BODY
    ;;
    M-081) cat <<'BODY'
## Context

Source: `.research-queue.md` M-081.

Backpressure is asymmetric — ingest floods can starve downstream
processing.

## Acceptance

- [ ] Monitor ready-item count in the scheduler
- [ ] Alert via `ALERT_WEBHOOK_URL` if `> 5000` for more than one polling
      window
- [ ] Unit test covers the alert threshold
BODY
    ;;
    M-082) cat <<'BODY'
## Context

Source: `.research-queue.md` M-082.

Missing observability — no structured metrics on chunking, entity
resolution, or LLM budgets.

## Acceptance

- [ ] Add structured log lines (or metric hooks) for:
  - Chunk size distributions
  - Entity resolution hit/miss rates
  - LLM budget consumption per stage
- [ ] Log format is machine-parseable
- [ ] Documented in `docs/`
BODY
    ;;
    M-083) cat <<'BODY'
## Context

Source: `.research-queue.md` M-083.

Pre-summarizer and summarizer token budgets are misaligned
(4000 vs 6000 chars). Downstream chunks can be larger than the
downstream budget expects.

## Acceptance

- [ ] Align both budgets to 5500 chars (or a shared constant)
- [ ] Document the choice in the module header
- [ ] Existing summarize tests pass
BODY
    ;;
    M-084) cat <<'BODY'
## Context

Source: `.research-queue.md` M-084.

`src/db/queries.ts:3220-3248` — `resolveAuthorCall()` is not
transactional. Concurrent callers can race on insert/upsert.

## Acceptance

- [ ] Wrap in a single transaction (or rewrite as a CTE)
- [ ] Existing tests still pass
- [ ] Add a concurrency test that proves the race is gone
BODY
    ;;
    M-085) cat <<'BODY'
## Context

Source: `.research-queue.md` M-085.

Missing partial index on `entity_mentions(sentiment)`.

## Acceptance

- [ ] Add a new migration creating the partial index
- [ ] `EXPLAIN` on the common sentiment-filter query shows an index scan
- [ ] Backward-compatible migration (ADD INDEX is safe)
BODY
    ;;
    M-086) cat <<'BODY'
## Context

Source: `.research-queue.md` M-086.

LLM cost tracking relies on stale pi-ai pricing.

## Acceptance

- [ ] Add attempt-level tracking (one row per call, not per batch)
- [ ] Per-model cost aggregation
- [ ] Existing cost reporting still works
BODY
    ;;
    M-087) cat <<'BODY'
## Context

Source: `.research-queue.md` M-087.

Chat token tracking undercounts — it ignores the system prompt and
tool results when measuring consumption.

## Acceptance

- [ ] Use the LLM response usage metadata (input/output tokens) rather
      than estimating
- [ ] Chat budget enforcement uses the new numbers
- [ ] Existing `chat_daily_usage` accounting still works
BODY
    ;;
    M-088) cat <<'BODY'
## Context

Source: `.research-queue.md` M-088.

Entity relationship POST endpoint accepts arbitrary strings for
relationship type.

## Acceptance

- [ ] Add an enum constraint on the allowed relationship types
- [ ] Fastify schema validates before handler runs
- [ ] Invalid values return 400 with a clear error
BODY
    ;;
    M-089) cat <<'BODY'
## Context

Source: `.research-queue.md` M-089.

`dashboard/src/pages/ReportView.tsx` is a 1648-line god component.

## Acceptance

- [ ] Extract per-type sub-components (one file per report type)
- [ ] Shared formatting utilities live in a separate file
- [ ] Behavior unchanged — all ReportView tests still pass
- [ ] Can be landed incrementally
BODY
    ;;
    M-090) cat <<'BODY'
## Context

Source: `.research-queue.md` M-090.

Search page has 8 separate `useState` dictionaries for per-result
preview state — hard to reason about.

## Acceptance

- [ ] Extract into `useReportPreviewState()` custom hook
- [ ] Existing Search tests pass
BODY
    ;;
    M-091) cat <<'BODY'
## Context

Source: `.research-queue.md` M-091.

~300 lines of duplicated formatting code across dashboard pages
(timestamps, numbers, sentiment, etc.).

## Acceptance

- [ ] Extract into shared `dashboard/src/lib/formatting.ts`
- [ ] Extract data-fetching boilerplate into a shared `useAsyncData()` hook
- [ ] No behavior change — all page tests pass
BODY
    ;;
    M-092) cat <<'BODY'
## Context

Source: `.research-queue.md` M-092.

30+ regression tests are brittle source-code regex matches — they break
on Prettier reformatting and don't actually verify behavior.

## Acceptance

- [ ] Refactor to behavior-level tests (render/assert DOM or API response)
- [ ] Can be done incrementally, one file at a time
- [ ] Coverage does not drop
BODY
    ;;
    M-093) cat <<'BODY'
## Context

Source: `.research-queue.md` M-093.

Dashboard tests don't cover error, loading, or empty states — only
happy paths.

## Acceptance

- [ ] Each page test file has at least one fetch-failure scenario
- [ ] Each page test file has at least one empty-state scenario
- [ ] Loading-state assertions where applicable
BODY
    ;;
    M-094) cat <<'BODY'
## Context

Source: `.research-queue.md` M-094.

Many query mappers use `Record<string, unknown>` as the row type —
silent column rename failures don't surface until runtime.

## Acceptance

- [ ] Replace `Record<string, unknown>` with explicit row interfaces
- [ ] Use `pool.query<T>` with those interfaces
- [ ] TypeScript catches column rename mismatches at compile time
BODY
    ;;
    *)
      echo "ERROR: unknown LEGACY_ID: $1" >&2
      return 1
    ;;
  esac
}

printf 'Mode: %s\n' "$MODE"
printf '===\n'

COUNT=0
while IFS=$'\t' read -r id priority type title; do
  [[ -z "$id" ]] && continue
  COUNT=$((COUNT + 1))

  STATE_LABEL="state:ready"
  if [[ "$id" == "C-019" ]]; then
    STATE_LABEL="state:blocked"
  fi

  BODY_TEXT=$(body_for "$id")
  BODY_TEXT+=$'\n\n<!-- clanker-fingerprint:'"$id"' -->'

  printf '[%02d] %s  %s  %s  %-55s  %s\n' "$COUNT" "$priority" "$type" "$STATE_LABEL" "$title" "($id)"

  if [[ "$MODE" == "execute" ]]; then
    existing=$(gh issue list --search "clanker-fingerprint:$id in:body" --state all --json number --jq '.[0].number' 2>/dev/null || echo "")
    if [[ -n "$existing" ]]; then
      printf '     -> skipping: issue #%s already carries the fingerprint\n' "$existing"
      continue
    fi

    gh issue create \
      --title "$title" \
      --body "$BODY_TEXT" \
      --label "$STATE_LABEL" \
      --label "$priority" \
      --label "type:$type" \
      --label "source:migration" \
      > /dev/null

    printf '     -> created\n'
  fi
done <<< "$ITEMS"

printf '===\n'
printf 'Total: %d item(s)\n' "$COUNT"
if [[ "$MODE" == "dry-run" ]]; then
  printf '\nThis was a dry run. Re-run with --execute to create the issues.\n'
fi
