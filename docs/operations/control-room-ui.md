# Control Room UI

The desktop renderer opens with system state, not price. `apps/desktop/renderer/control-room.js`
mounts a panel above the price hero and the chart that answers, without scrolling: what mode
is this, may it place a real order, will it resume by itself, is the data trustworthy, and
what should the operator do next.

## Why state sits above price

The old first screen was a price hero and a 240-tick chart. That answers "what is the
market doing", which is the second question. The first is "is this system allowed to act
right now, and if not, why" — so the control room takes the top slot and the chart moves
down. `tests/control-room.test.js` asserts the ordering in `index.html` directly, so a
later layout change cannot quietly put the chart back on top.

## What it shows

Six status tiles (market data, warm-up, strategy, Risk Gateway, reconciliation, session),
a mode banner, a next-action line, and the Shadow session controls.

Two readings are deliberately blunt rather than flattering:

- **Risk Gateway reads `HALT` / `RISK_GATE_NOT_CONFIGURED`.** That is the truth today —
  `main.ts` injects a gate that halts every path until the WO-0032 composition exists. A
  panel that showed "정상" here would be describing a control that does not yet exist.
- **Reconciliation reads 확인 필요.** Same reason: no reconciliation source is wired, and
  `createPaperSafetySnapshot` already reports it that way.

## State is never carried by colour alone

Every badge is colour + glyph + text at once (`✔ 정상`, `▲ 예열 중`, `■ HALT`,
`✕ 실제 주문 불가`). The four mode rings differ in stroke style as well as hue — SHADOW and
CANARY solid in different weights, PAPER a thin line, EXTENDED dashed — so the mode is
legible without colour vision. `HALTED` is the one health state with no animation at all:
the absence of motion is itself the signal, and it stays distinguishable from
`EMERGENCY_STOP` (which pulses) under `prefers-reduced-motion`.

Blocker reason codes are translated into Korean sentences rather than shown raw, but an
unrecognised code still surfaces verbatim instead of disappearing.

## Shadow lifecycle controls

This closes the gap disclosed in WO-0034-A2 ("no renderer UI panel was added"). The panel
drives the `window.shadowPilot` bridge — start / pause / resume / stop / status — with
buttons enabled strictly by the state that permits them.

`resume` and `stop` require an explicit confirmation; `start` does not. Resume re-runs the
full precheck and stop ends a session that cannot be reopened, so both are state changes an
operator should have to mean. The destructive control differs from an ordinary button in
border weight as well as colour, not colour alone.

The four actual-mutation counters (order / fill / cash / position) are always visible and
styled so that **zero is the normal reading and any non-zero value is marked as a
violation** — the entire point of a Shadow session is that these stay at zero.

## Constraints this layer honours

- **No `innerHTML`, no inline `style` attribute, no CSSOM writes.** The app ships a strict
  `default-src 'self'; style-src 'self'` CSP and this layer needed no relaxation of it.
  Warm-up is a native `<progress>`, which needs no inline width and reports itself to
  assistive technology without extra ARIA.
- **No raw IPC channel names and no broker access.** The panel only calls fixed methods on
  the preload bridge. Tests assert both.
- **Degrades rather than throws.** A build whose preload does not expose `shadowPilot`
  renders the panel with every control disabled and says so, instead of erroring.

## Brand assets

`apps/desktop/renderer/assets/` holds the mark and the horizontal lockup used in the
header. `build/icon.png` is the packaged app icon — that is electron-builder's default
resource path, so the icon applies with no `package.json` change.

The flame silhouette carries a dark pupil so it reads as both a nusa fire and a
watching eye; the outer ring and top tick quote an instrument's zero mark. **The crack
motif is never used in the logo** — cracks are the reserved visual language of `HALTED` and
`EMERGENCY_STOP`, and mixing them into the everyday brand mark would blunt the danger
signal.

## Not built in this pass

The design system defines seven top-level sections (관제실 / 시장 / 전략 / 위험 / 실행 /
검증 / 기록). Only the 관제실 layer is implemented. The Why Panel, Decision Pipeline, risk
budget meters, promotion checklist, and incident timeline are specified in the design
document but are not yet in the renderer, and no navigation between sections exists — the
app is still a single scrolling page with the control room on top.
