# Simple Paper Trading UI

This UI is a presentation-only desktop shell for NUSA Paper Trading. It reuses the existing
preload bridge and renderer projections; it does not add an exchange adapter, a live-order path,
or a credential surface.

## Screens

- **대시보드**: health, public market connection, Paper account summary, asset trend, composition,
  positions, recent orders, and the next safe action.
- **마켓**: KRW-BTC price, change, and public-data freshness.
- **주문**: Paper-only order form with a visible mode and explicit confirmation sheet before the
  existing Paper IPC command.
- **포지션**: current quantity, average price, market value, and PnL.
- **잔고**: Paper KRW and held-asset values.
- **전략**: strategy state and the existing start/stop commands; no risk bypass is introduced.
- **로그**: understandable operational events without credentials or raw private payloads.
- **설정**: display preferences and connection capability status. Credentials are never shown.

## Safety behavior

The header and sidebar always show `PAPER` / `실거래 비활성`. Paper order buttons require both a
connected market state and a valid public ticker. A disconnected or unknown state disables the
buttons. The renderer only calls fixed methods exposed by the existing preload bridge.

## Responsive desktop targets

The same renderer and view-model are used at every width. Below 768px the five-tab bottom
navigation and stacked cards are used; 768px through 1023px keeps touch navigation and cards;
1024px and above progressively enhances to the desktop rail and tables.

## Verification

The focused renderer contract is covered by `tests/simple-paper-ui.test.js`. The final PR report
records the exact repository checks that were actually run, plus any GUI or E2E limitation. No
visual or E2E result is considered PASS unless it was executed against the current commit.
