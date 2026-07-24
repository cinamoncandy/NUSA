# Champion Monitor and Rollback Recommendation v1

## Purpose

Evaluate a current Champion against edge decay, calibration, evidence, drawdown, risk, incidents, and governance state.

This module produces an immutable recommendation only. It does not mutate lifecycle state, change capital, submit orders, release controls, or enable LIVE trading.

## Inputs

- strategy identity and lifecycle
- Edge Decay Monitor result
- evidence score
- calibration error
- current drawdown
- risk breach count
- governance approval
- active critical incident state
- current capital fraction
- evidence references

## Recommendations

- `MAINTAIN`
- `OBSERVE`
- `REDUCE_CAPITAL`
- `ROLLBACK_TO_PAPER`
- `SUSPEND`

Every result has `requiresHumanApproval: true`.

## Fail-closed rules

- missing governance approval recommends suspension
- an active critical incident recommends suspension
- excessive risk breaches recommend suspension
- red edge decay, weak evidence, calibration failure, or drawdown breach recommend rollback to Paper
- orange edge decay recommends reduced capital
- yellow edge decay recommends observation and a conservative capital multiplier
- a non-Champion lifecycle cannot be promoted by this module

## Safety boundary

PAPER / DRY_RUN only. The module has no execution adapter, credential access, private exchange API, lifecycle mutation, or automatic rollback path.
