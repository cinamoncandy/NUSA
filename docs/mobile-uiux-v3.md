# NUSA Mobile UI/UX v3

## Product intent

NUSA mobile is a decision workspace, not a dashboard wall. The interface must make the next safe action obvious while keeping PAPER-only authority continuously visible without allowing compliance copy to dominate the viewport.

## Information architecture

Primary navigation is fixed to five user jobs:

1. Home — situational overview, investable/protected cash and next safe action
2. Markets — observe market truth, watchlist and chart availability
3. PAPER — rehearse an order inside the user's investment cash envelope
4. Portfolio — understand equity, total cash, investable cash, protected cash, position and P/L
5. AI — read-only analysis, confidence and evidence

History, notifications and settings remain utilities, not primary destinations.

## Canonical implementation map

- `App.tsx` — application chrome, five-job navigation, compact authority/allocation strip, utility tray, lifecycle/session orchestration only
- `homeView.tsx` — PAPER equity, investable/protected cash, runtime readiness, AI confidence, next-action hierarchy
- `marketsView.tsx` — market truth metrics, responsive watchlist/chart workspace
- `watchlistView.tsx` — embedded market discovery workspace; no duplicate top-level screen heading
- `tradingView.tsx` — PAPER staged order workflow using the investment cash envelope and segmented side/order-type controls
- `portfolioView.tsx` — metric-first equity/P&L plus investable/protected cash hierarchy
- `aiView.tsx` — analysis -> confidence -> evidence -> authority hierarchy
- `settingsView.tsx` — cash allocation -> connection status/task -> appearance -> safety -> local management
- `cloudInvestmentAllocationClient.ts` — authenticated allocation sync bound only to the currently verified PAPER endpoint/session
- `capitalAllocationGuard.ts` — canonical investable/protected cash envelope
- `orderHistoryView.tsx` — search + segmented filter/period/sort + execution records
- `notificationView.tsx` — truthful unavailable-capability empty state until real event runtime exists
- `uxPrimitives.tsx` — `ScreenHeader`, `MetricTile`, `SegmentedControl`, `InlineNotice`
- `uxLayout.ts` — shared responsive workspace constants

## Interaction hierarchy

Every top-level screen follows the same vertical grammar:

1. Screen header — eyebrow, title, one-sentence purpose, optional compact status/action
2. Primary state — the most decision-relevant metric or operational state
3. Work area — controls or data needed for the current job
4. Secondary evidence — details, metadata and explanations
5. Recovery — error/retry or connection guidance close to the affected content

Nested workspaces such as Watchlist do not repeat the parent screen title. Safety state is persistent but compact. Long authority explanations appear only where they change a decision.

## Visual system

- 20px phone horizontal gutter; 24px wide-screen gutter where a dedicated wide layout needs it
- 1080px maximum primary workspace width
- 48px minimum actionable touch target
- 16px default card radius; 12-14px control radius
- 8px baseline rhythm with 12/16/24/32px semantic gaps
- tabular numerals for financial values
- one raised surface per logical section; avoid nested-card walls
- primary teal is reserved for selected/actionable state, not decoration
- danger is reserved for irreversible/risk state
- warning means degraded/needs-attention, never neutral emphasis

## Component roles

### ScreenHeader
Defines one screen purpose. It may contain a compact right-side status/action but never a second paragraph of operational policy.

### MetricTile
For one high-signal metric/status. Financial screens place the most decision-relevant values above detailed rows.

### SegmentedControl
For mutually exclusive local modes such as Watchlist/Chart, Buy/Sell, Market/Limit, allocation presets, theme, history filters or sort modes. It is not global navigation.

### InlineNotice
For contextual warning, error, info or success. Use instead of a full card when the message is not a separate task.

## Cash investment allocation contract

The user can choose what percentage of exchange PAPER cash is eligible for new investment and what percentage stays uninvested/protected.

- `investmentPercent`: 0-100%, default 100% for backward compatibility
- `reservePercent = 100 - investmentPercent`
- `investableCash = exchangeCash * investmentPercent / 100`
- `reservedCash = exchangeCash - investableCash`
- the envelope limits creation of new BUY exposure; it does not block SELL/exit behavior
- invalid percentages fail closed
- Settings persists the local preference and synchronizes the same value to the authenticated Cloud PAPER setting
- Cloud sync may only use the currently configured and verified PAPER endpoint plus process-memory credential
- endpoint/session changes during sync invalidate the operation
- Home, PAPER, Portfolio and the compact app authority strip show the same active percentage
- PAPER BUY validation uses `investableCash`, not total exchange cash
- 0% therefore prevents new BUY exposure while preserving exit capability

This is a capital-safety control, not a decorative preference. A UI that shows the percentage but validates orders against total cash is incorrect.

## Screen-specific contracts

### Home
Home answers four questions in order: what is my PAPER state, how much cash may be invested vs protected, is operation safe/ready, and what should I inspect next. It never becomes a dense admin dashboard.

### Markets
Markets shows connection/freshness before chart affordances. Missing candle data means no chart mode. Watchlist is embedded under the Markets screen and does not introduce a second global heading.

### PAPER
The order flow is staged:

1. Market state, total cash, investable cash and protected cash
2. Side and order type
3. Price/quantity input
4. Preview with notional, investment envelope and validation
5. Explicit confirmation
6. Result/recovery

Buy/Sell and Market/Limit use the same segmented selection language used elsewhere. BUY availability is capped by the investment envelope. Confirmation must replace the normal submit affordance rather than look like an unrelated action.

### Portfolio
Total equity is the hero value. Total exchange cash is explicitly split into investable and protected cash before P/L and position detail so the user never mistakes all cash for deployable capital.

### AI
AI presents thesis first, then model/calibrated confidence, then evidence/counter-evidence, then diagnostics and immutable authority boundaries. Raw probability is never visually presented as a guaranteed success probability.

### Settings
Cash allocation is a first-class capital control with preset percentages, direct numeric entry and derived currency amounts. Connection health and endpoint/token actions remain a separate task. Theme is a segmented local preference. Safety authority is diagnostic and cannot enable LIVE behavior. Destructive/local management is visually separated from routine work.

### History
Search and filter controls precede records. Mutually exclusive filters, periods and sort orders use segmented controls. Records remain read-only.

### Notifications
Until a real event collection/display runtime exists, the screen explicitly shows an unavailable capability state and never fabricates notification items or settings.

## Responsive behavior

- < 600px: one-column workflow, bottom navigation, controls full width
- 600-839px: one-column content with two-column metric grids where useful
- >= 840px: two-column workspaces may be used, with summary/decision columns capped around 340-440px
- Never rely on named device classes; derive from available width
- Financial hero numbers use fit/one-line behavior rather than clipping
- Nested rows wrap before controls become smaller than 48px

## Safety and authority

Immutable product rules:

- PAPER ONLY
- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- AI ZERO_AUTHORITY / read-only
- credentials remain process-memory-only

UI redesign and cash allocation must never weaken transport, credential, idempotency, canonical risk or fail-closed behavior.

## Accessibility

- 48px minimum actionable touch target
- disabled state exposed through `accessibilityState`
- selected/expanded state exposed for tabs, segmented controls and trays
- no color-only status communication
- large text must not clip critical values/actions
- deterministic focus order follows visual order
- global navigation exposes `tablist`/`tab` semantics

## APK design provenance contract

A UI/UX design is not accepted merely because it exists on a branch. Final Android RC packaging must prove:

`canonical UI source HEAD == RC checkout HEAD == provenance sourceSha == installed APK source`

Before Android RC assembly the workflow runs the canonical v3 source contract plus cash-allocation and existing safety/UI regressions. Artifact name and Android version include exact source identity.

## Definition of UI/UX v3 complete

Implementation-complete requires all canonical routes and utilities above to use the shared hierarchy/primitives, the cash allocation setting to remain enforced from Settings through PAPER BUY validation, and no known legacy duplicate-heading or sub-48px actionable control regressions.

Validation-complete additionally requires:

1. canonical v3 + cash-allocation source contracts PASS
2. TypeScript/build/lint/full CI PASS
3. Mobile Native Debug/RC PASS
4. exact-head provenance APK produced
5. physical Android visual/functional P0/P1 = 0

Manual Actions or physical-device acceptance is intentionally performed only after the design implementation is frozen.
