# Shadow Operational Runtime (WO-0034-A2)

## Purpose

Wires the actual public Upbit ticker stream through to the production strategy and, in
parallel, to the Shadow pilot -- so a Shadow session observes real production signals
instead of a synthetic dry run. It is the first phase where any of this is connected to
a live data source; nothing here places a real order, and nothing here creates operational
Evidence (that is WO-0034-A3).

## Composition

```
Upbit Public WebSocket -> ClosedCandleAdapter -> Market Data Health Gate -> StrategyEngine -> ShadowPilotRuntime
```

`apps/desktop/src/shadowOperationalRuntime.ts` owns every step from the second arrow
onward. `main.ts`'s `handleTicker` no longer calls `strategy.onTick` at all -- it forwards
the raw ticker to `shadowRuntime.onTicker(ticker)`, and `StrategyEngine.onTick` is now
called from exactly one place in the whole codebase: once per **closed** candle, inside
`ShadowOperationalRuntime.onClosedCandle`. There is no remaining path that feeds an
in-progress ticker into the strategy.

The same production signal drives two independent, clearly separated consumers on every
closed candle:

- **Real Automatic Paper trading** -- `onProductionSignal` fires unconditionally (even for
  `HOLD`), exactly as the old per-ticker call did, driving `RuntimeCommandService
  .automaticSignal` and the existing dashboard/persistence side effects. Only the trigger
  cadence changed, from once per ticker to once per closed minute.
- **Shadow** -- only when the wrapper's own lifecycle is `RUNNING` and the signal is not
  `HOLD`, the signal is separately dispatched into `ShadowPilotRuntime.observe(...)`.
  `ShadowPilotRuntime` and `ClosedCandleAdapter` themselves are unmodified by this work --
  WO-0034-A1's adapter and the existing Shadow pilot contract are reused exactly as
  published.

`ShadowOperationalRuntime` never imports `PaperBroker` at runtime (only
`RuntimeCommandService`'s `PaperCommandRiskGate` **type**, erased at compile time) --
verified structurally by a test that greps the compiled output for both module names.

## The risk decision Shadow uses is the real one

Shadow's hypothetical dispatch calls the **same `PaperCommandRiskGate` instance**
`RuntimeCommandService` uses for real Manual and Automatic orders (`path: "SHADOW"` was
added to the gate's path union). This was a deliberate choice over fabricating a
separate always-`ALLOW` decision for Shadow: since WO-0032's gate composition
(approval/reconciliation/deployment state) is not wired into the real order path yet, the
injected gate in `main.ts` currently returns `HALT` unconditionally with
`RISK_GATE_NOT_CONFIGURED` -- and Shadow inherits that exact same honest, unconfigured
state rather than pretending its own hypothetical path is somehow more ready than the
real one.

Shadow tracks no hypothetical position, cash, or PnL. Its hypothetical order quantity
reuses the real configured Paper order quantity (`control.getOrderQuantity()`) for both
BUY and SELL alike -- a disclosed simplification, not a sizing policy.

## Lifecycle

`IDLE -> PRECHECK -> READY -> RUNNING -> PAUSED -> COMPLETED`, with `HALTED`, `FAILED`,
and `INVALIDATED` as failure states. See `docs/operations/shadow-owner-lifecycle.md` for
the full state machine, precheck conditions, and IPC contract.

## Market data health

`ShadowOperationalRuntime` maps the real `UpbitWebSocketClient` connection status and
`ClosedCandleAdapter` per-tick health events into nine states: `CONNECTING`,
`WARMING_UP`, `HEALTHY`, `STALE`, `RECONNECTING`, `GAP_DETECTED`, `OUT_OF_ORDER`,
`CLOCK_DRIFT`, `DISCONNECTED`. `CLOCK_DRIFT` is a real check this module adds: a ticker
whose declared timestamp differs from wall-clock by more than 60 seconds (configurable)
is flagged, since neither `UpbitWebSocketClient` nor `ClosedCandleAdapter` checks this
today.

Any adverse condition while `RUNNING` auto-pauses the session (never auto-halts, except
an exhausted reconnect, which is treated as terminal since the client itself has given
up retrying). Recovery is never automatic: only an explicit `shadow:resume` re-runs the
full precheck and can return to `RUNNING`. A gap or out-of-order tick this round also
means any candle emitted in that same round is not dispatched to the strategy at all --
"gap detected 이후 strategy execution 금지" is enforced at the ingestion boundary, not
left to be caught downstream.

The adapter defaults to `connected: true` at construction (a WO-0034-A1 property, left
unmodified); `ShadowOperationalRuntime`'s constructor immediately calls
`markDisconnected()` to correct for the fact that the real stream has not connected yet,
rather than reporting a false `HEALTHY` before the socket ever opens.

## Warm-up softening: a documented reading of the spec

A pure warm-up shortfall (fewer than 20 closed candles, nothing else wrong) leaves the
lifecycle at `IDLE` rather than `HALTED`, so the owner can retry `shadow:start` later
without burning a session on an ordinary elapsed-time condition. Every other precheck
failure (kill switch, P0, deployment integrity, reconciliation, automatic trading on,
disconnected stream, Canary/Extended mode active) is `HALTED` and terminal for that
`ShadowOperationalRuntime` instance -- there is no un-halt path, matching the existing
`CanaryPilotRuntime` convention of no recovery from `HALTED` short of a fresh instance.

## Restart

No durable Shadow session persistence exists yet (WO-0034-A3). Every process start
constructs a brand-new `ShadowOperationalRuntime` at `IDLE`, with a brand-new
`ClosedCandleAdapter` (warm-up count `0`). This is what makes "no auto-run after
restart" and "warm-up resets on restart" true by construction, not by a separate
recovered-session check: there is nothing to recover, so there is nothing to
auto-continue.

## What this phase deliberately does not do

- No durable `SHADOW_OPERATIONAL` Evidence writer (WO-0034-A3).
- No Canary wiring; `canaryPilotRuntime.ts` is untouched and unused here.
- No owner-identity/authentication model. Every `shadow:*` IPC command is documented as
  "a local explicit owner action" (see `docs/operations/shadow-owner-lifecycle.md`) --
  building a credential or auth system was explicitly out of scope and would have been a
  much larger, unrelated change.
- No renderer UI panel. `preload.ts` exposes a `window.shadowPilot` bridge with five
  fixed method names (`start/pause/resume/stop/status`), fully IPC-tested, but no button
  was added to `apps/desktop/renderer`. This is a disclosed gap, not an oversight.
- No hypothetical cash/position/PnL accounting for Shadow -- only hypothetical order/fill
  *counts*, matching `ShadowPilotRuntime`'s existing counters exactly.

## Known limitations

- Shadow's real signal generation depends on the production `StrategyEngine`'s own
  `running` flag, which is the same flag the existing `control:start` command sets for
  real Automatic Paper trading. If the owner has never started the strategy, Shadow
  observes only `HOLD`/"strategy-stopped" signals and dispatches nothing -- this is
  correct behavior (Shadow observes the *real* production signal, warts and all), not a
  Shadow-specific precondition.
- `getSafetyState()`'s `deploymentIntegrity` and `reconciliation` fields are wired to the
  same honestly-unresolved values `createPaperSafetySnapshot` already uses (`false` for
  both, since neither has a real PASS source yet). Shadow therefore currently cannot
  reach `RUNNING` in the actual running application -- it is fully wired, but the
  broader system it depends on is not yet composed. See `docs/NEXT_TASK.md`.
- `currentModeIsCanaryOrExtended` is always `false`: no Canary/Extended runtime mode is
  wired into this process at all yet, so the check is real but currently vacuous.
