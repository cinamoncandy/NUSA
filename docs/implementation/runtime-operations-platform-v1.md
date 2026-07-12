# Runtime Operations Platform v1

This milestone completes five read-only runtime operation layers:

1. Runtime Event Bus
2. Runtime Replay
3. Runtime Incident Report
4. Operator Timeline
5. Electron and mobile operator view models

## Safety boundaries

- PAPER / DRY_RUN only
- no order placement, cancellation, or modification
- no strategy promotion or configuration mutation
- no credentials or private exchange API
- no Kill Switch bypass
- UI view models expose no actions

## Determinism and auditability

Events require unique IDs and immutable payloads. Replay sorts by event time and ID. Incident reports are generated only for BLOCKED or FAILED runs. Operator timelines combine replay and incident data without changing runtime state. Desktop and mobile outputs are read-only immutable projections.

## Failure policy

Malformed timestamps, mixed run IDs, duplicate event IDs, invalid mobile limits, and non-auditable records fail closed.
