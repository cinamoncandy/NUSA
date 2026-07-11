# Next Task

## Current validated research baseline

The deterministic Paper backtest vertical slice is implemented and passed Windows CI at head `34b0173716a19a1cb53ddec93cac4bb67d7f00dc` in run `#107`.

It reuses the production `PaperBroker` and `StrategyEngine`, records replayable decisions, and reports marked equity, total return, passive benchmark return, excess return, maximum drawdown, turnover, fills, and rejections.

## Current in-progress slice

The active branch now adds deterministic spread and slippage assumptions to the backtest engine.

The cost model:

- applies half-spread plus slippage adversely to every BUY and SELL;
- leaves PaperBroker fees and risk checks unchanged;
- records modeled execution price separately from observed market close;
- reports fees, spread cost, slippage cost, and total trading cost separately;
- rejects invalid or impossible cost assumptions;
- applies entry costs to the marked passive benchmark.

The latest head for this slice is not considered validated until Windows CI completes successfully.

## Immediate implementation order

1. Obtain frozen-install, typecheck, and complete Windows test validation for the cost-aware head.
2. Resolve the outstanding duplicate-signal and SQLite safety audit findings before Ready.
3. Define a deterministic candle contract and missing-candle policy.
4. Add a versioned historical dataset manifest with source, market, interval, range, and checksum.
5. Add trade matching and research metrics: expectancy, profit factor, holding time, exposure, Sharpe, Sortino, and Calmar.
6. Add train/test split and rolling walk-forward orchestration.
7. Add immutable experiment records and a Hypothesis Registry.
8. Add Champion–Challenger rules only after out-of-sample evidence exists.

## Research safety rules

- Do not describe a strategy as profitable from one in-sample run.
- Report every fee, spread, slippage, benchmark, and data assumption.
- Require cost-stress stability and out-of-sample evidence before Paper promotion.
- Keep AI committees, automatic strategy generation, and live trading out of scope until deterministic research controls are mature.
- Keep PR #1 Draft and do not merge without owner approval.
