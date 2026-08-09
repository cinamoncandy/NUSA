# ADR-0012: Governed Outcome Attribution and Learning Memory

- Status: Proposed
- Date: 2026-08-10
- Scope: PAPER/Research zero-authority AI learning evidence only

## Context

NUSA can now ground AI inputs, bind prompt/replay identity, calibrate predictions against verified outcomes, preserve durable calibration history, govern inference resources, compare independent providers, and evaluate bounded counterfactual scenarios. The remaining low-scoring intelligence gap is post-decision learning beyond calibration.

Calibration answers whether a cohort's probability estimates are reliable. It does not determine why an individual thesis or forecast failed, whether a miss is attributable to missing/poor evidence, model/provider disagreement, scenario sensitivity, calibration error, a possible regime shift, or unresolved noise. Without a governed attribution layer, any post-hoc narrative would be easy to overfit and impossible to distinguish from causal evidence.

## Decision

NUSA will add a deterministic, outcome-linked attribution and learning-memory layer with explicit identifiability limits.

1. Every attribution episode binds to an immutable verified prediction, resolved outcome, evidence snapshot identity, provider/model/prompt/schema lineage, calibration cohort, and scenario experiment identity when one exists.
2. Attribution rules are immutable/versioned and part of replay identity.
3. Candidate failure labels are descriptive hypotheses until supported by policy-defined replay, ablation, holdout, and corroborating evidence.
4. Attribution strength is explicit: `IDENTIFIED`, `PARTIALLY_IDENTIFIED`, `UNRESOLVED`, or `UNVERIFIED`. The system prefers `UNRESOLVED` over weakly supported certainty.
5. Controlled replay/ablation may vary one governed analytical input dimension at a time, but may never rewrite observed evidence, realized outcomes, historical timestamps, or VERIFIED_RUNTIME state.
6. Independent-provider disagreement and scenario sensitivity may corroborate attribution but cannot, by majority vote or model self-assessment alone, establish causality.
7. Synthetic fixtures may prove attribution-engine correctness only. They cannot create realized-market learning credit or be represented as evidence of predictive-alpha improvement.
8. Learning episodes are immutable, provenance-bound read-only records containing the observed miss, candidate causes, counterevidence, attribution strength, applicable cohort/scope, and supersession/expiry metadata.
9. Retrieval of learning episodes may provide advisory context only. It cannot automatically change provider/model weights, prompts, strategies, risk limits, champion status, deployment state, execution behavior, or authority.
10. Holdout partitions and leakage checks are mandatory for any benchmark used to claim improved attribution quality. Rules may not be scored solely on the same cases used to define them.
11. All new inference/replay work remains under WO-AI-006 resource governance. WO-AI-007/008 comparison/scenario capabilities must preserve their existing independence, hypothetical-evidence, and abstention boundaries.
12. Durable learning storage must exclude credentials, authorization headers, raw secrets, broker handles, hidden chain-of-thought, and production mutation capability.

## Candidate attribution classes

Initial governed classes may include:

- `EVIDENCE_GAP`
- `DATA_QUALITY_FAILURE`
- `MODEL_DISAGREEMENT`
- `CALIBRATION_MISS`
- `SCENARIO_SENSITIVITY_MISS`
- `REGIME_SHIFT_CANDIDATE`
- `UNRESOLVED`

These names must not imply stronger causal identification than the associated attribution-strength state supports.

## Evaluation truth

Required evaluation must separate engine correctness from investment performance.

- Controlled single-cause fixtures should recover the known cause.
- Ambiguous multi-cause fixtures should remain unresolved when identification is insufficient.
- Irrelevant ablations must not create attribution.
- Provider majority must not be treated as causal proof.
- Hypothetical scenario output must never be recorded as realized-market learning credit.
- Policy/input/replay conflicts must fail closed.
- Holdout leakage must fail the evaluation gate.
- Cost, tokens, latency, and failure-rate deltas must be reported with attribution-quality deltas.

Real-world attribution or learning-effectiveness claims require verified resolved outcomes and held-out longitudinal evidence. Predictive accuracy or profitability improvement cannot be inferred from synthetic attribution tests.

## Authority invariants

Unchanged hard invariants:

- `liveAuthority=NONE`
- `realOrderAuthority=false`
- `realTransferAuthority=false`
- `productionMutationAllowed=false`
- deterministic Risk Governor remains authoritative
- P0/HALT/kill switch remain authoritative
- AI remains ZERO_AUTHORITY/read-only
- WO-0051 remains HUMAN_ENVIRONMENT_ONLY

## Non-goals

This ADR does not authorize online self-training, model-weight updates, provider weighting changes, prompt mutation, strategy generation/mutation/promotion, automatic risk changes, credential use/persistence, PAPER execution changes, LIVE execution, production mutation, or human-authority substitution.
