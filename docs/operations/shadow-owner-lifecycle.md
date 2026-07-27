# Shadow Owner Lifecycle (WO-0034-A2)

## States

```
IDLE -> PRECHECK -> READY -> RUNNING -> PAUSED -> COMPLETED
                      |         |
                      v         v
                   HALTED    HALTED (or FAILED, on event-log integrity failure)
```

- **IDLE** -- no session. The only state `shadow:start` may be called from.
- **PRECHECK** -- transient, internal only; never observed between calls.
- **READY** -- internal only (the underlying `ShadowPilotRuntime.precheck()` reaching
  `READY` immediately triggers `.start()`); not separately visible in `diagnostics()`.
- **RUNNING** -- dispatching real production BUY/SELL signals to `ShadowPilotRuntime
  .observe()` as hypothetical fills.
- **PAUSED** -- reached via explicit `shadow:pause`, or automatically when market data
  turns adverse while `RUNNING`. No new signal dispatch in either case. The underlying
  `ShadowPilotRuntime` session stays open and unaffected; only the wrapper's dispatch
  gate is closed.
- **COMPLETED** -- reached via `shadow:stop` from `RUNNING` or `PAUSED`.
- **HALTED** -- a hard precheck failure at start time, an exhausted WebSocket reconnect,
  or a HALT risk decision recorded during dispatch. Terminal for this instance; still
  stoppable via `shadow:stop` for a clean session close.
- **FAILED** -- the underlying `ShadowPilotRuntime` event-log hash chain failed
  independent verification after an `observe()` call. Should never happen in correct
  operation; present as a real, checked safeguard rather than dead code in the type
  union.
- **INVALIDATED** -- reserved for WO-0034-A3, once a Shadow session can be persisted
  across a restart. Nothing in this phase can reach it: without persistence, a restart
  simply constructs a fresh `IDLE` instance, so there is no prior session to invalidate.

## Owner commands

| Channel | Payload | Valid from | Effect |
| --- | --- | --- | --- |
| `shadow:start` | `{ symbol: "KRW-BTC", strategyId: "sma-crossover" }` | `IDLE` | Runs the full precheck; `RUNNING` on success, stays `IDLE` on a pure warm-up shortfall, `HALTED` on any other failure |
| `shadow:pause` | `{ sessionId }` | `RUNNING` | Immediately stops new dispatch; session stays open |
| `shadow:resume` | `{ sessionId }` | `PAUSED` | Re-runs the full precheck; `RUNNING` on success, stays `PAUSED` (with updated blockers) on failure |
| `shadow:stop` | `{ sessionId }` | `RUNNING`, `PAUSED`, or `HALTED` | Closes the session; `COMPLETED` (or stays `HALTED`) |
| `shadow:status` | `{}` or no payload | any | Read-only diagnostics snapshot |

Every command except `shadow:start`/`shadow:status` requires the caller's `sessionId` to
match `shadowRuntime.diagnostics().sessionId` exactly; a mismatch is rejected before the
runtime method is even called (`main.ts`'s `requireCurrentShadowSession`). A duplicate
`shadow:start` (called from any state but `IDLE`), a `shadow:resume` from any state but
`PAUSED`, and a `shadow:stop` from `IDLE`/`COMPLETED`/`FAILED` all throw -- fail-closed,
matching the existing `ShadowPilotRuntime`/`CanaryPilotRuntime` convention of throwing on
an invalid transition rather than silently no-oping.

`shadow:start`'s `symbol`/`strategyId` fields are validated against exact literal
constants (`KRW-BTC` / `sma-crossover`) in `shadowIpcValidation.ts` -- not because this
process could ever run a different symbol or strategy (it can't; both are hardcoded
elsewhere in `main.ts`), but so a malformed or unexpected payload is rejected at the
boundary rather than silently ignored.

## Owner identity

No credential or authentication model was introduced for this. Every `shadow:*` command
is documented as **a local explicit owner action** -- whoever can drive the Electron
renderer (a single-operator desktop app) is the owner. Building a real multi-party
approval or identity system was out of scope for this work order and would be a
substantially larger, separate change; nothing here should be read as a stand-in for one.

## Precheck (used identically by `start` and `resume`)

| Condition | Blocker |
| --- | --- |
| WebSocket not connected | `MARKET_DATA_DISCONNECTED` |
| Connected but not `HEALTHY` (and not merely warming up) | `MARKET_DATA_UNHEALTHY:<status>` |
| Fewer than 20 closed candles | `MARKET_DATA_WARMING_UP` |
| Kill switch active | `KILL_SWITCH_ACTIVE` |
| Open P0 alert | `OPEN_P0_ALERT` |
| Deployment integrity not established | `DEPLOYMENT_INTEGRITY_FAILED` |
| Reconciliation not established | `RECONCILIATION_REQUIRED` |
| Automatic Paper trading currently on | `AUTOMATIC_TRADING_ON` |
| Canary/Extended mode active | `CANARY_OR_EXTENDED_MODE_ACTIVE` |

All conditions are evaluated together; every blocker present is reported, not just the
first. The one exception is described above: warm-up alone (no other blocker) is a soft,
retryable outcome (`IDLE`, not `HALTED`).

## Diagnostics (`shadow:status`, read-only)

`state`, `sessionId`, `symbol`, `strategyId`, `marketDataStatus`, `closedCandleCount`,
`requiredWarmupCandles`, `warmupComplete`, `lastClosedCandleTime`, `lastSignalTime`,
`signalCount`, `hypotheticalOrderCount`, `hypotheticalFillCount`,
`actualBrokerCallCount` (always `0`), `actualOrderCount`, `actualFillCount`,
`cashMutationCount`, `positionMutationCount`, `blockers`, `automaticResumeAllowed`
(always `false`), `productionMutationAllowed` (always `false`).
