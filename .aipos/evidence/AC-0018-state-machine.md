# AC-0018 Governed Lifecycle State Contract

This document is a conceptual cross-owner state contract. It does not create a runtime state machine.

| From | Gate | Success | Fail/insufficient |
|---|---|---|---|
| OBSERVATION | provenance/admissibility | HYPOTHESIS | HOLD/UNKNOWN evidence |
| HYPOTHESIS | falsifiability + novelty/search lineage | PRECOMMIT_SPEC | REJECT/LESSON |
| PRECOMMIT_SPEC | immutable data/evaluator/cost/stopping contract | EXPERIMENT_PLAN | HOLD |
| EXPERIMENT_PLAN | invariant/test contract | IMPLEMENTATION | REJECT/HOLD |
| IMPLEMENTATION | focused correctness + independent falsification | CANONICAL_EVALUATION | REJECT/CONFLICTING |
| CANONICAL_EVALUATION | protected OOS/walk-forward admission | PROTECTED_OOS | REJECT/INSUFFICIENT |
| PROTECTED_OOS | cost/risk/robustness | QUALIFICATION_LEAGUE | REJECT/INSUFFICIENT |
| QUALIFICATION_LEAGUE | canonical candidate gate | PAPER | REJECT/INSUFFICIENT |
| PAPER | canonical forward execution/accounting evidence | SHADOW_READINESS | HOLD/REVALIDATE/RETIRE |
| SHADOW_READINESS | independent Release/Risk/human policy | HUMAN_GOVERNED_LIVE_BOUNDARY | HOLD/REJECT |

## Transition invariants

- Every material semantic change versions identity; no in-place rewrite of judged evidence.
- A failure outcome is persisted before another version may retry.
- Protected OOS is not a discovery input for the hypothesis consuming it.
- Downstream gates cannot override upstream invalid provenance.
- Research/AI can request transitions but cannot adjudicate deterministic qualification/Risk/Release transitions.
- PAPER evidence must originate from canonical PAPER execution/accounting; no synthetic substitution.
- The final LIVE boundary is intentionally outside autonomous authority.
