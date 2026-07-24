# Regime OOS Attribution

## Purpose

This module explains where closed out-of-sample trades occurred by attaching each trade to the deterministic market-regime timeline.

It is an analysis layer, not a trading rule.

## Attribution policy

The default basis is `ENTRY`.

Each closed trade keeps both:

- entry regime
- exit regime

Aggregated PnL and trade statistics use one basis at a time. Entry and exit attribution are never mixed in the same result.

## Metrics

Each regime bucket reports closed-trade metrics only:

- trade count
- net profit
- profit factor
- expectancy
- win and loss rates
- average win and loss
- payoff ratio
- average holding time

Marked-equity return, exposure, and drawdown are not inferred for a regime bucket in this MVP because a trade can span multiple regimes and windows. Reporting them without a separately defined allocation policy would be misleading.

## Missing coverage

A trade is not assigned to an invented regime when its entry or exit timestamp is absent from the timeline. It is counted as unattributed and `UNATTRIBUTED_TRADES` is emitted.

Sparse and single-regime samples produce explicit warnings. Adverse regimes and losing trades remain in the result.

## Safety and research limits

- Regimes are deterministic rule-based classifications, not objective market truth.
- This module does not change strategy selection, order sizing, automatic trading, or capital allocation.
- Regime performance does not establish future profitability.
- OOS results, execution-cost stress, parameter stability, and Paper evidence remain separate promotion gates.
- PAPER-only and no-private-API boundaries remain unchanged.
