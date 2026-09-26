# AC-0018 Smallest Implementation Slices

Issue: #1921

These are planning slices, not new parallel engines. Before opening a new implementation issue, Core must confirm that the slice is not already covered by an active canonical issue.

## P0

### Slice P0-A — Precommit/comparability contract hardening
Owner: existing Research/evaluator contracts.

Goal: ensure material hypothesis/search-space/dataset-role/evaluator/cost changes create new immutable identity and incompatible Champion/Challenger evidence cannot compare as equivalent.

Acceptance: AC-0018 acceptance plan items 1, 2, 5, 6, 9.

### Slice P0-B — Failure-survival focused coverage
Owner: relevant Data/Research/evaluator/execution-accounting modules.

Goal: explicit fail-closed tests for stale/partial/provenance ambiguity, NaN/Inf/solver failure, reconciliation conflict, restart/replay.

Acceptance: items 3, 4, 6, 7, 10.

### Slice P0-C — Authority-separation coverage
Owner: Research/Risk/Release/CandidatePromotionRuntime boundaries.

Goal: prove proposer/implementer/AI cannot self-qualify, mutate Champion, weaken Risk, or cross LIVE boundary.

Acceptance: item 8 plus existing ADR-0003/0006 invariants.

## P1

### Slice P1-A — Finish #1605
Do not create a replacement issue. Complete production composition of existing PAPER closed-learning path and its operational/replay evidence.

### Slice P1-B — Comparable Champion/Challenger evidence
Only if not already owned by an active issue after fresh search. Bind canonical evaluator/data/code/cost/search-history semantics and reject incompatible comparisons.

### Slice P1-C — Shadow/readiness + degradation revalidation
Extend existing promotion/readiness and Research owners. Drift/decay/cost/regime/contradiction creates a versioned research/revalidation request only.

### Slice P1-D — Implement #1906 in prerequisite order
Do not create a second scientist/research engine. Specialized agents remain bounded views/roles over canonical Research Factory and deterministic adjudication.

## P2

### Slice P2-A — Strategy-family candidate protocol
Create candidate work only after P0/P1. Initial families may include OU mean reversion, Avellaneda-Stoikov, Hawkes, or Heston only when each has a falsifiable hypothesis and data/execution feasibility.

### Slice P2-B — Provider/model optimization
Use existing ModelProvider challenger semantics. Optimize research productivity/calibration/cost only; never qualification thresholds or trading authority.

## Stop conditions

A slice must not be implemented if it would create a duplicate canonical owner, weaken deterministic evidence gates, grant AI trading/release/risk authority, reuse protected OOS improperly, or represent synthetic evidence as real.
