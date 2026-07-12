# Funding Carry Engine v0.1

This module evaluates delta-neutral spot/perpetual carry opportunities for DRY_RUN and PAPER workflows only.

## Scope

- Resolve one active spot/perpetual pair from exchange metadata.
- Calculate expected funding income in basis points.
- Subtract fees, slippage, basis risk, incomplete-fill risk, and capital cost.
- Reject stale, negative-funding, low-edge, inactive, mismatched, or kill-switched candidates.
- Monitor actual spot/perpetual base-equivalent delta.
- Escalate from HEDGED to REBALANCE_REQUIRED or EMERGENCY_EXIT_REQUIRED.
- Produce HOLD, REDUCE, or EXIT decisions for funding reversal, negative carry, wide basis, weak liquidity, low liquidation buffer, withdrawal reservations, and kill switch activation.

## Safety boundary

This is not risk-free arbitrage. Material risks include asymmetric fills, partial fills, basis expansion, funding reversal, liquidation, exchange outage, symbol metadata errors, and withdrawal-driven capital reduction.

No private exchange API, credential handling, live order routing, leverage activation, withdrawal, or automatic production promotion is implemented.

## Next step

Add a PAPER-only atomic hedge coordinator that distinguishes order acceptance from actual fills, tracks residual quantity, cancels unfilled legs, and emits immutable compensation plans. Live execution remains out of scope.
