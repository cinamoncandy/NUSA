# NUSA AI Capability Audit — 2026-08-09

## Scope

Fresh read-only capability audit after evidence-verified completion of WO-AI-007. Baseline: `main@a4148334a90bb7a2f4113199817d47b8694b672f`.

This audit selects the next **zero-authority** AI intelligence improvement. It does not satisfy or modify WO-0051, does not authorize LIVE, and does not add execution, credential, promotion, risk-increase, or production-mutation authority.

## Evidence reviewed

- `docs/NUSA_AI_ARCHITECTURE_V1.md`
- `docs/NUSA_AI_EVOLUTION_PRINCIPLE.md`
- `packages/contracts/src/aiInference.ts`
- `packages/contracts/src/aiInferenceResources.ts`
- `packages/contracts/src/aiProviderDiversity.ts`
- `apps/cloud/src/ai/agentExecutor.ts`
- `apps/cloud/src/ai/modelProvider.ts`
- `apps/cloud/src/ai/openAiResponsesModelProvider.ts`
- `apps/cloud/src/ai/anthropicMessagesModelProvider.ts`
- `apps/cloud/src/ai/multiAgentOrchestrator.ts`
- `apps/cloud/src/ai/nVersionStrategyEvaluator.ts`
- `apps/cloud/src/ai/outcomeCalibration.ts`
- `apps/cloud/src/ai/calibrationDurabilityRuntime.ts`
- `apps/cloud/src/ai/runtime.ts`
- `apps/cloud/src/ai/projection.ts`
- `.aipos/evidence/WO-AI-007-completion.json`
- WO-AI-001 through WO-AI-007 merged verification evidence
- repository searches for scenario/counterfactual generation, explanation-faithfulness evaluation, experience attribution, and post-decision learning capabilities

## Current capability scorecard

Scale: 0 = absent, 1 = minimal, 2 = partial, 3 = substantial, 4 = strong verified slice.

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Grounding / provenance / prompt identity | 4 | Evidence-only inputs, digest-bound materialization, prompt artifacts, replay identity, schema validation. |
| Outcome calibration lifecycle | 4 | Verified runtime outcomes, exact cohort partitioning, ECE/Brier gates, durable SQLite replay, stale/corrupt chronology fail-closed. |
| Inference resource governance | 4 | WO-AI-006 provides immutable run budgets, shared call/retry accounting, byte/token/time ceilings, truthful usage state and fail-closed exhaustion. |
| Independent provider/model diversity | 3 | WO-AI-007 adds explicitly opt-in independent OpenAI + Anthropic comparison with provider/model-family identity and failure isolation; N-version comparison currently targets the strategy-proposer decision path rather than every AI role/capability. |
| Multi-agent independence / disagreement intelligence | 3 | N-version structured disagreement now detects correlated/fake independence and forces abstention; broader independent evaluation across all agent roles remains future work. |
| Explanation quality / faithfulness | 2 | Rationale claims, assumptions, uncertainty, adversarial counter-claims and alternatives exist, but there is no independent explanation-faithfulness/completeness evaluator. |
| Scenario / counterfactual reasoning | 1 | Target architecture explicitly requires a Scenario Generator and Counterfactual Research, but the merged Cloud AI path has no governed scenario contract, intervention model, sensitivity matrix, or counterfactual evaluation runtime. |
| Learning / attribution beyond calibration | 1 | Durable outcome calibration exists, but no post-decision attribution layer separates model skill, regime effect, execution, sizing, risk intervention, or noise/luck. |
| Provider-pool / in-process resource ownership | 3 | Shared inference budgets, timeouts, private credentials and provider failure isolation exist; broader pool cancellation/cache lifecycle remains future hardening. |
| Cost-quality optimization | 2 | Calls/tokens/latency are auditable and bounded, but no versioned monetary rate-card or quality-per-cost selection policy exists. |

## Selected next dimension

**Governed scenario and counterfactual reasoning** is selected for WO-AI-008.

Scenario/counterfactual reasoning and broader learning/attribution both remain at 1/4. Scenario intelligence is selected first because it is the safer upstream prerequisite for both stronger investment reasoning and later causal attribution:

1. The target architecture explicitly places a Scenario Generator in the Perception/World-Model layer and Counterfactual Research in the Research layer.
2. The current AI evaluates one observed evidence state but cannot yet ask how its decision changes under controlled alternative assumptions or shocks.
3. WO-AI-006 already bounds calls, attempts, tokens, bytes and time, preventing scenario fan-out from becoming unbounded research.
4. WO-AI-007 already provides independent-provider disagreement/abstention evidence, so scenario sensitivity can be cross-checked instead of trusting one correlated model path.
5. Controlled scenarios create reusable evidence for later explanation-faithfulness and post-decision attribution without requiring online self-modification.
6. The capability can be evaluated deterministically for robustness observability without pretending hypothetical scenarios are observed market facts or claiming predictive accuracy.

## Observed gap

The merged Cloud AI path has grounded evidence, a four-role primary orchestration, independent provider comparison, calibration, and durable outcome memory. It does **not** yet have a canonical boundary for hypothetical interventions.

Without that boundary, asking a model informal "what if" questions would be unsafe and hard to evaluate because:

- hypothetical values could be confused with observed evidence;
- scenario definitions would lack immutable identity and replay semantics;
- repeated or semantically equivalent scenarios could waste inference budget;
- scenario fan-out could escape the shared resource envelope;
- counterfactual outputs could accidentally be fed into verified-runtime calibration or learning as though they occurred;
- sensitivity and invariance would remain narrative rather than measurable;
- one model could invent both the scenario and the conclusion, creating self-confirming evaluation.

## WO-AI-008 design direction

WO-AI-008 should introduce a provider-neutral **Governed Scenario & Counterfactual Reasoning** capability with:

- an immutable versioned `AiScenarioPolicy` defining allowed intervention dimensions, bounded magnitudes, horizon semantics, maximum scenario count, deduplication and resource limits;
- a canonical `AiScenarioDefinition` that explicitly distinguishes `BASELINE` from `HYPOTHETICAL` and binds every scenario to the exact observed evidence snapshot it perturbs;
- strict separation between observed evidence and hypothetical intervention material: a scenario may reference observed evidence but may never rewrite its provenance, quality, timestamps, content digest or `VERIFIED_RUNTIME` status;
- deterministic scenario identity, canonical ordering, duplicate detection and replay/idempotency;
- bounded scenario generation/materialization that cannot create secret, credential, tool, broker, order, risk-policy or LIVE inputs;
- scenario evaluation through the existing provider-neutral model boundary and, where configured, the WO-AI-007 independent-provider comparison path;
- one enclosing experiment/resource budget so scenario count, provider fan-out and retries cannot multiply WO-AI-006 limits invisibly;
- structured sensitivity evidence across decision, raw probability, uncertainty, assumptions, rationale/evidence references, provider disagreement and failure state;
- explicit robustness states such as `ROBUST | SENSITIVE | CONTRADICTORY | INCOMPLETE | UNVERIFIED` without turning robustness into execution authority;
- fail-closed behavior when baseline identity, scenario lineage, provider comparison, resource accounting or replay identity conflicts;
- hard prohibition on using hypothetical scenario results as verified calibration outcomes, realized market evidence, production evidence, or autonomous learning credit;
- read-only projection of scenario coverage, sensitivity, contradiction, uncertainty and resource use;
- no automatic strategy mutation, promotion, risk change, execution, order, transfer, withdrawal, credential use, or LIVE authority.

## Evaluation requirements

AI-008 must prove improved **decision-robustness observability**, not merely produce more text or more model calls. Verification should include deterministic/adversarial before-after evidence covering at least:

- material controlled intervention that changes a fixture decision is detected as sensitivity rather than hidden;
- invariant fixture remains stable across irrelevant perturbations;
- contradictory scenario/provider conclusions produce `CONTRADICTORY` or abstention rather than cherry-picked confidence;
- duplicate/equivalent scenario definitions are deduplicated before provider side effects;
- attempted mutation of observed evidence/provenance is rejected before inference;
- hypothetical scenario results cannot enter `VERIFIED_RUNTIME` calibration or durable outcome credit;
- scenario/provider fan-out obeys one enclosing resource budget and stops before later side effects on exhaustion;
- exact replay is idempotent while changed policy/evidence/scenario identity fails closed;
- raw/calibrated confidence is never increased merely because more scenarios were evaluated;
- zero-authority, PAPER isolation, security and all Restricted LIVE/read-only safety workflows remain PASS.

Synthetic scenario fixtures may prove robustness/sensitivity detection only. They must not be described as evidence of real-market predictive accuracy or profitability.

## Deferred dimensions

After WO-AI-008 is verified, re-audit rather than assuming the next task. Current likely candidates are:

1. broader post-decision learning and attribution;
2. independent explanation faithfulness/completeness evaluation;
3. wider N-version independence across additional AI roles/capabilities;
4. provider-pool lifecycle/cancellation/cache hardening;
5. versioned monetary rate-card and cost-quality optimization.

The ranking must be recomputed from merged repository evidence after every completed slice.
