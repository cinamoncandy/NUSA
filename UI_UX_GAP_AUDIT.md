# NUSA UI/UX Gap Audit — 2026-09-02

## Objective
Close the remaining presentation-layer usability gaps in the canonical Paper Trading renderer without inventing operational truth or changing runtime, execution, risk, credential, or authority semantics.

## Primary operating loop
Understand state → evaluate evidence → place PAPER order → monitor position → review outcome.

## Closed by this work order
- Strengthened global PAPER execution-boundary presentation using existing canonical state.
- Strengthened account, decision, position, order, and panel information hierarchy without changing data ownership.
- Increased primary order-action touch targets and improved confirmation-sheet presentation.
- Improved narrow-screen dashboard and positions tables so essential fields remain readable without mandatory horizontal panning.
- Added sticky table headers, calmer row affordances, reduced-motion handling, and token-driven semantic presentation.
- Added a canonical trading UX contract to the existing design-system documentation.

## Covered elsewhere — not duplicated here
PR #1473 owns connection truth, stale-data detection, runtime freshness behavior, and PAPER order blocking when operational truth is stale or unavailable. This work order deliberately does not duplicate that runtime ownership.

## Deferred until canonical data/runtime contracts exist
The presentation layer must not fabricate fields merely to satisfy a mockup. The following remain product/runtime work only when canonical truth is available:
- richer market spread/liquidity fields;
- AI signal confidence, rationale, invalidation, and horizon;
- expanded risk limits, breaches, drawdown, and concentration surfaces;
- analytics benchmark controls and realized-vs-mark-to-market separation;
- additional order lifecycle states not currently exposed by the canonical runtime.

## Safety boundary
- Mode remains PAPER_ONLY.
- LIVE authority remains NONE.
- Production mutation remains disabled.
- AI remains ZERO_AUTHORITY.
- No renderer presentation code may infer or synthesize execution, risk, signal, PnL, or freshness truth.

## Definition of done for this work order
- Existing runtime and authority ownership remains unchanged.
- PAPER execution context remains explicit on trading-critical surfaces.
- Primary portfolio information remains usable at desktop and narrow widths.
- Order confirmation remains explicit and touch-safe.
- Existing design-system content is preserved and extended rather than replaced.
- Required repository validation passes on the exact branch head before PR creation.
