# Capital Allocation Engine v1

## Purpose

Convert an already-permitted PAPER/DRY_RUN opportunity into a deterministic target capital amount. This module does not submit orders and cannot bypass Trade Permission or Risk.

## Inputs

- immutable Trade Permission result
- strategy lifecycle status
- total equity and available cash
- calibrated probability and payoff assumptions
- volatility, liquidity, capacity, correlation
- current portfolio and strategy weights
- risk budget, drawdown, daily and monthly return
- kill-switch state

## Outputs

- `ALLOCATE`, `REDUCE`, or `REJECT`
- target and maximum portfolio weights
- target capital and required cash reserve
- fractional-Kelly, drawdown, volatility, liquidity, and correlation multipliers
- immutable reasons and provenance

## Safety rules

- rejected or expired permission produces no allocation
- Research, Paper, Suspended, and Retired strategies receive no capital
- kill switch, exhausted risk budget, maximum drawdown, and loss limits force zero allocation
- Kelly is fractional and additionally constrained by portfolio, strategy, cash reserve, capacity, volatility, liquidity, and correlation limits
- Scaling strategies receive reduced capital
- no order, exchange, credential, private API, withdrawal, or LIVE capability exists

## Determinism and replay

The result depends only on the supplied input and policy. Outputs are immutable and carry the permission decision ID and policy version for replay and audit.
