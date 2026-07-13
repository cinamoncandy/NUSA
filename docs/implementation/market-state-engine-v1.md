# Market State Engine v1

## Purpose

Market State Engine converts fresh, validated market observations into one immutable and replayable market-state snapshot. It does not create trades, orders, position sizes, or portfolio allocations.

## Required observations

- 5-minute return
- realized volatility
- spread in basis points
- order-book imbalance
- available depth in USD
- funding rate
- open-interest change
- liquidation intensity

Every observation must include an observation timestamp, source, and source version. Missing, stale, future-dated, duplicated, non-finite, or provenance-free observations fail closed.

## Output

- regime: `TREND_UP`, `TREND_DOWN`, `RANGE`, `HIGH_VOLATILITY`, or `LIQUIDITY_STRESS`
- trend score
- volatility score
- liquidity score
- stress score
- uncertainty score
- confidence
- generation timestamp
- ordered source provenance

All scores are deterministic values in the range 0 to 1. The result and nested provenance are frozen.

## Regime precedence

1. liquidity stress
2. high volatility
3. upward trend
4. downward trend
5. range

Stress regimes take precedence so a directional move cannot hide an unsafe liquidity condition.

## Safety boundary

- PAPER/DRY_RUN analysis only
- no private API
- no order submission
- no capital allocation
- no direct strategy decision
- no hidden fallback for missing data
- no future data

The Probability, Alpha, Portfolio, Risk, and Execution layers may consume this snapshot only after their own validation contracts pass.
