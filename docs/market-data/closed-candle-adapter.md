# Closed Candle Adapter

WO-0034-A1 adds a pure aggregation boundary for Upbit **public** ticker messages. It
does not open a socket, invoke Electron, run a strategy, write operational evidence, or
call PaperBroker.

Ticker timestamps determine 1-minute UTC epoch buckets. The first ticker supplies open,
later accepted tickers update high, low, close, and trade count, and only a ticker in the
next bucket emits the prior closed candle. The adapter never force-closes a current
candle with a wall-clock timer.

Missing `trade_volume` is explicit: `volumeAvailable` is false and closed candle volume
is zero rather than guessed. Duplicate, symbol-mismatched, non-finite, and out-of-order
tickers do not mutate an open or closed candle. A gap emits the prior real candle once,
reports `GAP_DETECTED`, and never fabricates a zero-volume candle.

`markDisconnected`, `markReconnected`, `resetWarmup`, and `inspectState` are pure
lifecycle hooks. Warm-up requires 20 **closed** candles by default.

WO-0034-A2 (`apps/desktop/src/shadowOperationalRuntime.ts`) is the runtime wiring: it
owns a `ClosedCandleAdapter` instance, feeds it every accepted public ticker, and is now
the only caller of `StrategyEngine.onTick` in the codebase -- called once per closed
candle, never per raw ticker. See `docs/operations/shadow-operational-runtime.md`. This
file (`closedCandleAdapter.ts`) itself remains unmodified by that work.
