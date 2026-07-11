# Next Task

## Current Validated Research Baseline

The deterministic Backtest Engine now reports FIFO-matched closed trades, open-position status, performance metrics, equity analytics, and a cost-aware Buy & Hold comparison.

Latest validated head: `13c483665809ec21d8ca9e9b54ef5d5559a14d0d`

- Windows CI run #123
- `pnpm install --frozen-lockfile`: PASS
- `pnpm run typecheck`: PASS
- `pnpm test`: PASS (65/65)

Implemented research outputs:

- entry/exit time and price, quantity, fees, gross/net PnL, and holding duration per FIFO-matched trade;
- explicit `OPEN_POSITION` status for unclosed inventory, without forced liquidation;
- profit factor, expectancy, average win/loss, win/loss rate, payoff ratio, average holding time, exposure, and profit totals;
- maximum and longest drawdown, recovery factor, ulcer index, and CSV equity curve export;
- strategy return, cost-aware Buy & Hold return, and outperformance;
- deterministic modeled spread, slippage, and fee accounting.

## Immediate Research Work

1. Define a deterministic candle contract and missing-candle policy.
2. Add a versioned historical dataset manifest with source, market, interval, range, and checksum.
3. Add train/test split and rolling walk-forward orchestration.
4. Add Sharpe, Sortino, and Calmar only with an explicit sampling-period convention.
5. Add immutable experiment records and a Hypothesis Registry.
6. Keep PR #1 Draft and do not merge without owner approval.

## Research Safety Rules

- Do not call a strategy profitable or promotable from in-sample backtests alone.
- Report fees, spread, slippage, benchmark construction, and open-position status for every experiment.
- Require out-of-sample and walk-forward evidence before Paper promotion.
- Keep AI committees, automatic strategy generation, and all live trading out of scope.
