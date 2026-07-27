# Shadow Operational Runtime

## Separation

`MarketDataRuntime` warms up independently of owner control. It starts in `WARMING_UP`, accepts only valid closed 1-minute candles, and becomes healthy after 20 valid candles. `ShadowExecutionRuntime` stays `IDLE` until the local owner explicitly starts it, then moves through `READY` and `RUNNING`.

The orchestrator is `ShadowOperationalRuntime`. `main.ts` composes the source, strategy, risk evaluator, event sink, and IPC handlers; it does not implement the candle or lifecycle state machine.

## Risk and mutation boundary

Strategy signals use the common `RuntimeCommandService.evaluateSignalRisk` entry point. The runtime never calls `PaperBroker`, never creates real orders or fills, and never mutates cash or positions. An `ALLOW` result is sent only to a non-mutating hypothetical execution adapter. `REJECT` and `HALT` stop that hypothetical path. The application remains paper-only and fail-closed.

The risk gateway is currently fail-closed when the normal risk context is unavailable. A positive signal is not permission and does not create authority.

## Events

A2 emits ordered, bounded in-memory domain events. The sink is injected, so A3 can attach a durable Evidence sink without coupling the runtime to storage. A2 deliberately produces no durable operational Evidence and no claim of live operational proof.

## Fingerprint

The strategy identity is `sma-crossover:closed-candle-1m-v1`, with SMA 5/20 unchanged. Its input contract includes `CLOSED_CANDLE`, `1m`, `UPBIT_PUBLIC_CANDLE`, and the strategy windows; this produces a fingerprint distinct from the legacy ticker-sample strategy.
