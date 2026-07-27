# WO-0034 Integration Matrix

The canonical implementation is the latest Electron runtime at `179bd41`. The A2R
commit was reviewed as a source of safety requirements, not cherry-picked as a second
runtime.

| 기능 | Electron | A2R | 차이 | 채택안 | 이유 |
| --- | --- | --- | --- | --- | --- |
| Market data semantics | ticker adapter | official minute candle source | ticker does not prove complete trades | A2R source | official closed candles are safer |
| Operational candle source | ticker aggregation | Upbit public 1m REST | different source | A2R source | no ticker volume/trade-count assumption |
| Closed-candle validation | valid closed adapter output | OHLCV, close watermark, gap rejection | A2R has stronger source validation | combine | preserve Electron adapter boundary and A2R checks |
| Strategy identity | legacy SMA fingerprint | closed-candle version | version missing in Electron | A2R identity fields | input contract must be explicit |
| Warm-up lifecycle | adapter warm-up | independent source warm-up | same owner separation intent | Electron runtime + A2R source | one state machine only |
| Owner lifecycle | ShadowPilot-backed | standalone state machine | duplicate state machines | Electron | already integrated with audit events |
| Risk Gateway | shared `PaperCommandRiskGate` | injected evaluator | equivalent safety intent | Electron | existing Paper path and Shadow path share gate |
| Shadow mutation | ShadowPilot counters are zero | hypothetical adapter counters are zero | equivalent | Electron | existing hash-chained pilot is stronger |
| Reconnect | adapter invalidates ticker candle | resets warm-up and requires resume | different implementation | Electron state + A2R policy | no second runtime |
| Restart | fresh runtime/session | fresh runtime/session | equivalent | Electron | existing composition already creates fresh runtime |
| Domain events | hash-chained ShadowPilot events | in-memory ordered events | different schemas | Electron events | existing pilot verification is established |
| IPC allowlist | exact symbol/strategy validation | exact version-aware payload | Electron lacked version | A2R version check | reject mismatched strategy input |
| Diagnostics | safety, counters, blockers | richer source metadata | different fields | Electron plus version/source fields | preserve existing dashboard contract |
| Tests | existing A1/A2 runtime tests | source and lifecycle tests | complementary | combine focused tests | prove one path and source safety |
| Docs | existing operational docs | source semantics docs | complementary | combine | document canonical source and boundaries |

## Result

There is exactly one production `ShadowOperationalRuntime`, one `StrategyEngine` dispatch
site, one shared risk gate, and one ShadowPilot execution ledger. The legacy ticker adapter
is retained for compatibility and tests but is not used by the production Shadow path;
official 1-minute candles are polled and passed to the existing runtime once per candle.

No PaperBroker, live order, private API, credential, or durable Evidence writer was added.
