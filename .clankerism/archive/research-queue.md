# Fix Queue — Podders v2

**Open: 0 critical, 4 high, 14 medium** (Cycle 381 — H-057 route extraction continued with dedicated insight/watchlist and calendar route modules; H-056 fixed; H-055 fixed; H-054 fixed; H-053 fixed; H-052 fixed; H-050 fixed; H-051 fixed; H-049 fixed; H-061 fixed; C-017 fixed, C-016 verified false positive)

Last scan: Cycle 362 — 7-agent parallel audit added 30 findings [C-016..M-094], production diagnosis added 3 [C-018, H-061, M-095]; updated Cycle 366 for the startup model-validation fix, Cycle 367 for the Sonnet escalation cap plus C-016 verification, Cycle 370 for the H-061 short-Discord chunk filter refinement, Cycle 372 for OAuth rejection padding on callback failure paths, Cycle 373 for per-IP OAuth pending-state limits with TTL cleanup, Cycle 374 for DB-backed chat budget accounting with atomic reservation/refund tracking, Cycle 375 for CSRF protection on the public access-request flow, Cycle 376 for nonce-wrapped chat tool-result framing, Cycle 377 for the webhook delivery circuit breaker plus ops alerting, Cycle 378 for safe daily-cron refresh scheduling with failure-path retention of the previous task, Cycle 379 for provider-scoped LLM auth circuits plus alternate configured-model failover, Cycle 380 for extracting the insight/watchlist routes into `src/server-insight-routes.ts`, and Cycle 381 for extracting the calendar-event CRUD routes into `src/server-calendar-routes.ts`
Tests: 2077 passing, 0 failing.

## Critical

(none)
## Critical (resolved)

- ~~**C-016** — `src/server.ts:570` — Rate limiting is global not per-IP — attacker can DoS all users by exhausting shared 50 req/s bucket.~~ ✅ `pending` (verified false positive in Cycle 367: installed `@fastify/rate-limit` already defaults `keyGenerator` to `request.ip`)
- ~~**C-017** — `src/process/summarize.ts:545-584` — Sonnet escalation has no per-batch cap — unbounded cost spikes on low-confidence batches. Fix: max 2-3 escalations per batch, log and alert.~~ ✅ `pending`
- ~~**C-018** — `src/llm.ts` + pi-ai — Invalid model ID (`gpt-5.4-nano`) causes silent summarizer failure: pi-ai returns undefined API client, items cycle through claim→crash→recovery→failed with no useful error. Fix: validate model exists at startup (test call or pi-ai model registry check), fail fast with clear error.~~ ✅ `pending`
- ~~**DC-020** — `src/db/queries.ts:246` — Discord messages lost: `ON CONFLICT (content_hash)` doesn't match partial unique index `idx_items_content_hash` (`WHERE content_hash IS NOT NULL`). Every Discord message fails normalize with "no unique or exclusion constraint matching the ON CONFLICT specification". Fix: either add `WHERE content_hash IS NOT NULL` to the ON CONFLICT clause, or replace the partial index with a full unique index (column is already NOT NULL so predicate is redundant).~~ ✅ `pending`
- ~~**PD-001** — `dashboard/src/pages/Settings.tsx` — No "Add Source" form~~ ✅ `pending`
- ~~**PD-043** — `src/auth/middleware.ts:48-52` — Middleware demotes DB admin to viewer~~ ✅ `pending`

## High

- **H-057** — `src/server.ts` — 2683-line god file, 35+ routes, 41 inline queries, duplicated logic. Fix: extract route modules + shared serializers. Progress: Cycles 380-381 extracted the insight/watchlist cluster and calendar-event CRUD routes into dedicated modules, but report/search/source/entity/admin route clusters still remain in `server.ts`.
- **H-058** — `src/db/queries.ts:430-468` — insertEvents() N+1 (one INSERT per event). Fix: multi-row INSERT.
- **H-059** — `src/process/synthesize.ts` — No proactive token estimation before synthesis. Fix: estimate tokens, trim if needed, abort before API call.
- **H-060** — `src/process/schemas.ts:36-56` — Zod schemas use .default([]) allowing LLM to omit critical fields. Fix: remove defaults on entities, add cross-field validation.
## High (resolved)

- ~~**H-056** — `src/llm.ts` — No LLM provider failover. 401 halts permanently. Fix: circuit breaker with fallback or cached report surfacing.~~ ✅ `pending` (Cycle 379: 401s now open provider-scoped auth circuits instead of permanently halting the entire LLM subsystem, configured alternate-model providers can take over while the failed provider cools down, and the original provider is retried automatically after cooldown rather than staying down forever)
- ~~**H-055** — `src/scheduler.ts:81-99` — Cron refresh failure silently disables daily synthesis. Fix: try-catch around cron.schedule(), keep old task on failure.~~ ✅ `pending` (Cycle 378: `refreshDailyCron()` now schedules the replacement task before stopping the previous daily cron, logs and preserves the existing task when a rebuild fails, and scheduler coverage now exercises both the failed-refresh retention path and the still-fail-fast startup path)
- ~~**H-054** — `src/deliver/webhook.ts` — Webhook delivery stalls, no circuit breaker. Catch-up retries only 5/hour. Fix: halt after 5 consecutive failures, alert ops.~~ ✅ `pending` (Cycle 377: normal delivery and retry catch-up now stop after 5 consecutive webhook failures, the delivery breaker auto-recovers after a 1-hour cooldown, and a one-shot alert goes to `alertWebhookUrl` when the breaker trips so ops gets paged without repeated spam)
- ~~**H-053** — `src/chat/handler.ts` — Chat tool results not nonce-wrapped (code vs SECURITY.md). Fix: wrap with nonce, escape result body.~~ ✅ `pending` (Cycle 376: chat tool results now frame the whole `Tool: ...` payload inside nonce-tagged `<tool_result_${nonce}>` blocks derived from `llm.wrapWithNonce()`, so malicious tool names or result bodies cannot break out of predictable wrappers, and focused chat-handler coverage proves embedded `</tool_result>` payloads stay escaped before the second LLM round)
- ~~**H-052** — `src/server.ts` + `dashboard/src/pages/Login.tsx` — Missing CSRF on POST /api/v1/access-requests. Fix: add CSRF token or require auth.~~ ✅ `pending` (Cycle 375: public access requests now require a signed SameSite-strict CSRF cookie plus matching `x-csrf-token` header from `/api/v1/access-requests/csrf`, the login modal fetches that token immediately before submit, and focused API/UI coverage proves missing tokens are rejected while the self-service request flow still succeeds)
- ~~**H-050** — `src/chat/handler.ts` + `src/db/queries.ts` — Chat token budget in-memory with race condition allows 2x bypass. Fix: move to DB with row-level locking.~~ ✅ `pending` (Cycle 374: chat daily budget now uses atomic Postgres reservation/refund accounting in `chat_daily_usage`, translation and response over-reservations refund unused capacity, and dedicated chat-budget coverage proves exhausted DB reservations stop before any LLM call)
- ~~**H-051** — `src/auth/discord-oauth.ts:46-49` — OAuth state capacity DoS (10K limit). Fix: per-IP state limit + TTL cleanup.~~ ✅ `pending` (Cycle 373: OAuth initiation now tracks pending states per IP with a max of 5, callback consumption frees pending slots immediately, expired states are cleaned up lazily by TTL instead of `setTimeout`, and auth tests cover per-IP throttling, slot release after callback, and expiry cleanup)
- ~~**H-049** — `src/auth/discord-oauth.ts:98-165` — OAuth timing attack enables user enumeration. Fix: constant-time rejection regardless of user existence.~~ ✅ `pending` (Cycle 372: rejected OAuth callbacks now do a users-table padding lookup plus minimum-delay normalization before returning, and callback tests cover invalid-state, replayed-state, and unauthorized invite-only rejection paths)
- ~~**H-061** — `src/process/summarize.ts` — LLM returns empty responses for very short items (13-30 chars), exhausts retries, permanently marks items failed.~~ ✅ `pending` (Cycle 370: short Discord chunks under 50 chars are filtered before summarize only when they lack signal markers; terse but signal-bearing messages like claims, relationship cues, tickers, numbers, URLs, and exploit/regulatory keywords still reach the LLM)
- ~~**PD-008** — `src/server.ts:198-199` — POST /sources doesn't create source_state row~~ ✅ `pending`
- ~~**PD-009** — `dashboard/src/pages/Settings.tsx:72-77` — Toggle null stateStatus~~ ✅ `pending`
- ~~**PD-006** — `dashboard/src/components/StatusBadge.tsx:1-5` — StatusBadge lacks source state colors~~ ✅ `pending`
- ~~**PD-010** — `dashboard/src/pages/ReportView.tsx:117` — Home page degraded report~~ ✅ `pending`
- ~~**PD-011** — `dashboard/src/components/Header.tsx:16-17` — Feed and Chat missing from nav~~ ✅ `pending`
- ~~**PD-022** — `dashboard/src/pages/Chat.tsx:22-26` — Chat history lost on navigation~~ ✅ `pending`
- ~~**PD-030** — `dashboard/src/pages/Settings.tsx:162-271` — digest_time/timezone not editable~~ ✅ `pending`
- ~~**PD-052** — Health display added to PipelineTab~~ ✅ `pending`
- ~~**PD-053** — Search page created with keyword search UI~~ ✅ `pending`
- ~~**PD-002** — Source label/poll_interval editing (PATCH + inline edit UI)~~ ✅ `pending`
- ~~**PD-003** — `src/server.ts` — DELETE /sources endpoint added~~ ✅ `pending`

## Medium

- **M-081** — Backpressure asymmetric — ingest floods starve downstream. Fix: monitor ready-item count, alert if >5000.
- **M-082** — Missing observability — no metrics on chunking, entity resolution, LLM budgets. Fix: add structured metrics.
- **M-083** — Pre-summarizer/summarizer token budgets misaligned (4000 vs 6000 chars). Fix: align to 5500.
- **M-084** — `src/db/queries.ts:3220-3248` — resolveAuthorCall() not transactional. Fix: CTE or transaction.
- **M-085** — Missing partial index on entity_mentions(sentiment). Fix: add partial index.
- **M-086** — LLM cost tracking relies on stale pi-ai pricing. Fix: add attempt tracking, per-model aggregation.
- **M-087** — Chat token tracking undercounts (ignores system prompt + tool results). Fix: use LLM response usage metadata.
- **M-088** — Entity relationship POST accepts arbitrary strings. Fix: add enum constraints.
- **M-089** — ReportView 1648-line god component. Fix: extract per-type sub-components + shared formatting.
- **M-090** — Search page 8 useState dictionaries. Fix: extract useReportPreviewState() hook.
- **M-091** — ~300 lines duplicated formatting across dashboard pages. Fix: shared formatting.ts + useAsyncData().
- **M-092** — 30+ regression tests are brittle source-code regex matches. Fix: refactor to behavior tests.
- **M-093** — Dashboard tests don't test error/loading/empty states. Fix: add fetch failure scenarios.
- **M-094** — Record<string, unknown> mapper functions — silent column rename failures. Fix: explicit pool.query<T> types.
## Medium (resolved)

- ~~**M-095** — No startup model validation. Invalid model IDs pass regex but fail at runtime with cryptic pi-ai TypeError. Fix: lightweight test call or registry check at startup, fail fast with clear error.~~ ✅ `pending`
- ~~**PD-004** — Halted source toggle shows specific 409 error~~ ✅ `pending`
- ~~**PD-005** — Halted sources show red toggle + disabled~~ ✅ `pending`
- ~~**PD-007** — POST /sources accepts poll_interval~~ ✅ `pending`
- ~~**PD-012** — Feed timestamp typed as number~~ ✅ `pending`
- ~~**PD-013** — Report list uses column selection~~ ✅ `pending`
- ~~**PD-015** — 8 dead components deleted~~ ✅ `pending`
- ~~**PD-023** — Chat loading UX: elapsed timer + contextual hints added~~ ✅ `pending`
- ~~**PD-024** — `dashboard/src/components/ChatMessage.tsx:11-38` — Markdown rendering improved~~ ✅ `pending`
- ~~**PD-025** — Tool indicator improved: better labels, collapsed count, no auto-hide~~ ✅ `pending`
- ~~**PD-026** — Chat error: distinguishes 429/500/network + retry button~~ ✅ `pending`
- ~~**PD-027** — `dashboard/src/pages/Chat.tsx:117-126` — Textarea auto-grow added~~ ✅ `pending`
- ~~**PD-031** — API key display with mask/reveal/copy + endpoint docs~~ ✅ `pending`
- ~~**PD-040** — Invite rejection redirects to /login?error=unauthorized~~ ✅ `pending`
- ~~**PD-041** — Blocked users redirected before session creation~~ ✅ `pending`

## Medium (Cycle 133 — normalize audit)

- ~~**NR-001** — Stale batch_id on skipped items — cleared with `batch_id = NULL`~~ ✅ `pending`
- ~~**NR-002** — Claim-and-release cycle — documented as by-design trade-off~~ ✅ `pending`
- ~~**NR-003** — News source silently dropped in poll loop — explicit skip added~~ ✅ `pending`
- ~~**NR-004** — parseLabeledOutput regex merges on skipped labels — fixed lookahead~~ ✅ `pending`

## High (Cycle 135 — product-level audit)

- ~~**PR-001** — OAuth callback handles Discord error/deny → redirect to /login with error param~~ ✅ `pending`
- ~~**PR-002** — Poll interval: Add Source form select + display in sources table~~ ✅ `pending`
- ~~**PR-003** — Feed page shows EmptyState when no Discord sources~~ ✅ `pending`

## Medium (Cycle 135 — product-level audit)

- ~~**PR-004** — Chat char counter (>3000 shows count, >4000 disables send)~~ ✅ `pending`
- ~~**PR-005** — Failed tools no longer in toolsUsed (moved push after execute)~~ ✅ `pending`
- ~~**PR-006** — Budget message explains midnight UTC reset~~ ✅ `pending`
- ~~**PR-007** — Timezone dropdown uses Intl.supportedValuesOf (full IANA list)~~ ✅ `pending`
- ~~**PR-008** — Halted source fallback "check server logs" when lastError null~~ ✅ `pending`
- ~~**PR-009** — Delete source uses themed Modal instead of window.confirm~~ ✅ `pending`
- ~~**PR-010** — Config PATCH accepts camelCase + snake_case, frontend sends camelCase~~ ✅ `pending`

---

## Resolved (Cycles 27-128)

<details>
<summary>350+ findings resolved — click to expand</summary>

### Critical (resolved)

- ~~**CF-010** — `src/server.ts:223-261` + `src/scheduler.ts:72` — PATCH /config doesn't call refreshDailyCron()~~ ✅
- ~~**DA-001** — `src/server.ts:282` — Search endpoint BIGINT vs ISO string~~ ✅

### High (resolved)

- ~~**EM-032** — `src/embed.ts:186,199` — No embedding dimension validation~~ ✅
- ~~**LM-041** — `src/llm.ts:307-308` — 429 Retry-After jitter violates spec~~ ✅
- ~~**CF-011** — `src/server.ts:236-254` — digest_time/timezone not validated on PATCH~~ ✅
- ~~**HM-020** — `src/health.ts:70-73` — checkSourceSilence skips NULL last_fetched_at~~ ✅
- ~~**CH-019** — `src/chat/handler.ts:321+231` — Double-sanitization~~ ✅
- ~~**IP-012** — `src/pre-summarize/index.ts:28-43` — Urgent articles skip pre-summarize~~ ✅
- ~~**SD-016** — `src/index.ts:296-321` — Health catch-up races with onDaily~~ ✅
- ~~**SD-013** — `src/process/synthesize.ts` — Divergence window too narrow~~ ✅
- ~~**DC-013** — `src/ingest/discord.ts` — Queue drain on disconnect~~ ✅
- ~~**PS-001** — `src/pre-summarize/index.ts:198` — Pre-summarize success doesn't reset retry_count~~ ✅
- ~~**AC-002** — `src/auth/discord-oauth.ts:255` — /auth/me missing avatar~~ ✅

### Medium (resolved)

- ~~**HM-021** — Health event dedup non-atomic~~ ✅
- ~~**CH-020** — Mixed nonce on translation failure~~ ✅
- ~~**D-020** — No retry for failed deliveries~~ ✅
- ~~**SM-020** — getSentimentMomentum timezone~~ ✅
- ~~**DA-002** — StatusBadge field mismatch~~ ✅
- ~~**SD-012** — Pulse missing alias-aware lookup~~ ✅
- ~~**CH-017** — Semantic search truncation~~ ✅
- ~~**CH-010** — created_at raw epoch-ms~~ ✅
- ~~**DA-010** — PATCH /config lacks body schema~~ ✅
- ~~**SD-015** — Correlation cutoff off-by-one~~ ✅
- ~~**VE-010** — cosineSimilarity no dimension guard~~ ✅
- ~~**IP-015** — Entity resolution failure deletes summary~~ ✅
- ~~**DL-025** — Response body socket leak~~ ✅
- ~~**DL-028** — Rate-limit retry spin~~ ✅
- ~~**AU-035** — Blocked user sessions not purged~~ ✅
- ~~**NP-040** — HTTP intermediary hops dead code~~ ✅
- ~~**DC-011** — Circuit breaker counts non-error close codes~~ ✅
- ~~**DC-012** — closeAndResume bypasses circuit breaker~~ ✅
- ~~**DC-015** — Reconnect backoff resets too easily~~ ✅
- ~~**LM-032** — Chat translation bypasses nonce~~ ✅
- ~~**CF-002** — alertWebhookUrl not validated~~ ✅
- ~~**EL-002** — Resurrection resets relevance~~ ✅
- ~~**EP-001** — Unembedded summaries pushed out of LIMIT~~ ✅
- ~~**SM-001** — Oversized item marked failed~~ ✅
- ~~**AC-003** — lastFetchedAt type mismatch~~ ✅
- ~~**TW-003** — Rate limit backoff lost on restart~~ ✅
- ~~**EL-005** — No mention tracking on resurrection~~ ✅
- ~~**EL-007** — CoinGecko seeding timeout~~ ✅
- ~~**SC-013** — buildDailyCron out-of-range hours~~ ✅
- ~~**CO-011** — Trust weight first summary only~~ ✅
- ~~**CO-013** — json_agg lacks ORDER BY~~ ✅
- ~~**SY-009** — Entity sentiment schema empty names~~ ✅
- ~~**PL-004** — 300 maxTokens too low~~ ✅
- ~~**SR-009** — Webhook test leaks response body~~ ✅
- ~~**OP-001** — Advisory unlock errors not caught~~ ✅
- ~~**OP-002** — Orphaned embeddings no iteration cap~~ ✅
- ~~**SR-002** — PATCH /sources missing enum validation~~ ✅

</details>
