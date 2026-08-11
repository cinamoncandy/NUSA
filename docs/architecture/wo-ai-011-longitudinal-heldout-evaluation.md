# ADR: Governed Longitudinal Held-Out Evaluation

- Status: Proposed by planning PR
- Date: 2026-08-11
- Scope: AI read-only evaluation evidence

## Decision

Introduce a versioned, immutable longitudinal evaluation contract that evaluates resolved predictions only against temporal holdout and walk-forward partitions. Each record binds prediction time, evidence digest, provider/model, prompt, schema, calibration identity, partition identity, realized outcome, and replay identity.

The evaluator must abstain with `INSUFFICIENT_EVIDENCE` until minimum observation-window and sample thresholds are met. It must reject any feature, evidence, or outcome information whose event time is after the prediction timestamp. Synthetic, replay, hypothetical, and realized-market outcomes remain distinct provenance classes and cannot be substituted for one another.

Metrics are advisory and separated by provider, model, prompt, calibration version, and market regime. Degradation is an observable result only; it cannot trigger provider replacement, prompt/model changes, strategy promotion, risk changes, execution, funding, kill-switch release, or LIVE authority.

## Invariants

- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- `realOrderAuthority=false`
- `realTransferAuthority=false`
- AI remains `ZERO_AUTHORITY` and read-only
- deterministic replay and idempotency are required
- corrupted, stale, incomplete, or ambiguous lineage fails closed

## Non-goals

No model training, weight update, prompt mutation, automatic promotion, broker operation, capital allocation, risk adjustment, LIVE activation, or human/environment gate completion.
