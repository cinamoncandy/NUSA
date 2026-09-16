# UIUX P1 — AI Primary Mobile Navigation Contract

Date: 2026-09-10
Owner: NUSA UI/UX
Priority: P1
Scope: Mobile navigation only
Safety boundary: PAPER-only authority; no order execution, LIVE authority, risk-engine, or mutation behavior changes.

## Current-main audit

The `AiSignal` screen already exists as a first-class `Tab` and Android back-navigation already treats `AiSignal` as a non-root route that returns to HOME. However, the current bottom navigation is generated from `PrimaryTab`/`tabs`, which currently contains only `HOME`, `MARKETS`, `PAPER`, and `PORTFOLIO`.

This creates a navigation regression against the product UX contract:

`홈 · 시장 · PAPER · 자산 · AI`

The Home surface is otherwise substantially aligned with the decision-first direction and does not require a wholesale redesign for this P1.

## Required source change

Target: `apps/mobile/App.tsx`

1. Add `AiSignal` to `PrimaryTab`.
2. Remove duplicate `AiSignal` from the secondary-only portion of `Tab`.
3. Add `AiSignal` to `tabs` as the fifth destination, after `PORTFOLIO`.
4. Add Korean display label `AI` wherever `Record<PrimaryTab, ...>` requires it.
5. Preserve the existing dashboard-connection gating for AI data.
6. Do not change Order routing, PAPER authority, LIVE authority, mutation permissions, or trading semantics.

Intended shape:

```ts
type PrimaryTab = "HOME" | "MARKETS" | "PAPER" | "PORTFOLIO" | "AiSignal";
type Tab = PrimaryTab | "Order";

const tabs: PrimaryTab[] = ["HOME", "MARKETS", "PAPER", "PORTFOLIO", "AiSignal"];
```

For primary labels, `AiSignal` renders as `AI`.

## Acceptance criteria

- Bottom navigation shows exactly five destinations in this order: `홈 / 시장 / PAPER / 자산 / AI`.
- Tapping `AI` opens the existing `AiSignal` screen.
- Android Back from `AiSignal` continues to resolve to HOME under the existing navigation containment rule.
- Layout remains unclipped at representative 360 px, 390 px, and 430 px phone widths.
- Each bottom-nav hit target remains at least 48 px high; current implementation already uses a 50 px minimum target and should retain it.
- AI remains read/decision-support UI; this change does not add trading authority.
- PAPER/LIVE safety copy and order behavior remain unchanged.
- Existing Home decision hierarchy is preserved.

## Regression test recommendation

Add a small navigation-contract test that asserts the exported/derived primary destinations contain five items in the exact expected order. Keep the existing Android back-navigation test that already includes `AiSignal`.

## Follow-up UIUX queue

After this P1 lands:

1. Validate five-tab ergonomics on Android device/emulator widths.
2. Unify AI decision-card hierarchy across Home and AiSignal: signal → confidence → evidence → risk → action.
3. Audit stale/error/safe-mode visual states so confidence and data freshness cannot be mistaken for normal operation.
4. Re-run desktop/mobile cross-surface terminology audit (`시장`, `자산`, `AI`, `PAPER`) without changing authority semantics.
