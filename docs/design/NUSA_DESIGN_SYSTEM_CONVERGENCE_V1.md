# NUSA Design System Convergence v1

## Goal
Converge the active Desktop `simple-ui` presentation layer with the existing NUSA semantic design language without changing runtime behavior or trading authority.

## Current-state finding
The active `simple-ui.css` owns a parallel visual vocabulary: surface, border, text, primary, success/warning/danger, radius, shadow, and spacing tokens. NUSA also has canonical semantic tokens and reusable state primitives. This creates avoidable drift in meaning and makes future screens harder to keep consistent.

## Convergence model
### 1. Semantic meaning first
Use semantic roles rather than component-specific color names:
- `mode.paper`
- `mode.shadow`
- `mode.live`
- `state.success`
- `state.warning`
- `state.danger`
- `state.neutral`
- `state.info`
- `state.stale`

### 2. Surface hierarchy
Use a small, predictable hierarchy:
- canvas
- surface
- elevated surface
- muted surface
- strong border
- focus ring

### 3. Typography hierarchy
Trading-critical values use tabular numerals. Labels remain compact and secondary. Headings establish task context rather than decorative hierarchy.

### 4. State grammar
Every critical state has:
- visible text label
- semantic role
- optional icon/indicator
- contrast-safe presentation
- no color-only dependency

### 5. Density grammar
Comfort, standard, and compact modes change spacing and secondary-content visibility, but do not remove decision-critical context.

## Migration rules
1. Do not delete or rename existing runtime hooks solely for visual convergence.
2. Introduce aliases before replacing local tokens.
3. Migrate high-frequency primitives first: badges, buttons, cards, status indicators, tables.
4. Keep PAPER/SHADOW/LIVE labels explicit at every density.
5. Preserve keyboard focus and reduced-motion behavior.
6. Do not make LIVE appear more actionable than PAPER through generic primary-button styling.

## Component priorities
P0: mode badge, connection state, risk state, action state, button, card, table.
P1: page header, section header, empty state, loading state, error state, data freshness.
P2: decorative and low-frequency components.

## Validation
A convergence change is acceptable only if:
- the active Desktop UI remains functionally unchanged;
- semantic states remain distinguishable without color;
- keyboard focus remains visible;
- mobile density rules remain compatible;
- no critical state disappears at narrow widths;
- existing data/test contracts are untouched.

## User-needs research loop
Continue testing the design language against the user's real decision sequence: state -> risk -> evidence -> action -> result. New patterns are adopted only when they reduce scanning, context switching, or ambiguity.

## Scope boundary
Design-system and presentation architecture only. No execution logic, broker behavior, risk gates, AI authority, or LIVE activation is changed by this document.