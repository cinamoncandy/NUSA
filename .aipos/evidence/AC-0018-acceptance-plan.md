# AC-0018 Acceptance and Dependency Plan

Issue: #1921

## Dependency DAG

```text
existing ADR-0003 research validity
        +
existing evaluator/qualification correctness prerequisites
        |
        v
P0 cross-cutting invariant coverage
        |
        +--> #1605 production PAPER closed-loop composition
        |          |
        |          v
        |    PAPER-forward canonical evidence
        |          |
        +----------+
                   v
          #1906 bounded Investment Scientist
                   |
                   v
       P2 strategy-family challengers
```

#1906's own prerequisite list remains authoritative. This document does not reorder or bypass those prerequisites.

## P0 acceptance suites

Canonical owning modules should add or retain focused tests proving:

1. Precommit identity changes on material hypothesis/dataset-role/evaluator/cost/search-space changes.
2. Protected OOS exposure cannot be reset by renaming/rephrasing an equivalent experiment.
3. Missing, stale, corrupt, provenance-ambiguous, or forbidden future evidence produces fail-closed non-qualification.
4. NaN/Inf and numerical/solver failure cannot be serialized as valid performance evidence.
5. Evaluator/cost/provenance semantic mismatch blocks Champion-Challenger comparability.
6. Same authoritative evidence and state replay yields identical identities/verdicts.
7. Restart after partial progress creates no duplicate experiment/evaluation/candidate/PAPER deployment.
8. Implementer/proposer/LLM verdict cannot mutate qualification, Risk, Release, Champion, or LIVE authority.
9. Negative, rejected, insufficient, unknown, and conflicting evidence remains append-only.
10. Execution/accounting reconciliation conflict cannot become accepted forward PnL evidence.

## P1 acceptance suites

For #1605 and its existing owners:

- production PAPER fills/outcomes bind to exactly one canonical candidate/period where required;
- immutable forward evidence reaches the existing Research Factory/League without a second engine;
- qualified challengers can enter PAPER-only validation through canonical gates;
- restart recovers bounded learning state;
- replay does not duplicate deployment/evaluation;
- LIVE mutations remain zero.

For #1906 and its existing owners:

- research-plan identity is deterministic;
- protected OOS cannot feed the hypothesis currently being judged;
- semantic duplicate trials retain prior search/OOS budget lineage;
- falsifier can block malformed/leaky/non-falsifiable plans;
- research ranking cannot alter qualification score or thresholds;
- degradation creates a new research/revalidation request, never in-place retuning;
- no agent gains capital/order/Risk/Release/LIVE mutation authority.

## P2 admission rule

A named mathematical strategy family may receive a work order only after P0/P1 owners are canonical and the proposal contains a falsifiable economic hypothesis, data availability/provenance plan, realistic execution-cost model, capacity/liquidity assumptions, multiple-testing budget, and protected OOS/PAPER-forward plan. Merely implementing a published equation is insufficient.

## Release evidence

Architecture PR acceptance requires:

- branch is based on current main or explicitly reconciled with newer main;
- only architecture/AIPOS metadata changes unless Core explicitly expands scope;
- repository semantic/metadata validation passes where applicable;
- exact-head CI is green before merge;
- merge is SHA-bound;
- exact-main CI is re-read after merge;
- #1921 is updated/closed only after merged canonical evidence exists.
