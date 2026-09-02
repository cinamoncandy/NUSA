# NUSA Design System

## Principles
CLARITY · FOCUS · CONTROL · CONFIDENCE · ADAPTIVE · SAFETY

## Trading UX semantic rules
- Execution mode is global state, not page-local decoration.
- PAPER, LIVE, and NO AUTHORITY must never share the same visual treatment.
- Risk and rejection states are semantic and must use canonical tokens/components.
- Trading-critical actions require visible validation and acknowledgement states.
- Stale/disconnected data must be visually distinguishable from valid zero/empty values.

## Information hierarchy
1. Account/execution state
2. Risk state
3. Actionable signal
4. Positions/orders
5. Performance/history

## Core components
Use one canonical implementation for Button, Chip/Badge, Input, Select, Tabs, Table, Toast, Dialog/Sheet, Progress/Gauge and status indicators.

## Responsive behavior
Desktop tables may collapse to ranked cards on mobile, but critical fields and state semantics must remain equivalent.
