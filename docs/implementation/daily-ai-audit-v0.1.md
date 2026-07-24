# Daily AI Audit v0.1

## Purpose

Daily AI Audit turns immutable opportunity attribution records into a read-only operating summary. It does not change strategy weights, governance state, allocation limits, or trading mode.

## Inputs

- closed opportunity attribution records
- audit period
- minimum sample size
- minimum edge capture ratio
- maximum calibration error
- maximum execution cost ratio
- minimum net PnL

## Outputs

Portfolio-level metrics:

- total trades
- total net PnL
- expected and captured edge
- portfolio edge capture ratio
- average confidence calibration error
- total execution drag

Strategy health states:

- `HEALTHY`
- `WATCH`
- `THROTTLE_RECOMMENDED`
- `PAPER_ONLY_RECOMMENDED`

## Safety boundary

Health states are recommendations only. This module cannot:

- submit or cancel orders
- change a strategy lifecycle state
- promote or demote a strategy
- modify model weights
- bypass Strategy Governance, Kill Switch, treasury reservations, or PAPER-only boundaries

All invalid timestamps, duplicate opportunity IDs, non-finite metrics, and invalid thresholds fail closed. Outputs are deterministic and immutable.
