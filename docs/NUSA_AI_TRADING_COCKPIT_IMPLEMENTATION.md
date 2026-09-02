# NUSA AI Trading Cockpit Implementation Contract

## Purpose

This document translates `docs/NUSA_AI_TRADING_COCKPIT_DESIGN.md` into the canonical Electron renderer without changing trading behavior or creating a second runtime owner.

## File ownership

- `index.html` owns semantic view markup and keeps all canonical `data-simple-*` hooks.
- `app-runtime.js` remains the only runtime subscription, navigation, Paper-order, settings, portfolio, and chart behavior owner.
- `app-adapter.js` remains zero-authority and must not mirror runtime rendering.
- `app.css` remains the canonical baseline layout.
- `cockpit.css` is a presentation-only redesign layer loaded after `app.css`.
- `app-accessibility.js` keeps order-dialog focus containment.

## Route mapping

| Route | New presentation label | Existing runtime owner |
| --- | --- | --- |
| dashboard | Command Home | unchanged |
| orders | Markets + Order Station | unchanged |
| positions | Portfolio + Risk | unchanged |
| strategy | AI Decision / NUSA | unchanged |
| logs | Analytics + Activity | unchanged |
| settings | Settings + Authority | unchanged |

No new route or runtime subscription is required.

## Canonical data mapping

| Cockpit concept | Canonical selector | Truth source |
| --- | --- | --- |
| total equity | `data-simple-total-equity` / `data-simple-balance-total` | Paper snapshot |
| unrealized PnL | `data-simple-pnl` | Paper snapshot |
| realized PnL | `data-simple-realized-pnl` | Paper position snapshot |
| exposure / held value | `data-simple-held-value` | mobile view-model summary |
| cash | `data-simple-cash` | Paper snapshot |
| position count | `data-simple-position-count` | Paper snapshot summary |
| current price | `data-simple-market-price` | public ticker |
| market health | `data-simple-market-status` / `data-simple-connection` | runtime status |
| automation | `data-simple-auto-trade` | control snapshot |
| NUSA state | `data-simple-strategy-status` | control snapshot |
| latest runtime signal | `data-simple-last-signal` | control snapshot |
| freshness | `data-simple-updated` | snapshot render time |
| orders/activity | `data-simple-order-list` | Paper snapshot orders |
| operating events | `data-simple-log-list` | bounded local runtime timeline |

Selectors that are rendered through the runtime `text()` helper may appear in more than one semantic location. Selectors that are queried as a single mutable target remain unique.

## Layout contract

### Global shell

1. persistent desktop sidebar;
2. sticky command header;
3. global runtime status strip;
4. wide command canvas;
5. view-specific panels;
6. modal/right-sheet Paper confirmation on desktop;
7. bottom-sheet confirmation on mobile.

### Command Home

- 5-column metric rail: total equity, unrealized PnL, exposure, position count, market price;
- dominant equity canvas;
- NUSA decision/status panel;
- safety/operational strip;
- current positions table.

### Markets + Order Station

- compact market strip with price, change, connection, and PAPER mode;
- market/equity canvas beside NUSA state and Paper order station;
- recent Paper fills directly below.

### Portfolio + Risk

- equity, unrealized, realized, cash, and exposure metrics;
- equity curve + allocation;
- explicit risk-evidence boundary that displays only runtime-backed state and clearly marks unavailable advanced risk fields;
- holdings table.

### AI Decision / NUSA

- current runtime-backed NUSA state hero;
- market / automation / strategy evidence rows;
- advanced evidence availability note;
- Paper strategy controls;
- operating timeline.

### Analytics + Activity

- realized and unrealized outcome metrics;
- Paper fill stream;
- operating event stream;
- no benchmark or attribution values unless canonical contracts are added later.

### Settings + Authority

- theme, diagnostics, and notification presentation settings;
- current app mode/version/market state;
- explicit statement that the screen cannot grant execution authority.

## Responsive contract

### >= 1100px

Persistent sidebar and multi-column cockpit grid.

### 721-1099px

Compact sidebar, single-column primary panels, multi-column metric rails when space permits.

### <= 720px

- fixed five-destination bottom navigation;
- Settings remains a separate top action;
- global status strip becomes a compact grid;
- two-column metrics;
- secondary financial table columns are hidden;
- order confirmation becomes a bottom sheet;
- primary order buttons remain at least 52px tall.

### <= 420px

Single-column critical metrics where necessary and an additional secondary table field may be hidden.

## Safety contract

The redesign must retain all existing Paper order runtime gates. `cockpit.css` cannot enable a disabled control. Markup may make blocked states clearer but must not infer why beyond runtime-provided state.

The UI must continue to contain explicit Korean copy that:

- the mode is PAPER and live trading is disabled;
- Paper orders do not send real orders;
- strategy controls are Paper-only;
- Settings cannot change execution authority.

## Accessibility contract

- semantic headings retain logical order;
- navigation remains button-based and keyboard reachable;
- `aria-current` remains runtime-managed;
- connection and order feedback retain live regions;
- tables remain focusable regions;
- financial values allow wrapping instead of clipping;
- reduced motion is honored;
- order confirmation retains dialog semantics and focus containment.

## Test contract

Static UI tests should verify:

- exactly five primary routes plus separate Settings;
- `cockpit.css` loads after `app.css`;
- cockpit route labels and section markers exist;
- canonical safety copy remains present;
- advanced unavailable risk/AI evidence is explicitly described and not populated with fabricated numbers;
- CSS contains no literal palette values and uses semantic tokens;
- mobile breakpoints and touch targets remain present;
- no new LIVE or credential surface is introduced.

## Validation gate

Local validation is intentionally deferred because the OWNER said local work will be done later. Until these commands pass, the implementation branch must not open a PR:

```text
pnpm run preflight
pnpm run validate
pnpm run lint:desktop
pnpm run test:ui
pnpm run build
node --test tests/simple-paper-ui.test.js
git diff --check
```

No PASS is implied by repository edits alone.
