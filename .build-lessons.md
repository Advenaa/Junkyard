# Build Lessons

Accumulated lessons from each build step. Consulted by agents before implementation.

---

## Security

- **Always include connection strings in secrets array.** Step 2 audit caught `databaseUrl` missing from `config.secrets` — DB password would have leaked in logs. Rule: if a value could contain a credential (even embedded in a URL), add it to secrets.
- **pino redaction has three surfaces, not one.** `formatters.log` only processes bindings (structured data). Log message strings (`logger.info('key=abc')`) bypass it entirely. Error objects have non-enumerable `message`/`stack` that `Object.entries()` misses, and pino's `stdSerializers.err` exposes them unredacted. Step 3 fix: `hooks.logMethod` intercepts msg strings, explicit Error branch in `redactSecrets` handles `message`/`stack`, and `serializers.err` wraps `stdSerializers.err` with redaction.
- **Short secrets must be excluded from redaction.** Secrets under 4 characters could match common substrings and corrupt logs. `createLogger` filters `secrets.filter(s => s.length >= 4)`.

## Validation

- **Validate all numeric env vars with range checks.** `PORT` initially had no validation — `NaN` or out-of-range values would pass silently. Fixed with `Number.isFinite(port) && port >= 1 && port <= 65535`. Apply to pool sizes, timeouts, intervals.

## Imports

- **ESM `.js` extensions work.** `import { loadConfig } from './config.js'` compiled and ran. Use `.js` in import paths consistently across all modules.

## Build Process

- **Implementation + audit agent pattern works.** Audit agent caught real issues in every step: secrets leak + NaN port (Step 2), pino msg/error redaction gaps (Step 3). Keep auditing every step.
- **First-try compilation is achievable.** Steps 2, 3, and 4 all compiled on first `npm run build`. Key factor: agents had full specs from BUILD.md before writing code.
- **Two agents can suffice.** Step 3 dropped the integration agent (no wiring needed) and still succeeded with implementation + audit. Scale agent count to the task.
- **Three parallel agents work when file boundaries are clean.** Step 4 split connection/migrations/queries across 3 agents — zero merge conflicts, all compiled first try. The key: each agent owned exactly one file with no cross-file dependencies during implementation.
- **Skipping audit has a cost you won't see immediately.** Step 4 skipped the audit agent due to time pressure. Every prior step where audit ran caught real bugs (secrets leak, NaN port, redaction gaps). Database code is especially risky to leave unaudited — migration bugs are painful to fix post-deploy, and query bugs (e.g., missing parameterization, wrong column types) surface late. Restore audit for all future steps.

## Step 4 Results (Database)

- **Three-file decomposition validated.** connection.ts, migrations.ts, queries.ts each mapped to one agent. 17 tables with indexes, FTS, and seeds created. queries.ts has typed Row interfaces per table.
- **Install pg + @types/pg upfront.** Both packages needed before any agent can compile. Do dependency installs before spawning parallel agents.

## Step 5 Prep (CLI Entry)

- **Single file, single agent.** `src/index.ts` is the only file. One implementation agent + one audit agent is the right shape. No parallelism needed for implementation.
- **commander is the only new dependency.** Install before agent runs.
- **Two commands: `run` and `migrate`.** `run` chains: loadConfig -> createLogger -> createPool -> runMigrations -> startServer. `migrate` chains: loadConfig -> createPool -> runMigrations -> exit. Both are thin orchestration — no new logic, just wiring existing modules.
- **Graceful shutdown is the tricky part.** SIGTERM/SIGINT -> set `shuttingDown = true` -> close server -> close pool -> exit. 30s hard-kill timeout via `setTimeout`. This is where audit should focus: signal handler cleanup, double-signal handling, timeout clearing.
- **Audit agent is mandatory here.** Step 4 skipped audit and we noted the risk. Step 5 wires everything together — a bug here (e.g., pool not closing, signal not caught, migration running twice) affects the entire runtime. Restore the audit agent.
- **Verification is concrete.** `node dist/index.js --help` shows commands. `node dist/index.js migrate` runs migrations (needs a running Postgres). Build-only verification: compile + help output.
