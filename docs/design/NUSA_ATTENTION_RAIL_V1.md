# NUSA Attention Rail v1

## Purpose

Create one compact, task-oriented surface that answers the operator's first question: **what needs my attention right now?**

## UX contract

Order information by consequence, not chronology:

1. Safety / authority boundary
2. Trading-blocking risk or system failure
3. Stale or degraded market/data state
4. Strategy or execution state requiring awareness
5. Informational events

## Interaction

- Every item has a short label, current state, consequence, and optional next action.
- State is never communicated by color alone.
- PAPER, SHADOW, and LIVE are explicit mode labels.
- LIVE availability is never inferred from a generic healthy state.
- Dismissal is reserved for informational items. Blocking safety states remain visible until resolved.
- Keyboard focus must move through severity, context, and action in that order.

## Responsive behavior

- Desktop: persistent rail beside the primary work surface.
- Tablet: collapsible rail with severity summary retained.
- Mobile: sticky top summary plus expandable attention list.

## NUSA-specific priority

The rail should reduce scanning across Dashboard, Markets, Orders, Positions, and system status. It should not become a second notification inbox. Its job is to expose only information that can change the operator's immediate understanding or next action.

## Implementation boundary

Presentation only. No trading authority, order execution, risk calculation, or strategy decision behavior is introduced by this design artifact.
