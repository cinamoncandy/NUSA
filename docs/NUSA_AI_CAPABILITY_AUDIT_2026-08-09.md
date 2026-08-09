# NUSA AI Capability Audit — 2026-08-09

## Scope

Fresh read-only capability audit after verified completion of WO-AI-006. Baseline: `main@26e06b8fc0070db20f4b598344396052b359ac50`.

This audit selects the next **zero-authority** AI improvement. It does not satisfy or modify WO-0051, does not authorize LIVE, and does not add execution, credential, promotion, risk-increase, or production-mutation authority.

## Evidence reviewed

- `docs/NUSA_AI_ARCHITECTURE_V1.md`
- `docs/NUSA_AI_EVOLUTION_PRINCIPLE.md`
- `packages/contracts/src/aiInference.ts`
- `apps/cloud/src/ai/agentExecutor.ts`
- `apps/cloud/src/ai/modelProvider.ts`
- `apps/cloud/src/ai/openAiResponsesModelProvider.ts`
- `apps/cloud/src/ai/multiAgentOrchestrator.ts`
- `.aipos/work-orders/WO-AI-006-inference-resource-governance.yaml`
- WO-AI-001 through WO-AI-006 merged verification evidence

## Current capability scorecard

Scale: 0 = absent, 1 = minimal, 2 = partial, 3 = substantial, 4 = strong verified slice.

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Grounding / provenance / prompt identity | 4 | Evidence-only inputs, digest-bound materialization, prompt artifacts, replay identity, schema validation. |
| Outcome calibration lifecycle | 4 | Verified outcomes, cohort partitioning, ECE/Brier gates, durable SQLite replay, corruption/chronology fail-closed. |
| Inference resource governance | 4 | WO-AI-006 adds immutable run budgets, shared call/retry accounting, byte/token/time ceilings, truthful usage state and fail-closed exhaustion. |
| Explanation quality | 2 | Rationale claims, assumptions, uncertainty, counter-claims and alternatives exist, but no independent faithfulness/completeness evaluator. |
| Independent provider/model diversity | 1 | Environment composition still constructs only OpenAI or unavailable; all four roles share one provider/model correlated failure group. |
| Scenario / counterfactual reasoning | 1 | Target architecture calls for governed scenario generation and counterfactual research, but current inference path has no dedicated scenario contract/runtime. |
| Learning / attribution beyond calibration | 1 | Durable calibration memory exists, but post-decision attribution does not yet separate model skill, regime, execution, risk intervention and noise. |
| Multi-agent independence / disagreement intelligence | 2 | Multiple roles and independence metadata exist, but correlated provider/model lineage means disagreement is not yet N-version evidence. |
| In-process AI resource ownership | 3 | WO-AI-006 bounds shared inference resources; broader cache/provider-pool lifecycle and cancellation isolation remain future work. |

## Selected next dimension

**Independent provider/model diversity and N-version disagreement evaluation** is selected for WO-AI-007.

Provider diversity, scenario reasoning and broader attribution remain low-scoring, but true N-version inference is the highest-value next prerequisite because:

1. Current four-agent output can look plural while sharing one provider/model failure mode.
2. Independent provider/model families create a measurable signal for correlated error, disagreement, consensus and abstention.
3. WO-AI-006 now bounds calls, retries, tokens, bytes and elapsed time, so additional inference paths can be admitted under a common resource contract instead of expanding cost blindly.
4. Provider diversity can improve robustness without granting any execution authority: all outputs remain evidence-only and zero-authority.
5. A trustworthy disagreement layer becomes reusable by later scenario generation, explanation faithfulness checks and broader learning/attribution.

## Observed gap

`createModelProviderFromEnvironment()` currently accepts only `NUSA_AI_PROVIDER=openai`; otherwise it returns `UnavailableModelProvider`. One configured provider/model is injected into the existing multi-agent runtime, so proposer, critic, risk analyst and final synthesizer remain correlated at the model/provider lineage level.

The missing layer is not merely a second adapter. NUSA needs explicit **provider-group identity, independence evidence, bounded fan-out, comparable structured outputs, disagreement measurement, and fail-closed aggregation**. A second provider that silently substitutes for the first or is mixed without provenance would add complexity without trustworthy intelligence.

## WO-AI-007 design direction

WO-AI-007 should introduce provider-neutral **N-version inference and disagreement governance** with:

- a versioned immutable provider-pool policy;
- at least two explicitly configured independent provider/model groups before any result may claim cross-provider consensus;
- canonical provider/model/prompt/schema/input/resource-policy lineage on every run;
- same evidence snapshot and same role contract for comparable N-version runs;
- deterministic bounded fan-out governed by WO-AI-006 resource admission;
- explicit `CONSENSUS | DISAGREEMENT | INSUFFICIENT_INDEPENDENCE | INCOMPLETE | UNVERIFIED` evaluation state;
- disagreement metrics over structured decision fields, probability, uncertainty, assumptions and cited evidence identities;
- no majority-vote authority: disagreement can reduce trust or force abstention, never create execution authority;
- provider failure isolation so one timeout/refusal/malformed output cannot be silently replaced and presented as independent agreement;
- no secret, raw credential, hidden reasoning or authorization material in comparison evidence;
- replay/idempotency binding that prevents duplicate side effects and detects lineage/config conflicts;
- read-only projection of provider groups, completeness, disagreement and trust impact;
- adversarial regressions for fake independence, duplicate provider/model lineage, partial provider failure, schema drift, correlated identical outputs, contradictory outputs, replay conflict and resource exhaustion.

## Evaluation requirements

AI-007 must not claim intelligence improvement merely because more models are called. Verification must include measurable before/after evidence:

- independence gate catches same-provider/same-model masquerading as diversity;
- injected contradictory fixtures produce deterministic disagreement/abstention;
- injected agreement fixtures produce consensus only when lineage independence is valid;
- partial provider failure remains incomplete rather than fabricated consensus;
- resource/call/token/latency ceilings remain enforced under fan-out;
- calibration and grounding evidence remain intact for each provider group;
- zero-authority, PAPER isolation and all Restricted LIVE/read-only safety workflows remain PASS.

## Deferred dimensions

After WO-AI-007 is verified, re-audit rather than assuming the next task. Current likely candidates are:

1. governed scenario/counterfactual reasoning;
2. independent explanation faithfulness/completeness evaluation;
3. broader post-decision learning/attribution;
4. provider-pool lifecycle/cache/cancellation hardening;
5. versioned monetary rate-card / cost-quality optimization only after trustworthy usage and provider diversity evidence exist.

The ranking must be recomputed from merged repository evidence after every completed slice.
