# New Junkyard Regime Engine Proposal

> Proposal only. This document intentionally does not implement schema or runtime changes.

## Goal

Rehaul Podders v2 into **New Junkyard**: an AI Bottlenecks-style chokepoint book powered by a self-revising discovery engine.

The user-facing product should be simple:

```text
WATCHLIST → CHOKEPOINTS → REGIMES → CATALYSTS → BRIEF → ASK AI
```

The internal mechanism should be deeper:

```text
typed artifact graph
→ anomaly pressure
→ regime proposal
→ stress tests / gates
→ old-artifact transport
→ residual analysis
→ append-only accepted / rejected / superseded transition
```

## Product reference

Reference: `https://aibottlenecks.app/`

Useful product traits to copy:

- a named book/universe of chokepoints;
- ticker/name watchlist with basket/theme, move, RSI/trend/sparkline;
- theme filters such as HBM/Packaging, Photonics/CPO, Power/Grid, Cooling, Construction/MEP, Rare Earths;
- catalyst countdowns and proof events;
- daily/weekly brief;
- ask-AI over the research book;
- public research surface with optional deeper/private layer.

New Junkyard should not become a generic stock screener. The price table is only the visible shell. The value is the thesis map and why that map changes.

## Paper mechanism

Source: arXiv:2606.01444, *Self-Revising Discovery Systems for Science: A Categorical Framework for Agentic Artificial Intelligence*.

Operational translation:

- **Retrieval**: add an already-representable artifact to the current map.
- **Search**: find a new object/path inside the current map.
- **Discovery**: verify that the current map is inadequate, propose a new map, transport old artifacts into it, and show residual explanatory/predictive content.

The crucial correction is that discovery is not `candidate scored highly`. Discovery is a verified `regime transition`.

## Core entities

### Regime

A versioned representation map for a niche. It defines:

- artifact types;
- relation types;
- accepted operations;
- gate/verifier definitions;
- current accepted chokepoint model.

Example regime shift:

```text
Old: AI buildout = GPUs + fabs
New: AI buildout = GPUs + advanced packaging + HBM + power + cooling + datacenter construction
```

### Typed artifact

A typed row with payload, provenance, confidence, and regime context.

Useful artifact types:

- RawItem
- Observation
- Entity
- Relation
- Candidate
- Thesis
- Catalyst
- StressTest
- GateResult
- RejectedAlternative
- TransportMapping
- ResidualAnalysis
- RegimeTransition

### Anomaly pressure

Accumulated evidence that the current regime is struggling:

- repeated unexplained movements;
- new source clusters pointing outside current baskets;
- contradictions inside a thesis;
- cross-source evidence that does not fit current relation types;
- old map has poor explanatory compression.

### Regime proposal

A proposed schema/map change. It must declare:

- old frame;
- proposed new frame;
- affected niches/themes;
- new artifact/relation/gate types;
- predictions;
- falsifiers;
- required stress tests.

### Gate bundle

A regime proposal is not accepted by one score. It needs a bundle:

- compression/MDL-like gate: does the richer frame explain evidence enough to justify complexity?
- AIC/diagnostic-style comparison: does the richer descriptor beat the simpler one?
- prediction gate: does it predict later signals/catalysts?
- cross-source gate: do independent sources support it?
- contradiction gate: did a Breaker/stress-test process look for counterexamples?
- human-risk gate: does accepting it imply market/business action needing human review?

### Transport

Before accepting a new regime, map existing artifacts into it. This prevents relabeling from pretending to be discovery.

Example:

```text
Nvidia delays → GPU demand node
TSMC packaging comments → advanced packaging bottleneck
HBM shortages → memory bottleneck
datacenter power delays → power/grid bottleneck
liquid cooling demand → thermal bottleneck
```

### Residual content

After transport, ask what the new regime explains or predicts that the old regime could not. If there is no residual, reject or mark as search/relabeling rather than discovery.

## State machine

### Top-level regime lifecycle

```text
FixedRegime
  → ArtifactAccumulation
  → AnomalyPressure
  → RegimeProposal
  → StressTesting
  → GateEvaluation
  → TransportOldArtifacts
  → ResidualAnalysis
  → AcceptedRegime | RejectedRegime | HumanReview
```

### Candidate/watchlist lifecycle

Candidate lifecycle is downstream of regime state:

```text
Observed
  → Candidate
  → ThesisAttached
  → GatePending
  → Watchlisted | Rejected | Superseded
```

A candidate can be watchlisted only inside a regime. If the regime is superseded, candidates must be transported, reclassified, rejected, or marked legacy.

### Catalyst lifecycle

```text
Scheduled
  → Approaching
  → Triggered
  → EvidenceCollected
  → GateUpdated
  → ThesisConfirmed | ThesisWeakened | NoSignal
```

Catalysts are not just calendar events. They are gate probes for a thesis/regime.

## Proposed dashboard tabs

### WATCHLIST

AI Bottlenecks-style table:

- ticker/entity;
- name;
- basket/chokepoint;
- price/move/trend when applicable;
- regime status;
- why tracked;
- next catalyst;
- confidence/gate state.

### CHOKEPOINTS

Theme map:

- HBM/Packaging;
- Photonics/CPO;
- InP/Substrates;
- Power/Grid;
- Cooling;
- Construction/MEP;
- Memory;
- Rare Earths;
- custom niche themes.

Each chokepoint should show:

- accepted thesis;
- key entities;
- supporting artifacts;
- rejected alternatives;
- pending catalysts.

### REGIMES

The differentiating tab:

- current map;
- proposed map changes;
- accepted/rejected/superseded transitions;
- transport mappings;
- residual analyses;
- gate history.

### CATALYSTS

Proof events:

- earnings dates;
- capacity expansion proof;
- policy events;
- product launches;
- capex/order backlog checks;
- source-cluster confirmation windows.

### BRIEF

Daily/weekly AI-written brief:

- what moved;
- which chokepoints strengthened/weakened;
- catalysts triggered;
- regime proposals opened/closed;
- accepted/rejected/superseded map changes.

### ASK AI

Grounded Q&A over:

- items;
- summaries;
- entities;
- typed artifacts;
- gates;
- transport mappings;
- residual analyses.

## Storage proposal

Keep existing Podders tables for source collection and baseline memory:

- `sources`
- `source_state`
- `items`
- `summaries`
- `entities`
- `entity_aliases`
- `entity_mentions`
- `reports`
- `embeddings`
- existing auth/health/dashboard tables

Add regime-engine tables later:

- `regimes`
- `artifact_type_defs`
- `relation_type_defs`
- `gate_definitions`
- `artifacts`
- `artifact_edges`
- `artifact_provenance`
- `regime_proposals`
- `proposal_artifacts`
- `stress_tests`
- `rejected_alternatives`
- `gate_runs`
- `gate_results`
- `transport_runs`
- `transport_mappings`
- `residual_analyses`
- `regime_transitions`

Expose watchlist/candidate tables as views or derived query shapes over the artifact graph where possible.

## Invariants

- No accepted regime without gate results.
- No accepted regime before old-artifact transport.
- No discovery label without residual content.
- No gate result without provenance.
- Rejected alternatives are preserved, not deleted.
- Superseded regimes remain queryable.
- Candidate/watchlist state is regime-relative.
- Risky collectors remain pluggable and do not define product truth.

## Implementation order

1. Keep this as a proposal/ADR first.
2. Patch the implementation plan to center the Regime Engine, not candidate CRUD.
3. Add state-machine tests for regime acceptance invariants before schema work.
4. Add regime/artifact/provenance schema.
5. Add minimal artifact ingestion from existing summaries/entities.
6. Add regime proposal + gate runner.
7. Add transport/residual analysis.
8. Build AI Bottlenecks-style dashboard tabs over the new state.

## Done definition for a first MVP

A first MVP is not complete when a ticker table renders. It is complete when:

- at least one chokepoint book exists;
- source evidence flows into typed artifacts;
- one regime is current;
- one regime proposal can be stress-tested and gated;
- old artifacts can be transported into a proposed regime;
- residual analysis can accept/reject the proposal;
- dashboard shows watchlist/chokepoints/regimes/catalysts/brief;
- all transitions are append-only and inspectable.
