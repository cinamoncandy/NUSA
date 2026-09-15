# AC-0018 Repository-grounded Gap Matrix

Issue: #1921
Baseline main: `79289f9f33f63e6b699bdbc42863c3e458f782a4`
Date: 2026-09-15

This matrix prevents the external structured-agent pattern from creating duplicate NUSA authorities.

| Contract | Status | Canonical evidence / owner | Action |
|---|---|---|---|
| Immutable hypothesis/experiment provenance | IMPLEMENTED | ADR-0003: append-only lifecycle, typed manifests/results, canonical hashes/full provenance | Reuse |
| Multi-window, cost/risk-aware qualification | IMPLEMENTED | ADR-0003 | Reuse |
| Holdout isolation / protected validation principle | IMPLEMENTED | ADR-0003; #1906 strengthens three-zone/OOS budget semantics | Complete only missing #1906 slices |
| Missing/stale/corrupt evidence fail-closed | IMPLEMENTED | ADR-0003; architecture safety invariants | Reuse |
| Deterministic replay/reproduction | IMPLEMENTED | ADR-0003 | Reuse; #1605 closes production-loop idempotency |
| Champion mutation authority separation | IMPLEMENTED | ADR-0003: CandidatePromotionRuntime + explicit owner command | Reuse |
| AI zero authority / provider isolation | IMPLEMENTED | ADR-0006 and architecture contract | Reuse |
| Model/provider pluggability | IMPLEMENTED | ADR-0006 ModelProvider contract | Reuse |
| Production PAPER closed learning loop | PARTIAL | #1605 explicitly records composition gaps | Finish #1605; no new loop |
| Specialized research scientist roles | PLANNED/PARTIAL | #1906 | Implement only after listed correctness prerequisites |
| Immutable research/search/OOS budget ledger | PLANNED/PARTIAL | #1906 | Extend canonical Research Factory |
| Explicit cross-cutting precommit spec contract | PARTIAL | ADR-0003 typed experiment manifests; #1906 experiment designer | ADR-0018 makes cross-owner contract explicit; implementation belongs to existing Research owner |
| Test-first invariant gate | PARTIAL | Existing tests/architecture safety rules, but no separate investment qualification authority should be created | Add acceptance/invariant coverage to owning modules, not a new engine |
| Independent implementation vs falsification role | PARTIAL | Deterministic gate and owner-command separation exist; #1906 Skeptic/Replication roles planned | Complete via #1906 without granting authority |
| Champion/Challenger evaluator-semantic comparability | PARTIAL | ADR-0003 says comparison is evidence only; #1906 champion/challenger queue planned | Bind evaluator/data/code/cost provenance in canonical evaluator |
| Shadow/readiness promotion contract | PARTIAL | #1605/#1906 target PAPER/Shadow/readiness | Complete in existing promotion/readiness owners |
| Degradation -> new research/revalidation | PLANNED | #1906 triggers | Implement as research request only; no direct retuning |
| Failure injection for NaN/Inf/solver/reconciliation/version mismatch | PARTIAL | General fail-closed invariants exist | Add focused tests in relevant canonical owners |
| Mathematical strategy families (OU/A-S/Hawkes/Heston) | MISSING BY DESIGN | No evidence that these are NUSA alpha | P2 research candidates only after P0/P1 |

## Canonical ownership conclusion

No new Research Factory, League, portfolio engine, execution engine, service container, plugin system, or lifecycle engine is justified. The correct architecture is an explicit harness contract over existing owners, with #1605 closing the production PAPER loop and #1906 adding bounded research cognition after correctness prerequisites.

## External claims rejected as architecture evidence

The following categories are intentionally not imported: claims of a particular unreleased/new model being uniquely capable; institutional-equivalent performance; extremely low operating cost; weekend-to-hedge-fund timelines; or profitability implied by implementing named mathematical models. They require independent evidence and cannot weaken NUSA gates.
