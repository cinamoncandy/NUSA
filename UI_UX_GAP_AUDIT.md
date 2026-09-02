# NUSA UI/UX Gap Audit — 2026-09-02

## Objective
Close the remaining usability gaps between the current merged UI and a production-ready trading control room while preserving fail-closed safety boundaries.

## Product contract
- Primary loop: understand state → evaluate signal → place order → monitor position → manage risk → review outcome.
- Live/Paper mode must never be visually ambiguous.
- ZERO_AUTHORITY / production mutation boundaries must remain explicit where applicable.
- Every trading-critical view must expose loading, empty, stale, disconnected, rejected, and error states.
- Desktop and mobile must preserve the same operational hierarchy.

## Information architecture
1. Overview
2. Markets
3. AI Signal
4. Portfolio
5. Orders
6. Risk Center
7. Analytics
8. Settings

## P0 — trading-blocking UX gaps
- Persistent execution-mode indicator (PAPER/LIVE/NO AUTHORITY) visible in the global shell.
- Order ticket must expose side, type, quantity/notional, price controls, estimated value, validation, and explicit submission state.
- Orders view must distinguish pending/open/partial/filled/cancelled/rejected states.
- Portfolio must show exposure, unrealized/realized P&L, buying power/cash, position-level risk, and actionable position rows.
- Risk Center must surface limits, breaches, drawdown, concentration, and trading-disabled state without requiring deep navigation.
- Connection/data freshness must be visible when market/account/order data are stale or disconnected.

## P1 — decision-quality gaps
- AI Signal needs confidence, rationale, invalidation condition, time horizon, and freshness timestamp.
- Market rows/cards need consistent price, change, spread/liquidity proxy, signal state, and drill-in affordance.
- Overview needs a single hierarchy: account state → risk state → actionable signals → positions/orders → recent outcomes.
- Analytics needs benchmark/period controls and separation of realized performance from mark-to-market performance.

## P1 — state UX
Each trading-critical surface must cover:
- loading/skeleton
- empty
- stale
- disconnected
- degraded/partial data
- permission denied / authority unavailable
- rejected action
- success acknowledgement

## P1 — mobile
- Bottom-level access to Home, Markets/Signals, Portfolio, Orders, Risk.
- Primary trading actions reachable without horizontal scrolling.
- Order ticket uses a dedicated sheet/full-screen flow.
- Tables collapse to ranked cards with the same critical fields.

## P2 — design-system cleanup
- Normalize typography, spacing, radii, focus rings, disabled states, destructive actions, semantic status tokens.
- Use one canonical component for badge/chip, button, input, select, tabs, table, toast, dialog/sheet, progress/gauge.
- Remove one-off colors for trading status; route through semantic tokens.

## Definition of done
- No ambiguous PAPER/LIVE state.
- No trading action without validation and acknowledgement.
- No critical surface without loading/empty/error/stale handling.
- Core loop usable at desktop and mobile widths.
- Existing fail-closed safety model remains intact.
- Build, lint/typecheck, tests, and required CI workflows pass before merge.
