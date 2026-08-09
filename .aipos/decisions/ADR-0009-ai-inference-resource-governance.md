# ADR-0009: Provider-Neutral AI Inference Resource Governance

- Status: Proposed
- Date: 2026-08-09
- Scope: PAPER/Research zero-authority AI inference only

## Context

WO-AI-001 through WO-AI-005 established grounded structured inference, real-provider support, outcome-linked calibration, and durable calibration replay. The post-WO-AI-005 capability audit (`docs/NUSA_AI_CAPABILITY_AUDIT_2026-08-09.md`) found that resource governance now trails the trust boundary.

The current runtime has useful per-request limits: bounded retries, a timeout, a maximum output-token request, a maximum output byte size, and provider-returned token usage. However, the four-agent orchestration has no shared run-level budget, provider usage is not retained in the orchestration evidence, and there is no explicit budget-exhausted state preventing a later call from starting.

The target AI architecture requires latency budgets, cost budgets, experiment budgets, excessive-latency/cost model-risk controls, and evidence-driven capability comparison. Adding more providers, agents, scenario generation, or learning before this common resource boundary would expand cost and operational risk faster than observability and control.

## Decision

NUSA will introduce a provider-neutral inference resource governance boundary before expanding model/provider breadth.

1. Define an immutable versioned `AiInferenceBudgetPolicy` for an orchestration run.
2. Govern at minimum:
   - maximum model calls;
   - maximum total attempts including retries;
   - maximum cumulative output-token reservation before calls start;
   - maximum model-input/evidence bytes;
   - maximum orchestration wall-clock duration.
3. Before each provider call, reserve the declared worst-case resources required by that request. If the reservation cannot fit, do not call the provider and return an explicit budget/resource failure with zero authority.
4. Record actual provider-reported input/output/total tokens and measured latency after successful calls. Invalid required accounting cannot increase trust or permit additional calls.
5. Keep actual usage separate from reserved ceilings. Released reservation may be reused only through deterministic rules defined by the policy/ledger.
6. Expose immutable read-only resource evidence including policy version, configured ceilings, calls, attempts, reserved/actual token counts, input bytes, elapsed time, and health (`HEALTHY | EXHAUSTED | UNVERIFIED`).
7. Do not hard-code vendor currency pricing into core contracts. Monetary cost requires a separate versioned rate-card capability because provider pricing changes independently from runtime safety semantics.
8. Resource exhaustion or unverified accounting may make AI analysis `INCOMPLETE`, but it must not affect PAPER execution, deterministic Risk Governor authority, strategy promotion, P0/HALT/kill-switch state, production mutation, or LIVE authority.
9. Resource policy must be replayable/idempotent from deterministic request/response metadata and tested against retries, malformed usage, timeouts, exhaustion, and replay conflicts.
10. WO-0051 remains HUMAN_ENVIRONMENT_ONLY and is not satisfiable by this work.

## Consequences

- Future provider/model/agent expansion is bounded by a common resource contract.
- Token and latency behavior becomes auditable instead of disappearing after the provider response.
- A runaway retry/call sequence fails closed before starting additional inference.
- Provider comparison can later use trustworthy resource evidence without coupling core code to volatile price tables.
- The system gains a prerequisite for safer N-version providers, scenario generation, and larger research workflows.

## Non-goals

- No second provider or model router in this slice.
- No autonomous provider/model selection or weighting.
- No USD/KRW cost estimation or live vendor pricing table.
- No strategy promotion/deployment.
- No risk-limit changes.
- No LIVE execution, broker mutation, credential expansion, or production transition.
- No attempt to satisfy or bypass WO-0051.
