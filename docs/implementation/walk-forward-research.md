# Walk-Forward Research Engine

## Purpose

Walk-forward analysis separates in-sample candidate selection from out-of-sample evaluation. It is deterministic research infrastructure, not a profitability guarantee or a Paper-promotion decision.

## Window Policy

Every window uses ordered, strictly increasing timestamps.

Rolling mode with `trainSize=100`, `testSize=20`, and `stepSize=20`:

```text
train 0..99    -> test 100..119
train 20..119  -> test 120..139
```

Anchored mode keeps the first observation while expanding the training set:

```text
train 0..99    -> test 100..119
train 0..119   -> test 120..139
```

Index endpoints are inclusive. Train and test are always disjoint. `stepSize < testSize` is rejected because it would overlap OOS windows. An incomplete final test window is excluded and reported as `INCOMPLETE_TEST_WINDOW_EXCLUDED`; it is never padded or selected after seeing partial results.

## Candidate Selection

Each candidate receives a fresh strategy instance and runs only on a window's training points. The default policy requires one closed trade, rejects drawdown above the configured limit, and uses a deterministic score based on:

1. total return;
2. expectancy;
3. profit factor;
4. maximum drawdown;
5. turnover penalty;
6. total trading-cost penalty.

The candidate ID is the lexical tie breaker. Test data is not passed to candidate selection, candidate scoring, or tie breaking. A test result cannot change its window's candidate and bad OOS results are retained.

## OOS Metrics

Each selected candidate is run independently on its test window. Results report closed-trade metrics, costs, exposure, benchmark outperformance, and marked-to-market open inventory.

Two aggregate return views are intentionally separate:

- **Equal-weight** averages independent window returns and is useful for comparing window quality.
- **Sequential compounded** applies each independent window return to a synthetic continuous equity sequence and reports its equity and drawdown.

They must not be treated as the same measure. The sequential view is an aggregation convention, not a simulation of transferred positions or live capital.

## Open Positions

No test window forces a final liquidation. An ending position remains `OPEN_POSITION` and is marked to its final close by the existing Backtest Engine. Each window is an independent experiment: its position is not carried into the next window, including the sequential aggregate.

## Stability Diagnostics

The engine records per-candidate selection frequency, train success, OOS profitability, OOS expectancy, average train score, OOS return/drawdown, and train/OOS return gap. Warnings identify candidate dominance, high selection churn, train/OOS divergence, insufficient closed-trade samples, cost-dominated performance, and OOS concentration.

These diagnostics are screening signals, not an optimizer or strategy-promotion decision.

## Boundaries

The engine has no exchange, private API, credential, persistence, live-order, AI, LLM, or automatic strategy-generation dependency. Paper promotion still requires declared historical data, out-of-sample evidence, walk-forward stability, cost stress, and separate Paper Trading evidence.
