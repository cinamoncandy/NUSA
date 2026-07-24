# Trade Permission / Reject Engine v1

## Purpose

The engine is the final deterministic authorization boundary before any Paper or Dry-Run execution plan may be created. Its default outcome is `REJECT`.

A decision becomes `PERMIT` only when every mandatory gate passes.

## Mandatory gates

1. Data quality
2. Freshness
3. Regime compatibility
4. Calibrated probability and non-abstention
5. Positive net expected value
6. Minimum reward-to-risk
7. Liquidity
8. Capacity
9. Slippage budget
10. Uncertainty limit
11. Model agreement
12. Risk-budget usage
13. Kill-switch state
14. Strategy governance approval

## Safety properties

- Fail closed
- Deterministic
- Immutable result
- Versioned policy and probability model references
- Explicit expiry time
- Complete passed/failed gate list
- Evidence references preserved
- No order submission
- No position sizing
- No LIVE adapter
- PAPER / DRY_RUN boundary only

## Non-goals

This module does not calculate probability, allocate capital, submit orders, release a kill switch, or promote a strategy.

## Required downstream rule

No execution plan may be produced unless the latest unexpired permission result is `PERMIT` and matches the same decision, strategy, market, policy version, and probability-model version.
