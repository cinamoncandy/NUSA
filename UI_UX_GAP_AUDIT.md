# NUSA UI/UX Gap Audit — 2026-09-02

## Objective
Close remaining usability gaps between the current merged UI and a production-ready trading control room while preserving fail-closed safety boundaries.

## Primary operating loop
Understand state → evaluate signal → place order → monitor position → manage risk → review outcome.

## P0
- Persistent execution-mode indicator: PAPER / LIVE / NO AUTHORITY.
- Complete order-ticket validation and submission feedback.
- Distinct order lifecycle states: pending/open/partial/filled/cancelled/rejected.
- Portfolio exposure, realized/unrealized P&L, buying power/cash, position risk.
- Risk Center limits, breaches, drawdown, concentration, trading-disabled state.
- Connection/data freshness visible for market/account/order data.

## P1
- AI Signal confidence, rationale, invalidation, horizon, freshness.
- Consistent market price/change/liquidity/signal/drill-in fields.
- Overview hierarchy: account → risk → actionable signals → positions/orders → outcomes.
- Analytics benchmark/period controls with realized vs mark-to-market separation.
- Critical state handling: loading, empty, stale, disconnected, degraded, denied, rejected, success.

## Mobile
- Home, Markets/Signals, Portfolio, Orders, Risk directly reachable.
- Primary actions without horizontal scrolling.
- Order ticket in dedicated sheet/full-screen flow.
- Desktop tables collapse to ranked cards retaining critical fields.

## Definition of done
- No ambiguous execution mode.
- No trading action without validation and acknowledgement.
- No critical surface without loading/empty/error/stale handling.
- Core loop usable at desktop and mobile widths.
- Fail-closed model remains intact.
- Build, lint/typecheck, tests, and required CI pass before merge.
