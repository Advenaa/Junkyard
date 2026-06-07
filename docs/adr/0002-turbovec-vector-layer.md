# ADR 0002: Adopt TurboVec as the New Junkyard Vector Layer

## Status
Accepted as proposal

## Context

The Regime Engine reasons over a typed artifact graph, but several of its stages need similarity, not just graph traversal. Anomaly pressure needs to flag observations that sit far from any current chokepoint basket. ASK AI needs RAG grounding over items, summaries, and typed artifacts, where today it is graph-only. Entity and candidate resolution needs near-duplicate detection. Transport needs to find old artifacts nearest a proposed new regime frame.

Podders v2 already has an `embeddings` table, but no first-class ANN index sits behind it. We want a vector layer that fits a 24/7 collector: resident in RAM, no external service in the trust boundary, and consistent with the project's OAuth-not-API-keys posture (no vendor API key for the index itself).

TurboVec (`https://github.com/RyanCodrai/turbovec`) is a candidate. Per a web summary citing an ICLR 2026 reference: it is a vector ANN index implementing Google Research's TurboQuant quantization, with a Rust core and Python bindings, MIT licensed, ~6.9k stars, actively maintained. It offers extreme memory compression (a 10M-doc corpus that is 31 GB as float32 fits in ~4 GB; up to 16x at 1536-dim, 6144B → 384B at 2-bit), online ingestion with no training/tuning phase, query-time filtered search via allowlists, SIMD kernels (ARM NEON, x86 AVX-512), full local operation with no external dependency, and deletion with stable external IDs. Benchmarks claim it beats FAISS FastScan by 12–20% on ARM and wins 1–6% over FAISS IndexPQ on x86 at 4-bit.

## Decision

Adopt TurboVec as the local vector layer for the Regime Engine, backing the existing Podders `embeddings` table.

It maps onto regime-engine stages:

- **Anomaly pressure** — flag observations far from any current chokepoint basket centroid.
- **ASK AI** — RAG grounding over items, summaries, and typed artifacts, not just the graph.
- entity/candidate near-duplicate dedup.
- **Transport** — find old artifacts nearest a proposed new regime frame.

Its filtered (allowlist) search composes with regime-relative scoping: a query can be restricted to artifacts inside the current regime, since candidates are only meaningful inside a regime. Local-only operation keeps risky collectors and external services out of the trust boundary, and the memory economics fit a collector that wants its artifact graph resident in RAM.

## Consequences

- This stays a proposal: no schema migration, no embeddings backfill, no runtime code until accepted.
- Which embedding model feeds TurboVec is open. The repo already has a `GEMINI_API_KEY` in env and uses OAuth-based LLM auth elsewhere; embedding-model choice is a separate, unresolved decision.
- 2-bit vs 4-bit quantization (recall vs memory) must be benchmarked on a real artifact corpus before committing.
- The TurboVec stats above come from a web summary citing a 2026 ICLR reference. The README and benchmarks should be re-verified against the real corpus and hardware before implementation commitment.
- Vector retrieval results are regime-relative and provenance-backed. Vector search is a grounding and anomaly aid, not a source of accepted discovery on its own; a similarity hit is not a regime transition.
- Risky collectors and embedding vendors remain pluggable details, not the product trust boundary.
