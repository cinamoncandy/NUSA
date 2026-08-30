# NUSA Semantic State System v1

Date: 2026-08-30
Scope: UI/UX, visual design, design system, user experience only.

## Purpose

Unify operational state presentation across NUSA without changing trading logic, authority, or execution behavior.

## State model

Every state surface should communicate three independent dimensions:

1. **Mode**: PAPER, SHADOW, LIVE
2. **Health**: healthy, connecting, degraded, disconnected, error
3. **Authority**: unavailable, informational, user-actionable, explicitly enabled

Never encode mode or authority with color alone. Use visible text, semantic attributes, and iconography where appropriate.

## Shared state grammar

### PAPER

- Label: `PAPER`
- Meaning: simulated execution only
- Action treatment: actionable simulation controls may be shown
- Safety copy: real trading is disabled

### SHADOW

- Label: `SHADOW`
- Meaning: observes or evaluates without execution
- Action treatment: execution controls remain unavailable

### LIVE

- Label: `LIVE`
- Meaning: real execution environment
- Action treatment: must always expose explicit authority and safety boundary
- Never imply LIVE merely because market data is connected

### Health states

- `healthy`: current data/connection is usable
- `connecting`: startup or reconnection in progress
- `degraded`: usable with material limitations
- `stale`: data exists but freshness is outside the expected window
- `disconnected`: no usable connection
- `error`: a known failure prevents expected behavior

### Action states

- `ready`: action may be presented as available
- `blocked`: action is intentionally unavailable and must explain why
- `pending`: action was requested and has not completed
- `success`: action completed
- `failed`: action did not complete and recovery guidance is required

## Visual rules

- Mode labels are explicit text badges.
- Status colors communicate health/severity, not brand identity.
- Warning/danger states use icon + text, never hue alone.
- Disabled actions explain the blocking reason adjacent to the control or on focus.
- Live authority must never be inferred from a green connection indicator.
- Loading and reconnecting states retain layout stability to prevent attention jumps.

## Accessibility

- State text remains available to screen readers.
- Status changes use `aria-live` only for meaningful transitions, avoiding noisy announcements.
- Keyboard focus remains visible against every state background.
- Interactive state controls have predictable tab order.
- Contrast must meet the project's accessibility target in normal and contrast themes.
- `prefers-reduced-motion` disables nonessential state animation.

## Component API direction

Prefer one semantic component contract over page-specific status styles:

`StateBadge(mode?, health?, action?, authority?, freshness?)`

The component owns presentation only. It must not decide whether an action is actually authorized or executable.

## Migration order

1. Establish shared semantic selectors/tokens.
2. Map existing simple-ui state classes to semantic states.
3. Replace duplicated connection/status treatments.
4. Add stale/blocked/error explanatory patterns.
5. Apply the grammar to Command Center, Markets, Orders, Positions and AI surfaces.
6. Validate responsive and keyboard behavior.

## Acceptance criteria

A user can identify mode, health, authority, and action availability without relying on color or opening another page. Existing `data-simple-*` hooks and runtime behavior remain unchanged during visual migration.
