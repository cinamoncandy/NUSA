# Parameter Stability

NUSA evaluates a base strategy parameter set against an explicit, caller-supplied neighborhood.

## Purpose

The module detects whether out-of-sample performance depends on one isolated parameter point. It reports return and drawdown dispersion, positive-neighbor ratios, benchmark-outperformance ratios, and evidence warnings.

## Boundaries

- Neighbor sets are explicit. The module does not perform grid search, Bayesian optimization, genetic search, or automatic parameter discovery.
- Every neighbor is retained, including losing and benchmark-underperforming runs.
- Every parameter set uses the same dataset, Walk-Forward configuration, and execution-cost assumptions.
- OOS results are evaluated, not used to choose or replace neighbors.
- Results are deterministic for the same ordered semantic inputs.
- Strategy factories are executed but not persisted in the result identity; candidate IDs and parameter snapshots define the research identity.

## Status

- `ROBUST`: every tested neighbor is positive and outperforms the benchmark in a majority of OOS windows.
- `ACCEPTABLE`: evidence is mixed but no configured fragility boundary is breached.
- `FRAGILE`: a parameter cliff, sign-changing expectancy, unstable drawdown, or single-point dependence is detected.
- `INSUFFICIENT_EVIDENCE`: one or more parameter runs have too few OOS closed trades.

## Warnings

- `PARAMETER_CLIFF`
- `RETURN_DEPENDS_ON_SINGLE_POINT`
- `DRAWDOWN_UNSTABLE`
- `EXPECTANCY_UNSTABLE`
- `BENCHMARK_EDGE_UNSTABLE`
- `INSUFFICIENT_OOS_TRADES`

These labels are research diagnostics, not a profitability guarantee or an automatic promotion decision. Paper Trading and owner review remain required before any strategy promotion.
