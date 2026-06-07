# ADR 0003: Scope New Junkyard as an Internal Tool on the Own Backend

## Status
Accepted as proposal

## Context

New Junkyard's intended use was clarified: it is an internal tool for roughly five trusted users, administered by the project owner. It is not a consumer or retail SaaS.

A competitive pass on the reference product `https://aibottlenecks.app/` surfaced "gaps" against it: no billing, no consumer auth, no analytics. aibottlenecks is a public $15/mo product on a Lovable + Supabase + Stripe + Cloudflare + GA4 stack. Those gaps only matter for a public product. For an internal tool they are irrelevant.

The backend already exists and works: Fastify 5 (Node 22, TypeScript), Postgres via `pg`, a 24/7 collector on node-cron, scraping/normalization (readability, linkedom, rss-parser), k-means clustering (ml-kmeans), entity resolution, and LLM via `@mariozechner/pi-ai` using OAuth (`.oauth-codex.json`, not API keys) plus Gemini, all served as a Vite/React 19 + Tailwind dashboard through `@fastify/static`. It is self-hosted on a VPS under PM2. Discord OAuth and an `ADMIN_USER_IDS` allowlist are already present in env.

## Decision

Build New Junkyard on the own backend. Do not adopt Supabase or any BaaS as the platform.

The Regime Engine is a long-running stateful workload: a 24/7 collector, scheduled heavy compute for clustering/transport/residual, an in-process or in-DB vector index, and an append-only transition ledger. That is the wrong shape for BaaS edge functions. A second managed Postgres would split the typed artifact graph and create a sync problem. The engine must run as a custom backend regardless, so Supabase would add lock-in with no upside at this scale.

- **Auth** — an allowlist of ~5 Discord IDs via the existing Discord OAuth plus `ADMIN_USER_IDS`. No consumer auth, no Better-Auth/Lucia/Auth.js, no Google/email signup funnel.
- **No consumer plumbing** — no billing/Stripe, no GA4/analytics, no public marketing site, no freemium/paywall previews. Explicitly out of scope.
- **Hosting** — self-hosted on the VPS, preferred over BaaS for data residency, full control, and zero per-seat cost at this scale. Managed Postgres (Neon/RDS) stays an optional future ops simplification — not Supabase-the-platform — but is not adopted now.
- **Engine value** — at this scale the Regime Engine's value is decision quality for ~5 internal users, not a competitive moat. The "make regime transitions visible and auditable" principle still holds: the users themselves need to trust why the chokepoint map changed.

## Consequences

- Most "consumer plumbing" gaps vs aibottlenecks are intentionally not closed (no billing, analytics, or public auth). That is correct for an internal tool, not technical debt.
- User concurrency is near-zero. The only real resource pressure is the data pipeline plus a future vector index, not request load. The PM2 512M memory ceiling concern reduces to "does the engine plus vector index fit," to be sized when the vector layer lands.
- pgvector-first (Postgres-side memory) remains the low-risk default over an in-process TurboVec index (ref ADR 0002), and is no longer urgent.
- The decision is reversible-ish but load-bearing. If New Junkyard later opens to outside or untrusted users, revisit auth (keep the auth layer swappable) and the public-surface decisions — but the engine architecture would not change.
- Build effort is redirected from consumer plumbing toward the engine and the dashboard that serve the five users.
- Invariant: access is an explicit allowlist, not open signup; no external billing or analytics vendor sits in the product; the typed artifact graph stays in one owned Postgres.
