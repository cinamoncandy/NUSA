# Probability, Rotation, and Execution v0.1

This increment adapts the uploaded Polymarket bot analysis into exchange-neutral DOKKAEBI controls.

## Flow

1. `probabilityEdgeEngine` compares model probability with market-implied probability.
2. Estimated round-trip cost is removed before an edge is considered actionable.
3. `positionRotationEngine` changes exposure in bounded steps instead of all-in/all-out transitions.
4. Cooldown and reversal limits reduce repeated false reversals.
5. `executionQualityEngine` measures adverse slippage, fee rate, and latency after a fill.

## Safety boundaries

- Stale observations cannot create an actionable edge.
- Sub-threshold net edge becomes `NO_EDGE`.
- Position changes are capped by `maxStep` and `maxAbsoluteExposure`.
- Direction reversals first reduce the old position; they do not jump directly through zero.
- Reversal frequency and cooldown are explicit inputs.
- Execution quality is observational only and does not submit orders.
- No private exchange API, credentials, live order path, or withdrawal path is introduced.

## Not included

- Polymarket-specific binary contract settlement
- temporal complete-set arbitrage
- market making
- resolution-lag sniping
- live trading

The reusable ideas are probability mispricing, incremental inventory adjustment, and execution-quality accounting. Profitability is not assumed or guaranteed.
