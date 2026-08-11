# ADR-0013: Governed Explanation Faithfulness and Claim-Evidence Verification

- Status: Proposed
- Date: 2026-08-11
- Scope: PAPER/Research zero-authority AI explanation verification only

## Context

NUSA can now ground inputs in content-addressed evidence, bind prompt/replay identity, calibrate predictions against verified outcomes, govern inference resources, compare independent providers, run bounded counterfactual scenarios, and persist governed outcome-attribution learning memory.

The remaining lowest-scoring AI capability is explanation quality/faithfulness. Existing grounding proves that cited evidence exists and is untampered. It does not prove that each explanation claim is actually supported by that evidence, that material counterevidence was not omitted, or that the explanation preserves uncertainty, disagreement, scenario, attribution, and observed-versus-hypothetical semantics.

A fluent explanation can therefore still overstate what the governed evidence supports without violating basic payload integrity.

## Decision

NUSA will add a deterministic explanation-faithfulness boundary between governed AI conclusions and human-facing explanatory projection.

1. Every explanation binds to the exact decision, evidence materializations, prompt/schema/provider/model lineage, calibration state, N-version disagreement state, scenario state, and attribution state used by the governed run.
2. Explanations are normalized into explicit claims with evidence references, provenance class, uncertainty language, and materiality.
3. Claim support is explicit as `SUPPORTED`, `PARTIALLY_SUPPORTED`, `UNSUPPORTED`, `CONTRADICTED`, or `UNVERIFIED`.
4. Evidence identity and integrity are necessary but not sufficient; the verifier must test whether the cited evidence actually supports the claim under deterministic policy-defined rules where feasible.
5. Material counterevidence known to the governed context cannot be silently omitted when its omission would materially change the explanation.
6. Hypothetical/scenario evidence must remain labeled hypothetical and cannot be narrated as observed or realized fact.
7. Explanation probability, confidence, uncertainty, and strength language must remain consistent with canonical raw/calibrated/effective confidence and abstention state.
8. Provider consensus cannot manufacture support. Provider disagreement/incomplete state must be represented truthfully and can require claim suppression or explanation abstention.
9. Attribution states must not be overstated: `UNRESOLVED` or `PARTIALLY_IDENTIFIED` cannot be narrated as a proved cause.
10. Model self-rating, chain-of-thought, narrative fluency, or provider majority cannot establish faithfulness.
11. Independent verification is preferred; any provider-backed verifier consumes the existing WO-AI-006 shared bounded resource controller and remains zero-authority.
12. A material unsupported or contradicted claim fails closed to read-only explanation suppression/abstention. It never increases trusted confidence or execution authority.
13. Explanation records and verifier evidence are replayable, secret-minimized, and exclude credentials and hidden chain-of-thought.

## Evaluation truth

Required adversarial evaluation includes unsupported claims, wrong citations, contradicted claims, material counterevidence omission, observed/hypothetical provenance confusion, calibration-language inflation, disagreement suppression, attribution overclaiming, replay conflict, resource exhaustion, and secret leakage attempts.

Synthetic fixtures may prove verifier correctness only. They do not prove predictive alpha, profitability, real-world causal correctness, or market forecasting improvement.

## Authority invariants

- `liveAuthority=NONE`
- `realOrderAuthority=false`
- `realTransferAuthority=false`
- `productionMutationAllowed=false`
- AI remains ZERO_AUTHORITY/read-only
- deterministic Risk Governor, P0, HALT, and kill switch remain authoritative
- WO-0051 remains HUMAN_ENVIRONMENT_ONLY

## Non-goals

This ADR does not authorize hidden reasoning disclosure, automatic prompt/model/provider weighting changes, strategy generation/promotion, risk changes, credential access, PAPER execution changes, LIVE execution, production mutation, or replacement of human authority.
