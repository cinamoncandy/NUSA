# Opportunity Performance Attribution v0.1

## Purpose

This module decomposes the realized result of a completed PAPER/DRY_RUN opportunity into auditable components. It does not place orders, change strategy weights, or promote strategies automatically.

## Inputs

- expected edge in basis points
- side, notional, open/close timestamps
- entry and exit reference prices
- actual entry and exit fill prices
- funding contribution
- fees, slippage, and modeled decay loss
- forecast confidence and binary realized outcome

## Outputs

- gross and net PnL
- market-move contribution
- execution contribution
- funding contribution
- fee and slippage contributions
- timing contribution
- decay contribution
- expected edge value
- captured edge value and edge-capture ratio
- confidence calibration error
- reconciliation error

## Safety and semantics

- timestamps must be ordered and non-negative
- prices and notional must be positive
- costs cannot be negative
- confidence must be between 0 and 1
- duplicate opportunity IDs are rejected during aggregation
- outputs are deterministic and immutable
- component reconciliation is exposed so accounting drift can be detected
- the attribution result is read-only audit data and cannot directly alter execution or governance state

## Limitations

Attribution is model-dependent. A decomposition is not proof that a factor caused the realized result. Reference-price selection, timing boundaries, and cost estimates must remain versioned and reviewable before this output is used for adaptive weighting.
