# NUSA Command Center v1

## Scope

Desktop UI/UX and visual-design work only. No trading, execution, AI authority, safety gate, broker, or runtime behavior changes.

## Evidence from current main

- `apps/desktop/renderer/index.html` is the active desktop shell and mounts `simple-ui-root` with five primary routes: dashboard, market, orders, positions, and more/settings-adjacent views.
- The desktop shell already exposes Paper-only language in several places, including `Paper Trading`, `PAPER · 실거래 비활성`, `실거래 주문 없음`, and the public-data disclosure on Markets.
- The active renderer has a dedicated `simple-ui.css` presentation layer while the repository also has `tokens.css`, `components.css`, `brand-ui.css`, `control-room.css`, and `workspace.css`. This is a real design-system layering problem: the active simple surface owns a second visual token set instead of consuming the canonical semantic tokens.
- `simple-ui.css` currently defines its own light-surface palette (`#f4f7fb`, white cards, blue primary), while the canonical renderer token layer is dark-first and also contains explicit control-room brand/status tokens. This makes the active desktop UI visually inconsistent with the rest of NUSA's design language.
- The current dashboard puts health, quick action, four account metrics, chart/composition, positions, and recent orders into separate cards. The information is useful, but the hierarchy is card-first rather than state/risk-first, so the user must scan several surfaces before knowing what requires attention.
- The current Markets view uses a disabled search input and a static `KRW-BTC` row. Disabled controls communicate non-interactivity rather than an intentional observation state.
- The current Orders view presents buy/sell actions beside a Paper disclosure, but the authority state is expressed mainly as copy and a badge. The redesign therefore keeps the disclosure persistent and visually independent from action affordances.

## Design decision

The first high-value UX unit is a **Command Center hierarchy** rather than another cosmetic restyle:

1. **State first**: persistent mode + connectivity + LIVE boundary.
2. **Risk second**: position/risk status and attention state before raw account numbers.
3. **Numbers third**: equity, PnL, exposure, order count in a compact metric rail.
4. **Action fourth**: Paper actions remain available only within an unmistakable Paper context.
5. **Evidence last in the local scan**: recent activity and market observations provide context without competing with state/risk.

## Prototype behavior

`nusa-command-center-v1.html` is a standalone responsive visual prototype of this hierarchy. It deliberately uses representative data and does not claim to be a live runtime screen.

The prototype demonstrates:

- persistent PAPER / LIVE DISABLED separation;
- compact system health strip;
- risk-aware position table;
- market observation list;
- Paper order ticket with persistent safety disclosure;
- desktop, tablet, and mobile layouts;
- keyboard-visible focus states;
- reduced-motion handling;
- dense tabular numerals for trading data.

## Next implementation unit

Port the hierarchy into the existing desktop `simple-ui` runtime **without replacing its data contracts**. The implementation should consume existing canonical tokens, preserve current routes and `data-*` hooks, and add regression coverage for:

- mode boundary visibility;
- state → risk → numbers → action ordering;
- no enabled-looking LIVE affordance while LIVE is disabled;
- keyboard focus and minimum touch/click targets;
- mobile stacking and horizontal-table escape hatch;
- truthful empty/loading/error states.

This prototype is intentionally separated from the runtime so the visual decision can be reviewed without changing product behavior.
