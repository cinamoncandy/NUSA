# Trading Validation Pipeline

Dokkaebi treats simulated trading as a software-validation stage, not as proof of profitability.

## Validation stages

1. **Deterministic replay**
   - Replay recorded market events with fixed clocks and random seeds.
   - Verify strategy, risk, accounting, and recovery invariants.
   - Reject look-ahead bias and duplicated/missing events.

2. **Execution-aware backtest**
   - Use bid/ask or order-book data rather than candle-close fills.
   - Model maker/taker fees, spread, latency, slippage, minimum notional, tick size, partial fills, queue uncertainty, rejected orders, and stale data.
   - Results are estimates, never a profitability certificate.

3. **Shadow mode**
   - Run against the live production market-data stream.
   - Generate proposals and intended orders without submitting them.
   - Record decision time, intended submission time, observed book, expected fill, and counterfactual PnL.
   - Exercise reconnect, rate-limit, clock-skew, stale-feed, and recovery paths.

4. **Exchange testnet / paper adapter**
   - Validate authentication, signing, serialization, order lifecycle handling, cancellation, user-data streams, reconciliation, idempotency, and operational controls.
   - Do not use simulated fills as evidence that the strategy has an executable edge.

5. **Micro-live canary**
   - Use the smallest practical real order size and a strict loss budget.
   - Measure real spread, slippage, queue position, partial fills, latency, rejection rate, and exchange behavior.
   - No automatic scale-up.

6. **Controlled scale-up**
   - Require sufficient sample size and stable live execution metrics.
   - Increase risk only by an explicit approval step.
   - Automatically roll back to shadow mode when safety or execution thresholds fail.

## Scanner architecture

The universe scanner uses a two-stage pipeline:

- **Stage 1: broad ranking** — fetch the cheapest market-wide ticker data and rank the full eligible universe.
- **Stage 2: deep analysis** — run expensive indicators/order-book analysis only for the top-ranked symbols.

Shared signal calculations are cached by `(symbol, timeframe, market-data-version, strategy-version)` with a short TTL. The cache is an optimization only; replay correctness must not depend on wall-clock cache expiry.

## API budget and scheduling

All exchange calls pass through a central request-budget scheduler that tracks endpoint weights, concurrency, retry/backoff, and temporary bans. Market-data freshness takes priority over non-critical historical refreshes.

## Portfolio heat

Risk evaluation must include correlated exposure, not only per-position limits. At minimum, calculate:

- gross and net exposure;
- common quote-asset exposure;
- BTC/market beta concentration;
- highly correlated long/short clusters;
- liquidity-adjusted liquidation cost;
- total open-order risk.

## Release rule

Passing replay, backtest, shadow, or paper trading never authorizes live capital by itself. Live enablement requires explicit approval and starts in micro-live canary mode.
