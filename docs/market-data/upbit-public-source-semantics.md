# Upbit Public Source Semantics

## A2R decision

The websocket wrapper subscribes to `ticker`. A ticker update is a current market snapshot: `trade_price` is the current/latest price, `trade_volume` is the volume of the most recent trade, and `acc_trade_volume` is cumulative volume. A ticker update is not a complete trade ledger, so update count is not `tradeCount` and ticker volume is never summed as individual fills. Daily `opening_price`, `high_price`, and `low_price` are daily statistics, not one-minute OHLC values.

The official Upbit trade stream exposes individual trades and `sequential_id`, but the existing wrapper does not subscribe to or validate that stream. It is therefore not selected for this work.

Sources:

- [Upbit ticker websocket](https://docs.upbit.com/kr/reference/websocket-ticker)
- [Upbit trade websocket](https://docs.upbit.com/kr/reference/websocket-trade)
- [Upbit minute candles](https://docs.upbit.com/kr/reference/list-candles-minutes)

## Operational consequence

The A1 ticker adapter remains available for tests and diagnostics. It is excluded from the operational strategy path. No ticker-derived candle is labelled as an exchange candle.
