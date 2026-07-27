# Operational Candle Source Decision

`MarketDataSourceDecision` for WO-0034-A2R:

| Field | Decision |
| --- | --- |
| selectedSource | Upbit public minute candle REST, `1m` |
| rejectedSources | ticker aggregation (incomplete semantics); trade stream (not wired and therefore not proven complete); local timer-only close |
| sourceSemantics | official exchange minute candle response |
| completenessGuarantee | only the intervals returned by the official endpoint are accepted; missing intervals fail closed |
| timestampSource | `candle_date_time_utc`, parsed as UTC |
| duplicateIdentity | `KRW-BTC:1m:<openTime>` plus strictly increasing open times |
| volumeSemantics | `candle_acc_trade_volume` is the exchange candle's accumulated volume, not a sum of ticker updates |
| closeConfirmationMethod | `openTime + 60 seconds <= injected clock`; the endpoint response is the source watermark |
| reconnectBehavior | discard the open/in-progress bucket, reset warm-up, require explicit owner resume |
| knownLimitations | REST polling is not a tick-by-tick stream; source delay is reported as stale and no missing candle is synthesized |

Only `VALID`, closed, finite, invariant-preserving candles reach the strategy. A stopped session never force-closes an open candle. A current or incomplete candle is excluded, and a gap is an error rather than a synthetic flat candle.
