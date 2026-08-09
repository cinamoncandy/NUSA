# NUSA AI Capability Audit — 2026-08-10

## Scope

Fresh read-only capability audit after evidence-verified completion of WO-AI-008 and canonicalization of WO-0031 research-promotion authority. Baseline: `main@8dcc2e6abad05de824ac7c183210adf2fe02c624`.

This audit selects the next **zero-authority** AI intelligence improvement. It does not satisfy or modify WO-0051, does not authorize LIVE, and does not add execution, credential, promotion, risk-increase, model-weight mutation, or production-mutation authority.

## Evidence reviewed

- `docs/NUSA_AI_ARCHITECTURE_V1.md`
- `docs/NUSA_AI_EVOLUTION_PRINCIPLE.md`
- `docs/NUSA_AI_CAPABILITY_AUDIT_2026-08-09.md`
- `.aipos/decisions/ADR-0007-outcome-linked-ai-calibration.md`
- `.aipos/decisions/ADR-0008-durable-outcome-calibration-memory.md`
- `.aipos/decisions/ADR-0009-ai-inference-resource-governance.md`
- `.aipos/decisions/ADR-0010-n-version-provider-diversity.md`
- `.aipos/decisions/ADR-0011-governed-scenario-counterfactual-reasoning.md`
- `.aipos/work-orders/WO-AI-008-governed-scenario-counterfactual-reasoning.yaml`
- merged WO-AI-001 through WO-AI-008 verification evidence
- merged PR #379 canonical WO-0031 research-promotion authority boundary
- repository search for post-decision attribution, error decomposition, ablation-linked learning, explanation-faithfulness evaluation, provider/model weighting, and durable learning memory

## Current capability scorecard

Scale: 0 = absent, 1 = minimal, 2 = partial, 3 = substantial, 4 = strong verified slice.

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Grounding / provenance / prompt identity | 4 | Evidence-only inputs, digest-bound materialization, prompt artifacts, replay identity, schema validation. |
| Outcome calibration lifecycle | 4 | Verified runtime outcomes, exact cohort partitioning, ECE/Brier gates, durable replay, stale/corrupt chronology fail-closed. |
| Inference resource governance | 4 | Immutable run budgets, shared call/retry accounting, byte/token/time ceilings, truthful usage state and fail-closed exhaustion. |
| Independent provider/model diversity | 3 | Explicit OpenAI + Anthropic N-version comparison with provider/model-family identity and failure isolation; coverage is not universal across all roles. |
| Multi-agent independence / disagreement intelligence | 3 | Structured disagreement and abstention detect fake/correlated independence; broader independent evaluation across all roles remains future work. |
| Explanation quality / faithfulness | 2 | Rationale, assumptions, uncertainty, adversarial counter-claims and alternatives exist, but no independent explanation-faithfulness/completeness evaluator is canonical. |
| Scenario / counterfactual reasoning | 3 | WO-AI-008 adds immutable BASELINE/HYPOTHETICAL identity, observed-evidence preservation, deduplication, shared-budget evaluation, disagreement abstention, replay and 7/7 adversarial failure-quality coverage. This is robustness observability evidence, not market predictive-accuracy evidence. |
| Learning / attribution beyond calibration | 1 | Durable outcome calibration records whether probabilistic forecasts are reliable, but there is no governed post-decision layer that attributes misses to evidence gaps, model/provider behavior, scenario sensitivity, calibration, regime changes, or unresolved noise using replay/ablation evidence. |
| Provider-pool / in-process resource ownership | 3 | Shared budgets, timeouts, private credentials and failure isolation exist; broader cancellation/cache lifecycle remains future hardening. |
| Cost-quality optimization | 2 | Calls/tokens/latency are bounded and auditable, but there is no versioned monetary rate-card or measured quality-per-cost selection policy. |
| Observability / replayability / fault isolation | 4 | Hash-bound identities, deterministic replay, explicit degraded/unverified states, provider isolation, durable calibration replay, scenario replay and resource evidence are verified slices. |
| Security / adversarial robustness | 4 | Zero-authority boundary, deterministic fail-closed safety, exact-head CI/safety workflows and adversarial regression are repeatedly enforced. |
| Evaluation quality | 3 | Deterministic regression, adversarial fixtures, replay and outcome-linked calibration are strong; broader holdout/ablation causal attribution and independent explanation evaluation remain incomplete. |

## Selected next dimension

**Governed outcome-linked error attribution and learning memory** is selected for WO-AI-009.

Learning/attribution remains the lowest score at 1/4 after WO-AI-008. It is selected before explanation-faithfulness and cost-quality optimization because the system can now ground predictions, resolve real outcomes, preserve durable calibration history, compare independent providers, and run bounded counterfactual scenarios, but it still cannot answer a central learning question: **when a forecast or investment thesis is wrong, what evidence-supported failure mode best explains the miss?**

The newly canonicalized WO-0031 promotion authority does not change this ranking: it reduces architecture ambiguity and preserves human-governed promotion, but it does not add post-outcome attribution or autonomous AI authority.

## Design principle

Attribution must not pretend observational decomposition is causal proof. Every attribution must carry an explicit identifiability state. A label such as `REGIME_SHIFT_CANDIDATE` or `EVIDENCE_GAP_CANDIDATE` is descriptive unless supported by deterministic replay/ablation/holdout evidence defined by policy.

The system must prefer `UNRESOLVED` over a confident but weakly identified explanation.

## WO-AI-009 design direction

WO-AI-009 should introduce a provider-neutral **Outcome Attribution & Learning Memory** capability with:

- immutable attribution-policy identity/version and replay identity;
- exact linkage to verified prediction, resolved outcome, evidence snapshot, prompt/schema/provider/model lineage, calibration cohort and scenario experiment when present;
- deterministic post-outcome feature extraction without hidden chain-of-thought;
- candidate failure classes such as `EVIDENCE_GAP`, `MODEL_DISAGREEMENT`, `CALIBRATION_MISS`, `SCENARIO_SENSITIVITY_MISS`, `REGIME_SHIFT_CANDIDATE`, `DATA_QUALITY_FAILURE`, and `UNRESOLVED`;
- an explicit `IDENTIFIED | PARTIALLY_IDENTIFIED | UNRESOLVED | UNVERIFIED` attribution-strength state;
- replay/ablation comparisons that change one governed input dimension at a time and never rewrite observed history;
- independent-provider and scenario evidence as corroboration, never as automatic causal proof;
- holdout-safe evaluation so attribution rules are tuned/evaluated without scoring on the same cases used to define them;
- immutable learning episodes that summarize verified outcomes, evidence-linked failure candidates, counterevidence, attribution strength and lesson scope;
- retrieval of prior lessons only as read-only advisory evidence with exact provenance; no automatic model-weight update, provider weighting, strategy mutation, risk change, promotion or authority gain;
- strict cohort/version isolation so lessons cannot silently transfer across incompatible provider/model/prompt/outcome/regime definitions;
- explicit expiry/supersession semantics for stale lessons without deleting historical audit evidence;
- bounded resource usage through WO-AI-006 and replay-safe use of WO-AI-007/008 capabilities;
- read-only projection of attribution and lesson evidence without credentials, hidden reasoning or production mutation.

## Evaluation requirements

WO-AI-009 must prove better **error diagnosis and learning evidence quality**, not merely produce post-hoc narratives. Required before/after evaluation should include:

- known synthetic failure fixtures where a single controlled cause is identifiable and must be recovered correctly;
- ambiguous multi-cause fixtures that must remain `UNRESOLVED` rather than over-attributed;
- ablation fixtures proving irrelevant feature removal does not manufacture attribution;
- provider-disagreement fixtures where one provider is wrong but consensus/majority alone is not treated as causal proof;
- scenario-sensitive misses that are distinguished from calibration-only misses;
- evidence-quality corruption/tamper cases that fail closed before learning credit;
- exact replay idempotency and changed-policy/input conflict rejection;
- holdout split enforcement and leakage detection;
- no synthetic/hypothetical case may count as realized-market learning credit;
- learning episodes must never change `liveAuthority=NONE`, `productionMutationAllowed=false`, real order/transfer authority, deterministic Risk Governor, P0/HALT/kill switch or WO-0051;
- cost/latency/token deltas must be measured, and any attribution gain that materially regresses resource/safety constraints fails the net-benefit gate.

## Evidence truth

Passing deterministic fixtures proves attribution-engine correctness on those controlled cases. It does **not** prove real-market causal identification, predictive-alpha improvement, profitability, or autonomous learning quality. Real-world claims require verified resolved outcomes and held-out longitudinal evidence.

## Deferred dimensions

After WO-AI-009 is independently verified and merged, re-audit rather than assuming the next task. Likely candidates remain independent explanation-faithfulness/completeness evaluation, wider N-version coverage, provider-pool lifecycle hardening, cost-quality optimization, and longitudinal held-out learning effectiveness.
