# NUSA Desktop Renderer — Canonical Architecture

## Active entry

`index.html` is the only active Electron renderer entry. It loads only:

1. `tokens.css` — semantic visual tokens
2. `components.css` — shared presentation primitives
3. `app.css` — product layout and responsive composition
4. `mobile-view-model.js` — shared formatting/snapshot summarization contract
5. `app-runtime.js` — navigation, runtime subscriptions, Paper order flow, settings, portfolio and NUSA state rendering
6. `app-adapter.js` — reserved zero-authority extension seam; it must not subscribe to runtime data or duplicate product rendering
7. `app-accessibility.js` — dialog keyboard/focus containment

## Views

The framework-neutral renderer intentionally keeps view markup as semantic sections in `index.html` rather than generating it from JavaScript. Each section is a single view boundary:

- `dashboard` — Home / outcome summary
- `orders` — Trading / Paper action
- `positions` — Portfolio / holdings and PnL
- `strategy` — NUSA runtime state and Paper strategy controls
- `logs` — History / operational timeline
- `settings` — display and diagnostics only

This avoids multiple mount systems and keeps the DOM inspectable, deterministic and accessible. View behavior belongs in `app-runtime.js`; reusable visual primitives belong in `components.css`.

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

- Touch targets are at least 44px.
- Mobile primary navigation remains five destinations; Settings stays separate.
- Financial tables are keyboard-focusable horizontal regions.
- Focus remains visible.
- Paper order confirmation is a modal dialog with focus containment and focus restoration.
- Reduced-motion preferences are respected.
- Critical state is never communicated by color alone.

## Historical renderer files

Historical `brand-ui`, `workspace`, `control-room`, `product-screens`, `application-state`, and `command-palette` files may remain in the repository for isolated previews, diagnostics or tests, but `index.html` must never load them. Their presence does not confer product-surface ownership.

Migration-only `simple-ui.*`, `v2.*`, and `index-v2.html` are retired and must not return.
