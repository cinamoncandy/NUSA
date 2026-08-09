# ADR-0011: Governed Scenario and Counterfactual Reasoning

- Status: Proposed
- Date: 2026-08-09
- Scope: PAPER/Research zero-authority AI reasoning only

## Context

WO-AI-001 through WO-AI-007 established grounded structured inference, durable outcome calibration, shared inference resource governance, and independent-provider N-version disagreement evaluation. The fresh post-WO-AI-007 capability audit finds scenario/counterfactual reasoning and broader attribution tied as the weakest intelligence dimensions.

The current Cloud AI can reason over one verified observed evidence snapshot and can compare independent provider conclusions. It cannot yet represent controlled hypothetical interventions as a first-class, replayable capability. Informal model-generated "what if" prompts would be difficult to distinguish from observed facts, hard to reproduce, easy to over-spend, and vulnerable to a model inventing both the scenario and its confirming conclusion.

The target NUSA AI architecture explicitly calls for a Scenario Generator in the Perception/World-Model layer, Counterfactual Research in the Research layer, and Counterfactual Replay in the Learning/Attribution layer. A governed hypothetical-evidence boundary is therefore an upstream prerequisite for stronger scenario intelligence and later attribution.

## Decision

NUSA will introduce a provider-neutral governed scenario/counterfactual reasoning boundary before broader autonomous learning or attribution.

1. Define an immutable versioned `AiScenarioPolicy` that bounds allowed intervention dimensions, magnitude/range semantics, horizon semantics, maximum scenario count, canonical ordering, duplicate equivalence, and an enclosing resource envelope.
2. Define canonical `AiScenarioDefinition` values with explicit `BASELINE` or `HYPOTHETICAL` kind and immutable lineage to one exact observed evidence snapshot.
3. Observed evidence is immutable. A hypothetical scenario may reference or transform approved derived inputs but may not alter observed evidence IDs, provenance, quality, event time, received/model-available time, content digests, or verified-runtime classification.
4. Hypothetical values and assumptions must carry explicit hypothetical provenance and can never be serialized or projected as observed market facts.
5. Scenario materialization must be deterministic from scenario policy + observed snapshot + intervention definition. Model-generated free-form hidden world state is not a substitute for canonical scenario identity.
6. Equivalent/duplicate scenarios must be detected before provider calls so aliases or formatting differences cannot inflate scenario coverage or consume extra inference budget.
7. Scenario evaluation may use the existing provider-neutral inference path and, when configured, the WO-AI-007 independent-provider comparison. Every provider result keeps exact scenario, evidence, prompt/schema, model/provider and resource-policy lineage.
8. All scenario/provider/retry fan-out must fit one enclosing experiment/resource budget derived from WO-AI-006 semantics. Starting a later scenario/provider side effect after exhaustion is prohibited.
9. Produce structured sensitivity evidence across decision state, raw probability, uncertainty, assumptions, rationale/evidence references, provider disagreement, failures and abstention state.
10. Expose explicit scenario robustness outcomes such as `ROBUST | SENSITIVE | CONTRADICTORY | INCOMPLETE | UNVERIFIED`. These are read-only analysis evidence, not execution or promotion authority.
11. Independent-provider/scenario contradiction must be visible and may reduce trust or force abstention. The system may not cherry-pick the scenario/provider that supports a preferred recommendation.
12. Hypothetical scenario outputs may never enter `VERIFIED_RUNTIME` calibration outcomes, realized-market evidence, production evidence, or learning credit as though the scenario occurred.
13. Scenario replay is identity-bound and idempotent. Changed policy, baseline evidence, intervention definition, prompt/schema or result identity fails closed rather than reusing stale evidence.
14. No scenario result may authorize PAPER mutation, strategy promotion, risk increase, production mutation, credential use, broker mutation, kill-switch release, or LIVE execution.
15. WO-0051 remains HUMAN_ENVIRONMENT_ONLY and cannot be satisfied or bypassed by this work.

## Consequences

- NUSA gains measurable decision sensitivity instead of only point-in-time narrative reasoning.
- Hypothetical reasoning becomes explicitly distinguishable from observed evidence, protecting calibration and future learning from counterfactual contamination.
- WO-AI-006 resource governance constrains scenario fan-out; WO-AI-007 can independently cross-check conclusions within the same governed scenario identity.
- Controlled scenario evidence becomes reusable by future explanation-faithfulness and post-decision attribution systems.
- More scenario/model calls can increase cost and latency, so the implementation must measure net information gain and stop before budget exhaustion.

## Evaluation principle

AI-008 is successful only if deterministic/adversarial evaluation shows better **robustness and sensitivity observability** than the current single-state analysis. Synthetic scenarios are evaluation fixtures, not proof of market predictive accuracy or profitability.

At minimum, evaluation must verify:

- material controlled interventions produce detectable sensitivity when fixture behavior changes;
- irrelevant perturbations preserve invariant fixture behavior;
- contradictory providers/scenarios force contradiction/abstention rather than hidden averaging;
- duplicates are removed before provider side effects;
- observed evidence/provenance mutation attempts fail before inference;
- hypothetical outputs cannot gain verified calibration credit;
- shared resource limits stop future scenario/provider calls before side effects;
- exact replay is idempotent and conflicting replay fails closed;
- confidence cannot increase merely because more scenarios were evaluated.

## Non-goals

- No claim that a hypothetical scenario occurred in the real market.
- No unbounded autonomous scenario generation.
- No hidden chain-of-thought persistence.
- No automatic strategy mutation, generation, promotion or deployment in this slice.
- No risk-limit relaxation or safety-policy mutation.
- No order, cancel, transfer, withdrawal or broker execution capability.
- No LIVE authority or production transition.
- No attempt to satisfy or bypass WO-0051.
