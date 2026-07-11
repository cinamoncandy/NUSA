# Research Lab MVP

## Objective

Build a measurable investment-research process before adding autonomous AI committees or strategy generation.

The first implemented vertical slice is a deterministic Paper backtest engine that reuses the existing `StrategyEngine` and `PaperBroker`. It records every signal, decision outcome, fill, rejection, and marked equity value so the same experiment can be replayed exactly.

## Implemented in the first slice

- ordered close-price input with strict validation;
- strategy factory isolation for deterministic replay;
- existing Paper fee and risk behavior;
- BUY, SELL, HOLD, and risk-rejection decision records;
- marked-to-market equity curve;
- total return;
- fee-aware buy-and-hold benchmark return;
- excess return;
- maximum drawdown;
- turnover;
- fill and rejection counts;
- final Paper account state.

## Explicit limitations

This is research infrastructure, not evidence that the current SMA strategy is profitable.

The first slice does not include:

- candle construction from raw Upbit ticks;
- historical market-data download;
- spread, slippage, latency, partial-fill, or market-impact models;
- forced closing of open positions at experiment end;
- Sharpe, Sortino, profit factor, expectancy, or trade matching;
- train/test splitting or walk-forward analysis;
- regime classification;
- parameter search;
- strategy ranking or Champion–Challenger promotion;
- AI-generated hypotheses or investment-committee voting;
- live execution.

## Research rules

A strategy may not be described as profitable, validated, or live-ready merely because it passes unit tests or one in-sample backtest.

Promotion order remains:

```text
Hypothesis
  -> deterministic backtest
  -> cost and execution stress tests
  -> out-of-sample / walk-forward validation
  -> Paper Trading
  -> Champion comparison
  -> owner review
```

Risk-adjusted performance, parameter stability, multiple market regimes, missing-data behavior, and comparison with a passive benchmark are mandatory before Paper promotion.

## Next vertical slices

1. Define a deterministic candle contract and missing-candle policy.
2. Add a versioned historical dataset manifest with source, market, interval, range, and checksum.
3. Add trade matching and research metrics: expectancy, profit factor, holding time, exposure, Sharpe, Sortino, and Calmar.
4. Add spread, slippage, and latency stress scenarios.
5. Add train/test split and rolling walk-forward experiment orchestration.
6. Add a Hypothesis Registry and immutable experiment records.
7. Add Champion–Challenger promotion rules.
8. Only after sufficient measured evidence, add prediction agents and committee evaluation.

## Safety boundary

Research execution remains PAPER-only. It must not access Upbit private APIs, credentials, live account state, or live order paths.
