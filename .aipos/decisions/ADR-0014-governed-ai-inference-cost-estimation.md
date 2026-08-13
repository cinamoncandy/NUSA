# ADR-0014: Governed AI Inference Cost Estimation

- Status: Proposed
- Date: 2026-08-13
- Scope: PAPER/Research zero-authority AI reasoning only

## Context

`docs/NUSA_AI_CAPABILITY_AUDIT_2026-08-10.md` scored "Cost-quality optimization" at 2/4: WO-AI-006
already bounds and audits calls, tokens, and latency (`AiInferenceResourceSnapshot`), but nothing
translates verified token usage into an actual monetary figure. There is no way to see, bound, or
compare what a run actually cost.

## Decision

Introduce `evaluateAiInferenceCost()` (`apps/cloud/src/ai/costQualityEvaluator.ts`, contract in
`packages/contracts/src/aiCostQuality.ts`): a deterministic, pure function of
`(AiInferenceResourceSnapshot, providerId, modelVersionId, AiCostRateCard)`.

`AiCostRateCard` is an explicit, **versioned**, operator-supplied input -- never a live-fetched
or model-guessed price. Provider pricing changes over time; this module must never silently go
stale while presenting a cost figure as current. `DEFAULT_AI_COST_RATE_CARD` ships with an empty
`rates` map and `rateCardVersion: "0.0.0-unset"`, so every estimate against the unconfigured
default is `UNVERIFIED` until an operator supplies real prices -- there is no fabricated fallback
number.

The evaluator fails closed to `UNVERIFIED` (never a guessed or zero-defaulted cost) when:
- `usageAccountingStatus !== "VERIFIED"` (actual token counts aren't trustworthy),
- `actualInputTokens`/`actualOutputTokens` are `null` or non-finite,
- the `(providerId, modelVersionId)` pair has no entry in the rate card.

A verified `ESTIMATED` result still carries the rate card's identity (`rateCardId`,
`rateCardVersion`) so a reader can see exactly which prices produced the figure, and a zero-token
run produces an exact `0`, distinct from `UNVERIFIED` (covered by test).

## Consequences

- A monetary cost figure can now be computed for any inference run with verified usage and a
  priced model, closing the "no rate-card" half of the audited 2/4 gap.
- **Not wired into `projectAiReadOnly()` by this change**, unlike WO-AI-010's evaluator. Wiring
  requires a verified `providerId` for the run's model, and `AiOrchestrationResult`'s
  `AgentDefinition`/`AgentRun` types (`multiAgentGovernance.ts`) carry `modelVersionId` but no
  `providerId` field at all -- there is nothing to correctly derive it from without guessing at a
  naming convention, which this codebase's existing identity-verification conventions (exact
  fingerprint/digest matching throughout WO-AI-004 through WO-AI-009) would not accept. Adding a
  verified `providerId` to those contract types is a prerequisite for wiring this evaluator into
  the projection and is left as explicit follow-up, not attempted here.
- The "quality-per-cost" half of the audited gap (a measured quality-per-cost selection policy)
  is not addressed by this change either -- it requires a defined notion of "quality" per role
  (e.g. calibration Brier score, faithfulness strength) combined with cost, which is a separate
  design decision deferred to a future capability.
