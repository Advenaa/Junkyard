---
name: podders-audit
description: Audit a specific Podders v2 module for bugs, security issues, and correctness problems
context: fork
arguments: module-name
---

# Podders Module Audit

Audit the Podders v2 module specified by `$ARGUMENTS`.

## Module-to-File Mapping

Resolve the module name to its source files:

| Module | Files |
|--------|-------|
| rss | `src/ingest/rss.ts` |
| twitter | `src/ingest/twitter.ts` |
| discord | `src/ingest/discord.ts` |
| normalize | `src/normalize/index.ts`, `src/normalize/url-expand.ts` |
| pre-summarize | `src/pre-summarize/index.ts` |
| summarize | `src/process/summarize.ts` |
| correlate | `src/process/correlate.ts` |
| synthesize | `src/process/synthesize.ts` |
| pulse | `src/process/pulse.ts` |
| narratives | `src/process/narratives.ts` |
| embed | `src/embed.ts`, `src/embed-pipeline.ts` |
| vector-cache | `src/vector-cache.ts` |
| chat | `src/chat/handler.ts` |
| entities | `src/knowledge/entities.ts` |
| sentiment | `src/knowledge/sentiment.ts` |
| divergence | `src/knowledge/divergence.ts` |
| decay | `src/knowledge/decay.ts` |
| webhook | `src/deliver/webhook.ts` |
| scheduler | `src/scheduler.ts` |
| server | `src/server.ts` |
| config | `src/config.ts` |
| auth | `src/auth/` (all files in directory) |
| health | `src/health.ts` |
| llm | `src/llm.ts` |
| db | `src/db/queries.ts`, `src/db/migrations.ts` |
| dashboard | `dashboard/src/` (all files in directory) |

If `$ARGUMENTS` does not match any module above, list the valid module names and stop.

## Procedure

1. **Resolve files**: Map `$ARGUMENTS` to the file list above. For directory entries (`src/auth/`, `dashboard/src/`), glob for all `.ts`/`.tsx` files within.

2. **Read all resolved files**: Read every file fully. Do not skip any.

3. **Check for these bug patterns** (specific to this codebase):

   ### Critical (data loss, security)
   - **Epoch ms vs seconds mismatch**: `created_at` and all timestamps are epoch-ms stored as BIGINT. Flag any `Date.now() / 1000`, `Math.floor(... / 1000)`, or comparisons mixing seconds and milliseconds.
   - **Missing SSRF validation on outbound URLs**: Any `fetch()`, `axios`, or HTTP call using user-supplied or feed-supplied URLs without validating the hostname is not a private/internal IP (127.x, 10.x, 169.254.x, 192.168.x, etc.).
   - **Prompt injection vectors in LLM inputs**: User-controlled or scraped content interpolated directly into LLM prompts without sanitization or delimiter fencing.
   - **Race conditions in DB operations**: SELECT-then-UPDATE patterns that should be atomic `UPDATE ... RETURNING` or use transactions. Especially dangerous for status transitions (e.g., `pending` -> `processing`).
   - **Missing error handling orphaning items in 'processing' state**: If an item's status is set to `processing` before an operation, and the operation can throw without a catch/finally that resets the status.
   - **Claim-before-process pattern**: Any module that SELECT+processes DB rows must use atomic `UPDATE ... RETURNING` + `FOR UPDATE SKIP LOCKED`, not a bare SELECT followed by processing. A bare SELECT allows two workers to claim the same row.
   - **SQL table/column interpolation**: Any dynamic table or column names interpolated into SQL strings must be validated against a hardcoded allowlist. Parameterized queries do not protect identifiers — only values.
   - **Advisory lock unlock errors**: `pg_advisory_unlock()` calls must have `.catch(() => {})`. An uncaught unlock failure can mask the original job error or leave the system inconsistent. Pattern: `await pool.query('SELECT pg_advisory_unlock(...)').catch(() => {})`.
   - **Response body socket leak on non-2xx**: Every `fetch()` with a non-ok response must consume/cancel the body (`await response.body?.cancel()`). Failing to do so leaks the underlying socket.

   ### High (correctness)
   - **Snake_case leaking into API responses**: Response objects should go through `toCamelCase` transform. Flag any `res.json()` with snake_case keys.
   - **INTEGER columns that should be BIGINT for epoch-ms**: In migrations or schema definitions, timestamp columns declared as INTEGER instead of BIGINT.
   - **Missing zod validation on LLM output**: LLM responses parsed with `JSON.parse()` without subsequent zod schema validation.
   - **Uncapped retries or missing retry-after caps**: Retry loops without a max retry count, or retry delays that can grow unbounded (no cap on exponential backoff).
   - **Livelock on retry**: Any retry loop must have a max retry count. Items that fail repeatedly must eventually be marked `failed`, not retried forever. Check for `while(true)` or unbounded loops around fallible operations.
   - **Batch result length mismatch**: Any code that pairs API batch results (e.g., LLM batch responses, embedding arrays) with input arrays must verify that `results.length === inputs.length` before zipping. Off-by-one or partial-failure responses silently misalign data.
   - **HTML entity double-encoding**: Sanitize functions must escape `&` before escaping `<` and `>`. If `<` is escaped to `&lt;` first and then `&` is escaped, the result is `&amp;lt;` — double-encoded. Check ordering in any HTML/XML sanitization logic.
   - **HTTP status regex false positives**: Extracting HTTP status codes from error messages via regex (e.g., `/(\d{3})/`) can match non-status numbers like `"432ms"` or `"1024 bytes"`. Flag any status-code regex that doesn't anchor to known patterns (e.g., `HTTP `, `status `).

   ### Medium (edge case, UX)
   - **UTF-16 surrogate pair issues in string truncation**: `.slice()` or `.substring()` on strings that may contain emoji or CJK without checking surrogate pair boundaries.
   - **Missing status filters**: Queries that fetch entities/items without filtering out `archived` or `deleted` status, potentially mixing stale data with active data.
   - **Timezone-naive date operations**: Using `new Date()`, `Date.now()`, or date formatting without referencing the configured timezone from `app_config`. Flag bare `toLocaleDateString()` or `toISOString()` where user-facing timezone matters.
   - **ULID timestamp decoding for stale detection**: Batch IDs and row IDs are ULIDs that encode their creation time. Use `decodeTime(ulid)` to extract the timestamp instead of adding extra `created_at` columns or passing timestamps alongside IDs. Flag any code that adds a timestamp column solely to track when a ULID-keyed row was created.
   - **Engagement sentinel -1**: Sources without engagement metrics (retweets, likes, etc.) must use `-1` as the sentinel value, not `0`. A value of `0` is a valid engagement count and misleads LLMs into thinking a post had zero engagement rather than unknown engagement. Flag any `engagement = 0` or `?? 0` defaults for engagement fields.

4. **Format findings** using the `.research-queue.md` format:

   ```
   - **XX-NNN** — `file:line` — Description of the issue
   ```

   Where:
   - `XX` is a severity prefix: `CR` (critical), `HI` (high), `MD` (medium)
   - `NNN` is a sequential number starting from 001 within this audit
   - `file` is the relative path from project root
   - `line` is the line number where the issue occurs
   - Description explains the problem concretely, referencing the actual code

5. **Output structure**:

   ```
   ## Audit: `<module-name>`

   **Files reviewed:**
   - `path/to/file.ts` (N lines)
   - ...

   ### Critical
   - **CR-001** — `src/ingest/rss.ts:42` — Feed URL passed directly to fetch() without SSRF validation; attacker-controlled RSS feed could probe internal network
   - ...

   ### High
   - ...

   ### Medium
   - ...

   ### Summary
   - X critical, Y high, Z medium findings
   ```

   If a severity category has no findings, include the heading with "None found."

6. **Be precise**: Only flag real issues with specific line numbers. Do not flag speculative issues or patterns that are actually handled correctly. If a pattern looks suspicious but is properly guarded, do not report it.
