# Funding Persistence Alpha v1 — Freeze Audit

## Decision

`FUNDING_PERSISTENCE` version 1 is frozen for research validation.

This freeze does **not** approve profitability, capital allocation, automatic promotion, or LIVE trading. It fixes the research contracts and safety boundaries so future evidence is comparable.

## Frozen modules

1. `FundingPersistenceFeature`
2. `FundingPersistenceStrategy`
3. `FundingPersistenceBacktest`
4. `FundingPersistenceWalkForward`
5. `FundingPersistenceStress`
6. `FundingPersistencePaper`

## Integration audit

- Feature output is consumed as an immutable, versioned observation.
- Strategy produces deterministic decisions and does not submit orders.
- Backtest executes only under its explicit execution and cost policy.
- Walk-Forward selects candidates from training evidence and reports OOS evidence separately.
- Stress preserves the baseline and evaluates explicit adverse scenarios.
- Paper uses an append-only hash-linked event ledger with deterministic replay.
- Champion candidate output is policy evidence only; it cannot promote itself.

## Safety invariants

- completed data only
- deterministic replay
- fail-closed validation
- PAPER/DRY_RUN only
- no private exchange API
- no credential access
- no LIVE order path
- no automatic promotion

## Change control

A breaking public-contract change requires version 2. Metric semantic changes require a new audit. Dataset contract changes require an explicit migration. Safety boundaries may not be relaxed inside version 1.

## Validation state

The pre-freeze implementation passed Windows CI run `#928`. The freeze manifest and regression test must pass the next CI before this audit is considered complete.

## Remaining research work

The implementation is complete, but the alpha is not empirically approved. Required evidence remains real dataset provenance, repeated OOS evaluation, stress evidence, sustained Paper observations, and owner review under the existing governance process.
