# Profitability Claim Gate v1

## Purpose

This gate controls whether DOKKAEBI may present a limited evidence statement. It does not predict profit and cannot authorize trading.

The only permitted positive statement is:

> Positive expectancy was observed in cost-aware out-of-sample, stress, and Paper evidence under the recorded assumptions. This does not guarantee future profit.

## Hard requirements

- Operational Completion is `READY_FOR_OWNER_REVIEW`.
- At least 30 closed OOS trades and 50 closed Paper trades.
- Positive OOS expectancy and Paper net profit.
- OOS and Paper profit factor at least 1.20.
- Marked maximum drawdown no greater than 10%.
- Non-negative return under doubled execution costs.
- Monte Carlo ruin probability no greater than 2%.
- Positive benchmark outperformance.
- Full dataset and scenario-evidence SHA-256 identities.

## Prohibited implications

The result always keeps guaranteed-profit claims disabled, implies no LIVE readiness, and requires owner approval. Backtest, OOS, stress, and Paper results may fail in future markets.
