# ADR 0001: Rehaul Podders v2 into New Junkyard as a Chokepoint Book with a Self-Revising Regime Engine

## Status
Accepted as proposal

## Context

Podders v2 already has the expensive base for a 24/7 intelligence sidecar: source ingestion, normalization, LLM summarization, entity resolution, reports, dashboard routes, embeddings, and health checks. The requested New Junkyard should not restart from zero. It should preserve that base while changing the product center.

The user pointed to `https://aibottlenecks.app/` as the concrete product reference. Its useful shape is a public/private chokepoint book: watchlist, theme baskets, catalysts, daily/weekly brief, and ask-AI over an AI buildout thesis map.

The earlier Edge Signal Miner plan was too candidate-CRUD shaped. arXiv:2606.01444 suggests a deeper mechanism: discovery is a verified regime transition, not merely finding a new object. A system should distinguish retrieval/search inside the current representation from discovery that revises the representation itself. Old artifacts must be transported into the proposed new regime, and residual content must remain before calling the change a discovery.

## Decision

New Junkyard will be a rehaul over Podders v2, not a fresh rewrite.

The user-facing product will be an AI Bottlenecks-style chokepoint book:

- `WATCHLIST` — names/tickers/entities, basket, movement, trend, why tracked.
- `CHOKEPOINTS` — theme baskets and relation maps.
- `REGIMES` — current map, proposed maps, rejected/superseded maps, transition history.
- `CATALYSTS` — proof events, countdowns, gate checks, earnings/capacity/policy triggers.
- `BRIEF` — daily/weekly narrative over what moved and why.
- `ASK AI` — grounded Q&A over the typed artifact graph and provenance.

The underlying architecture will be a Regime Engine:

```text
typed artifact graph
→ anomaly pressure
→ regime proposal
→ stress tests / gates
→ old-artifact transport
→ residual analysis
→ append-only accepted / rejected / superseded transition
```

Existing Podders tables remain canonical for collection and source evidence. New tables should add regimes, typed artifacts, provenance edges, proposals, gates, transport mappings, residual analyses, and transitions. Candidate/watchlist views sit on top of the regime engine; they are not the core mechanism.

## Consequences

- Podders ingestion, normalization, entity memory, reporting, auth, dashboard, and ops work are salvageable.
- New Junkyard can feel like AI Bottlenecks at the surface while having a more auditable discovery mechanism underneath.
- The first implementation should not be a generic stock screener or simple candidate CRUD flow.
- A candidate only makes sense relative to a regime that defines evidence types, relations, operations, and verifiers.
- Accepted map changes require gates, old-artifact transport, and residual analysis.
- Rejected alternatives and superseded regimes remain first-class audit objects.
- Risky collectors such as Discord user-token polling or a single unofficial X proxy stay pluggable details, not the product trust boundary.
