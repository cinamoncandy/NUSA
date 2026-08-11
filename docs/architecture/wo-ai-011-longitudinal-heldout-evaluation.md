# ADR: Governed Longitudinal Held-Out Evaluation

- Status: Proposed by planning PR
- Date: 2026-08-11
- Scope: AI read-only evaluation evidence
- Base: `main@2cf1939afd029d5ce11e517d3f3b0bb6423ecd4b`

## Decision

Introduce a versioned, immutable longitudinal evaluation contract that evaluates resolved predictions only against temporal holdout and walk-forward partitions. Each record binds prediction time, evidence digest, provider/model, prompt, schema, calibration identity, partition identity, realized outcome, and replay identity.

The evaluator must abstain with `INSUFFICIENT_EVIDENCE` until minimum observation-window and sample thresholds are met. It must reject any feature, evidence, or outcome information whose event time is after the prediction timestamp. Synthetic, replay, hypothetical, and realized-market outcomes remain distinct provenance classes and cannot be substituted for one another.

Metrics are advisory and separated by provider, model, prompt, calibration version, and market regime. Degradation is an observable result only; it cannot trigger provider replacement, prompt/model changes, strategy promotion, risk changes, execution, funding, kill-switch release, or LIVE authority.

## Required economic evaluation semantics

Longitudinal evaluation must report predictive quality separately from economic usefulness. Where sufficient realized evidence exists, evaluation may include net-benefit measures after declared fees, spread/slippage assumptions, turnover, drawdown, and opportunity-cost baselines. These measurements remain research evidence only and never authorize capital allocation or execution.

## Temporal integrity

Every evaluation input must be demonstrably available at prediction time. Event time, received time, and model-available time must remain distinguishable where relevant. Overlapping or contaminated train/validation/holdout windows must fail closed rather than being silently repaired.

## Invariants

- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- `realOrderAuthority=false`
- `realTransferAuthority=false`
- AI remains `ZERO_AUTHORITY` and read-only
- deterministic replay and idempotency are required
- corrupted, stale, incomplete, ambiguous, or future-contaminated lineage fails closed
- realized outcomes cannot be replaced by synthetic, replay, or hypothetical evidence
- evaluation degradation cannot automatically mutate model, prompt, strategy, sizing, risk, or promotion state

## Serialization

Issue #349 / PR #371 physical Android acceptance remains `HUMAN_ENVIRONMENT_ONLY`. This planning gate may be reconciled and validated, but runtime implementation must not bypass the existing serialization boundary.

## Non-goals

No model training, weight update, prompt mutation, automatic promotion, broker operation, capital allocation, risk adjustment, LIVE activation, or human/environment gate completion.
