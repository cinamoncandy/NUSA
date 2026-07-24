# Funding Rate Delta-Neutral Carry Engine v0.1

## Scope and safety boundary

This is a deterministic PAPER/DRY_RUN planning and monitoring layer. It does not contain a live adapter, private exchange API call, API credential, withdrawal path, or automatic deployment authority. A kill switch, an unhealthy runtime, ambiguous market metadata, stale funding, invalid fills, or insufficient deployable capital produce no new candidate or a fail-closed state.

Funding carry is not risk-free arbitrage. The strategy remains exposed to entry and exit fees, slippage, basis movement, partial fills, funding reversal, maintenance-margin pressure, liquidation risk, and liquidity loss. A positive modeled carry is not a guarantee of profit or an authorization for live trading.

## Modules

- `exchangeSymbolResolver.ts` creates one active spot/perpetual pair only from exchange metadata. It does not contain symbol aliases.
- `fundingCarryScanner.ts` calculates expected funding less separate spot and perpetual round-trip fees, slippage, basis, partial-fill, and capital-cost premiums. Candidates require favorable short-receives funding and a minimum net-carry margin.
- `atomicHedgeCoordinator.ts` is a PAPER/DRY_RUN state machine. Order acceptance is only `SUBMITTING`; only reconciled actual fills may become `HEDGED`.
- `deltaNeutralMonitor.ts` measures `spot base quantity - perpetual short base-equivalent quantity`, respecting multiplier, precision, and minimum size. Margin, liquidation-buffer, and basis problems escalate to emergency exit.
- `fundingCarryExitEngine.ts` creates bounded gradual exit plans or emergency plans. It reuses withdrawal protection and capital allocation guard before a new entry.
- `fundingCarryReadOnlyStatus.ts` defines an optional read-only contract for operational/mobile surfaces: annualized funding estimate, net carry, delta, hedge state, liquidation buffer, and next funding time.

## Hedge recovery

`PLANNED -> SUBMITTING -> PARTIALLY_HEDGED -> HEDGED` is based on filled quantities, average prices, and remaining quantities. When one leg is incomplete, recovery records cancellation, a bounded compensation attempt, then a reduction/rollback. An unresolved recovery becomes `FAULTED` and emits an immutable `KILL_SWITCH_RECOMMENDED` audit event. There is deliberately no direct exchange implementation here.

## Capital and control boundaries

New entries are allowed only in `PAPER` or `DRY_RUN`, after `protectWithdrawalCapital` and `guardCapitalAllocation` confirm the requested amount is within deployable capital. Reserved withdrawals remain excluded. A kill switch blocks scanners and entry safety checks; it is never overridden by this module. Read-only status has no control command or order method.

## Future review, not implementation

Any live activation would need separate owner approval, private-API credential controls, exchange-specific reconciliation, durable audit/recovery procedures, latency and partial-fill evidence, liquidation drills, and Paper evidence. None of these is implemented by v0.1.
