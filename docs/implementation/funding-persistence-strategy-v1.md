# Funding Persistence Strategy v1

## Purpose

`FundingPersistenceStrategy.ts` converts a validated Funding Persistence feature vector into a deterministic research/Paper signal candidate.

The pre-registered candidate is mean reversion:

- persistently extreme positive funding -> short candidate
- persistently extreme negative funding -> long candidate
- normalized funding while a position is open -> exit candidate

This is a research hypothesis, not evidence of profitability.

## Entry gates

Every entry gate must pass:

- supported feature version
- fresh feature
- minimum feature quality
- no feature warnings
- minimum absolute funding Z-score
- minimum persistence samples and ratio
- positive open-interest confirmation
- bounded absolute basis
- non-neutral direction

Any failed gate produces `ABSTAIN` and preserves the current target position.

## Exit behavior

An existing position receives `EXIT` when the absolute funding Z-score falls to or below the configured exit threshold. The exit threshold must remain below the entry threshold to provide deterministic hysteresis.

## Outputs

- `ENTER_LONG`
- `ENTER_SHORT`
- `EXIT`
- `HOLD`
- `ABSTAIN`

The result includes immutable reasons, feature version, generation time, provenance, target position, and bounded signal strength.

## Safety boundary

The module:

- does not submit orders
- does not size positions
- does not allocate capital
- does not modify governance state
- does not enable LIVE trading

It is intended only for deterministic research, replay, backtesting, and Paper evaluation.
