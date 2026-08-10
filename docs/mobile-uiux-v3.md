# NUSA Mobile UI/UX v3

## Product intent

NUSA mobile is a decision workspace, not a dashboard wall. The interface must make the next safe action obvious while keeping PAPER-only authority continuously visible without allowing compliance copy to dominate the viewport.

## Information architecture

Primary navigation is fixed to five user jobs:

1. Home — situational overview and next action
2. Markets — observe market state and watchlist
3. PAPER — rehearse an order with explicit preview and confirmation
4. Portfolio — understand cash, position and P/L
5. AI — read-only analysis and evidence

History, notifications and settings remain utilities, not primary destinations.

## Interaction hierarchy

Every screen follows the same vertical grammar:

1. Screen header — eyebrow, title, one-sentence purpose, optional compact status/action
2. Primary state — the most decision-relevant metric or operational state
3. Work area — controls or data needed for the current job
4. Secondary evidence — details, metadata and explanations
5. Recovery — error/retry or connection guidance close to the affected content

Safety state is persistent but compact. Long authority explanations appear only where they change a decision.

## Visual system

- 20px phone horizontal gutter; 24px wide-screen gutter
- 1080px maximum workspace width
- 48px minimum primary touch target
- 16px default card radius; 12px control radius
- 8px baseline rhythm with 12/16/24/32px semantic gaps
- tabular numerals for financial values
- one raised surface per viewport section; avoid nested-card stacking
- primary teal is reserved for selected/actionable state, not decoration
- danger is reserved for irreversible or sell/risk state
- warning means degraded/needs-attention, never neutral emphasis

## Component roles

### ScreenHeader
Defines one screen purpose. It may contain a compact right-side status/action but never a second paragraph of operational policy.

### MetricTile
For a single high-signal metric or status. No more than four in a row on large screens and two columns on phones when space allows.

### SegmentedControl
For mutually exclusive local modes such as Watchlist/Chart or Market/Limit. It is not global navigation.

### InlineNotice
For contextual warning, error, info or success. Use instead of a full card when the message is not a separate task.

## Responsive behavior

- < 600px: one-column workflow, bottom navigation, controls full width
- 600–839px: one-column content with two-column metric grids where useful
- >= 840px: two-column workspaces may be used, with the summary/decision column capped around 340–380px
- Never rely on fixed device classes; derive from available width

## PAPER order flow

The PAPER screen is a staged workflow:

1. Market state and available balance
2. Side and order type
3. Price/quantity input
4. Preview with notional and validation
5. Explicit confirmation
6. Result/recovery

The confirmation state must visually replace the normal submit affordance rather than appearing as an unrelated card below it.

## Safety and authority

Immutable product rules:

- PAPER ONLY
- liveAuthority=NONE
- productionMutationAllowed=false
- AI ZERO_AUTHORITY / read-only
- credentials remain process-memory-only

These rules are represented with compact persistent state plus contextual detail at decision points. UI redesign must never weaken transport, credential, idempotency or fail-closed behavior.

## Accessibility

- 48px touch targets for primary controls
- disabled state exposed through accessibilityState
- selected/expanded state exposed for tabs and trays
- no color-only status communication
- support large text without clipping critical values or actions
- deterministic focus order matching visual order

## Definition of UI/UX v3 complete

A screen is v3-complete when it uses the shared hierarchy and primitives, has phone/tablet responsive behavior, exposes state accessibly, preserves safety invariants, and passes exact-head UI regression + full CI + Mobile Native checks.
