# Funding Persistence Stress v1

## Purpose

This module stress-tests the pre-registered Funding Persistence mean-reversion candidate under deterministic PAPER/DRY_RUN research conditions. It does not promote a strategy, allocate capital, place an order, or enable LIVE trading.

## Stress families

- Baseline
- Fee and slippage multipliers
- Borrow-cost multipliers
- Decision latency measured in whole candles
- Missing-candle injection
- Permanent gap-up and gap-down shocks
- Volatility amplification around each candle open
- Capacity proxies through allocation and execution-cost multipliers

## Determinism

Every scenario is immutable. The same candles, decisions, baseline policy, scenario grid, generation time, and stress policy produce the same result and SHA-256 content hash.

## Fail-closed validation

The engine rejects invalid or duplicate scenario IDs, missing or multiple baselines, negative cost multipliers, invalid latency, invalid missing-candle intervals, invalid gap indices or destructive gap rates, non-positive volatility or allocation multipliers, excessive scenario counts, invalid timestamps, and invalid policy ranges.

The underlying backtest still validates chronology, market consistency, OHLC integrity, duplicate inputs, non-finite values, negative equity, and next-open execution semantics.

## Output

The summary contains one observation per scenario, total return, Sharpe, maximum drawdown, profit factor, closed trades, final equity, baseline degradation, positive-scenario ratio, acceptable-drawdown ratio, robustness score, fragility score, worst and median return, worst and median Sharpe, worst drawdown, grid-dependent break-even fee and slippage multipliers, explicit pass/fail reasons, and a deterministic content hash.

## Interpretation limits

Break-even values are bounded by the supplied grid. Capacity is a deterministic cost/allocation proxy rather than an exchange-specific impact simulator. Missing candles are removed without interpolation. Latency uses completed candle steps.

A passing stress report is necessary but not sufficient for Champion status. Walk-forward evidence, Paper Trading, governance review, risk review, and owner approval remain mandatory.
