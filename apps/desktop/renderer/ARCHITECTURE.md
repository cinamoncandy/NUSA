# NUSA Desktop Renderer — Canonical Architecture

## Active entry

`index.html` is the only active Electron renderer entry. It loads only:

1. `tokens.css` — semantic visual tokens
2. `components.css` — shared presentation primitives
3. `app.css` — canonical product layout, behavior-safe baseline, and responsive composition
4. `cockpit.css` — presentation-only AI Trading Cockpit hierarchy and responsive overrides
5. `mobile-view-model.js` — shared formatting/snapshot summarization contract
6. `app-runtime.js` — navigation, runtime subscriptions, Paper order flow, settings, portfolio and NUSA state rendering
7. `app-adapter.js` — reserved zero-authority extension seam; it must not subscribe to runtime data or duplicate product rendering
8. `app-accessibility.js` — dialog keyboard/focus containment

## Views

The framework-neutral renderer intentionally keeps view markup as semantic sections in `index.html` rather than generating it from JavaScript. The canonical route boundaries remain stable while the product presentation is organized as an AI-native trading cockpit:

- `dashboard` — Command Home / account outcome, exposure, health, NUSA state
- `orders` — Markets + Order Station / market context and explicit Paper action
- `positions` — Portfolio + Risk / holdings, PnL, composition, available risk evidence
- `strategy` — AI Decision / NUSA runtime-backed state and Paper strategy controls
- `logs` — Analytics + Activity / outcome summary and chronological events
- `settings` — Settings + Authority / display, diagnostics, Paper-only boundary

This avoids multiple mount systems and keeps the DOM inspectable, deterministic and accessible. View behavior belongs in `app-runtime.js`; reusable visual primitives belong in `components.css`; cockpit presentation belongs in `cockpit.css`.

## Presentation-layer invariant

`cockpit.css` may change composition, density, spacing, responsive visibility, and visual hierarchy. It may not:

- subscribe to runtime data;
- add or infer trading authority;
- enable disabled controls;
- synthesize investment, risk, AI, execution, account, or freshness values;
- replace canonical `data-simple-*` ownership;
- create a second navigation or rendering runtime.

Semantic markup may repeat selectors rendered through `app-runtime.js`'s multi-target `text()` helper. Single mutable targets such as order inputs, allocation containers, and position tables remain unique.

## Runtime invariants

- PAPER is explicit and persistent.
- No renderer code may infer or activate REAL/LIVE authority.
- Disconnected, stale/error, missing-price and invalid-quantity states fail closed for Paper order controls.
- Runtime subscriptions have one owner (`app-runtime.js`).
- Chart retention is bounded to 120 points; local timeline retention is bounded to 40 events.
- Ticker updates must not trigger a full snapshot rerender.
- Event listeners and subscription disposers are released on renderer teardown.
- Settings may change presentation/diagnostics only; they cannot change execution authority.

## Responsive/accessibility invariants

- Touch targets are at least 44px; primary mobile Paper order targets are at least 52px in the cockpit layer.
- Mobile primary navigation remains five destinations; Settings stays separate.
- Financial tables remain keyboard-focusable horizontal regions even when secondary columns are hidden on narrow screens.
- Focus remains visible.
- Paper order confirmation is a modal dialog with focus containment and focus restoration; presentation becomes a bottom sheet on mobile.
- Reduced-motion preferences are respected.
- Critical state is never communicated by color alone.
- Unavailable data is never styled or worded as zero, safe, healthy, or complete.

## Historical renderer files

Historical `brand-ui`, `workspace`, `control-room`, `product-screens`, `application-state`, and `command-palette` files may remain in the repository for isolated previews, diagnostics or tests, but `index.html` must never load them. Their presence does not confer product-surface ownership.

Migration-only `simple-ui.*`, `v2.*`, and `index-v2.html` are retired and must not return.
