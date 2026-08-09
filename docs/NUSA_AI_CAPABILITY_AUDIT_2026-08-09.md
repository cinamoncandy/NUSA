# NUSA AI Capability Audit — 2026-08-09

## Scope

Fresh read-only capability audit after verified completion of WO-AI-005. Baseline: `main@66ca62fed422bd7186cbb5d589a8810dc2b83260`.

This audit selects the next **zero-authority** AI improvement. It does not satisfy or modify WO-0051, does not authorize LIVE, and does not add execution or production-mutation authority.

## Evidence reviewed

- `docs/NUSA_AI_ARCHITECTURE_V1.md`
- `docs/NUSA_AI_EVOLUTION_PRINCIPLE.md`
- `packages/contracts/src/aiInference.ts`
- `apps/cloud/src/ai/agentExecutor.ts`
- `apps/cloud/src/ai/modelProvider.ts`
- `apps/cloud/src/ai/openAiResponsesModelProvider.ts`
- `apps/cloud/src/ai/multiAgentOrchestrator.ts`
- WO-AI-001 through WO-AI-005 completion evidence

## Current capability scorecard

Scale: 0 = absent, 1 = minimal, 2 = partial, 3 = substantial, 4 = strong verified slice.

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Grounding / provenance / prompt identity | 4 | Evidence-only inputs, digest-bound materialization, prompt artifacts, replay identity, schema validation. |
| Outcome calibration lifecycle | 4 | Verified outcomes, cohort partitioning, ECE/Brier gates, durable SQLite replay, corruption/chronology fail-closed. |
| Explanation quality | 2 | Rationale claims, assumptions, uncertainty, counter-claims and alternative explanations exist, but no independent faithfulness/completeness evaluation. |
| Inference cost / latency / resource governance | 1 | Per-request timeout, retry cap, output token ceiling and provider usage metadata exist, but orchestration has no cumulative run budget, usage ledger, budget exhaustion state, or read-only resource evidence. |
| Independent provider diversity | 1 | Environment composition supports OpenAI only; all four roles share one provider/model correlated group. Independence detection exists, but true N-version provider diversity is not yet implemented. |
| Scenario / counterfactual reasoning | 1 | Target architecture calls for Scenario Generator and counterfactual research, but the current inference path has no governed scenario contract/runtime. |
| Learning / attribution beyond calibration | 1 | Durable calibration memory exists, but broader post-decision attribution separating skill, regime, execution, risk intervention, and noise remains future work. |
| In-process AI resource ownership | 2 | Timeout/AbortController and durable store close semantics exist; orchestration cache/resource lifecycle is still basic and not budget-governed. |

## Selected next dimension

**Inference cost / latency / resource governance** is selected for WO-AI-006.

Although provider diversity, scenario reasoning, and broader attribution also score 1, resource governance is the lowest-risk common prerequisite for all of them:

1. It adds no new provider credential or network surface.
2. It constrains future AI expansion before adding more models or agents.
3. The architecture explicitly requires latency budgets, cost budgets, experiment budgets, and excessive-latency/cost model-risk controls.
4. The current OpenAI adapter already returns token usage, so the missing layer is primarily contracts, accounting, enforcement, and read-only evidence rather than new intelligence authority.
5. It is measurable and deterministic: calls, attempts, bytes, tokens, and elapsed time can be verified without judging model opinions.

## Observed gap

The current path uses fixed request limits (`maxTokens=2048`, `timeoutMs=10000`) and bounded retries, but:

- all four agent calls can consume resources without a shared orchestration-run budget;
- response `ModelUsage` is not carried into `AgentRun` or the orchestration result;
- no cumulative token or call ledger is exposed;
- no explicit budget-exhausted failure semantic exists;
- no preflight reservation prevents starting a call when the remaining run budget cannot cover its declared ceiling;
- input/evidence byte consumption is not part of a run-level resource policy;
- no read-only dashboard/projection distinguishes configured budget, reserved budget, actual usage, latency, and health;
- monetary provider pricing is intentionally not normalized in the current architecture and should not be hard-coded into core contracts.

## WO-AI-006 design direction

WO-AI-006 should add a provider-neutral **Inference Resource Budget** boundary with:

- immutable per-orchestration policy;
- bounded model-call count and total attempt count;
- bounded cumulative output-token reservation before a call starts;
- bounded evidence/model-input bytes;
- bounded orchestration wall-clock budget;
- actual input/output/total token accounting when the provider reports usage;
- explicit `HEALTHY | EXHAUSTED | UNVERIFIED` resource state;
- fail-closed behavior: once budget is exhausted or required accounting becomes invalid, no further model call starts and the AI result is `INCOMPLETE`/zero-authority;
- read-only resource evidence in the orchestration/projection surface;
- deterministic replay/idempotency tests for the accounting state;
- no dollar-price table in core code. Vendor pricing may later be supplied by a separate versioned rate-card capability.

## Deferred dimensions

After WO-AI-006 is verified, re-audit in this order rather than assuming the next task:

1. true provider/model diversity and N-version routing;
2. governed scenario/counterfactual reasoning;
3. explanation faithfulness evaluation;
4. broader learning/post-decision attribution;
5. resource ownership/cache lifecycle hardening.

The ranking must be re-evaluated from repository evidence after each completed slice.
