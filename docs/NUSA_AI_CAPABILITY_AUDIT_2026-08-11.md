# NUSA AI Capability Audit — 2026-08-11

## Baseline

Protected main baseline: `86a7aed480211d8c35b38db4bff9529be0cd0d7c` after WO-AI-009 completion bookkeeping.

## Evidence-backed capability scorecard

- grounding/provenance/prompt identity: 4/4
- outcome calibration lifecycle: 4/4
- inference resource governance: 4/4
- independent provider/model diversity: 3/4
- multi-agent independence/disagreement intelligence: 3/4
- explanation quality/faithfulness: 2/4
- scenario/counterfactual reasoning: 3/4
- learning/attribution beyond calibration: 3/4 after WO-AI-009
- provider-pool/resource ownership: 3/4
- cost-quality optimization: 3/4 after WO-AI-009 net-benefit gate
- observability/replayability/fault isolation: 4/4
- security/adversarial robustness: 4/4
- evaluation quality: 3/4

## Lowest remaining capability

Explanation quality/faithfulness remains the lowest-scoring AI dimension.

NUSA now has strong evidence binding, calibration, provider disagreement, scenario sensitivity, replay, attribution, and immutable learning memory. The missing layer is a deterministic way to prove that a human-facing AI explanation is actually supported by the same evidence, assumptions, uncertainty, provider disagreement, scenario results, and attribution state that governed the underlying decision.

Today, a structured model output may still be fluent while omitting material counterevidence, overclaiming a cause, presenting a hypothetical as observed fact, or making a claim whose cited evidence does not entail it. Existing grounding validates evidence identity and integrity; it does not by itself prove explanation faithfulness.

## Selected next slice

WO-AI-010 — Governed Explanation Faithfulness and Claim-Evidence Verification.

## Target capability

- immutable explanation policy and replay identity
- normalized claim graph bound to exact decision/evidence/prompt/provider/model/calibration/disagreement/scenario/attribution lineage
- explicit claim support states: SUPPORTED, PARTIALLY_SUPPORTED, UNSUPPORTED, CONTRADICTED, UNVERIFIED
- material-counterevidence omission detection
- observed-versus-hypothetical provenance enforcement
- deterministic uncertainty/calibration consistency checks
- disagreement/scenario/attribution state consistency checks
- independent verifier path that does not trust model self-rating
- explanation completeness and unsupported-claim metrics
- fail-closed read-only abstention or explanation suppression when material claims are unsupported/contradicted
- no increase in trusted confidence or authority from explanation quality
- WO-AI-006 bounded resource accounting for any provider-backed verifier

## Evaluation truth

Synthetic/adversarial fixtures may prove claim/evidence verifier correctness, omission detection, contradiction detection, provenance enforcement, and replay behavior. They are not evidence of market predictive accuracy, alpha, profitability, or real-world causal correctness.

Real-world explanation-quality claims require verified resolved outcomes and held-out longitudinal evidence. A fluent explanation, provider majority, or model self-score is not proof of faithfulness.

## Safety invariants

- AI remains ZERO_AUTHORITY/read-only
- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- `realOrderAuthority=false`
- `realTransferAuthority=false`
- no automatic model/provider weighting, prompt mutation, strategy promotion, risk increase, broker mutation, credential use, kill-switch release, or LIVE authority
- WO-0051 remains HUMAN_ENVIRONMENT_ONLY
