# Funding Persistence Backtest v1

## Purpose

Deterministic PAPER/DRY_RUN research engine for the pre-registered Funding Persistence mean-reversion candidate.

## Execution semantics

- A strategy decision may execute only on a candle whose `openTime` is strictly later than the decision `generatedAt`.
- Same-open execution is prohibited.
- Entry, exit, reversal, and forced end-of-window close are recorded as immutable fills.
- LONG, SHORT, and FLAT are the only supported positions.
- No leverage, private exchange API, credential, withdrawal, or LIVE order path exists.

## Cost model

The engine applies:

- taker fee on entry and exit notional;
- directional slippage on every execution;
- funding cash flow once per candle while exposed;
- optional short borrow cost once per candle.

The result separately reports gross PnL, fees, funding PnL, borrow cost, and net PnL.

## Validation and fail-closed rules

The run rejects:

- duplicate candle IDs;
- duplicate decision IDs;
- mixed markets;
- invalid timestamps;
- overlapping or reversed candles;
- invalid OHLC bounds;
- non-finite values;
- negative equity;
- invalid policy values.

## Outputs

- immutable fill ledger;
- immutable closed-trade ledger;
- equity curve;
- drawdown series;
- deterministic audit strings;
- total return, CAGR, annualized volatility, Sharpe, Sortino, Calmar, maximum drawdown, win rate, profit factor, expectancy, recovery factor, turnover, exposure, and closed-trade count.

## Research limitations

This engine does not establish profitability. Results depend on dataset quality, sampling convention, funding timestamp semantics, modeled costs, and the pre-registered strategy rules. Promotion still requires walk-forward validation, stress testing, Paper Trading, governance review, and owner approval.
