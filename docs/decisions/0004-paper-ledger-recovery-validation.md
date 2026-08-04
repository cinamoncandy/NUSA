# Decision 0004 — Paper Ledger Recovery Validation

Status: Accepted

Date: 2026-08-04

## Context

Paper recovery previously replayed a persisted Ledger into `PaperBroker`, correcting a divergent stored account projection. A corrupted Ledger or a Ledger/projection mismatch could therefore reach recovery before reconciliation blocked Paper commands.

## Decision

Validate a Paper Ledger before Legacy JSON import, SQLite recovery, or `PaperBroker` state projection. Validation returns a deterministic status and reason-code list; it never returns a bare boolean.

### Fail-closed recovery boundary

`VALID` candidates continue through the existing SQLite-first recovery and Legacy fallback. `INVALID` candidates are not imported or projected. Recovery records the validation reason codes, persistence is considered unhealthy, and both manual and automatic Paper commands remain unavailable through the existing `PERSISTENCE_REPAIR_MESSAGE` boundary.

### Invariants

Validation verifies consecutive increasing sequences, unique sequences, valid order references, non-negative cash and position quantities, the quantity/average-price invariant, non-regressing timestamps, valid ledger transitions, no oversell, and equality between Ledger replay and the persisted account projection.

### Compatibility

The persisted `ledger` field remains optional for pre-Ledger Legacy states. A state that includes a Ledger is validated strictly without schema migration or new persistence storage. A Ledger/projection mismatch is now rejected instead of being silently corrected during recovery.

### Reason-code policy

The validation result uses only stable codes: `INVALID_SEQUENCE`, `DUPLICATE_SEQUENCE`, `INVALID_ORDER_REFERENCE`, `NEGATIVE_CASH`, `NEGATIVE_POSITION`, `INVALID_AVERAGE_PRICE`, `TIMESTAMP_REGRESSION`, `PROJECTION_MISMATCH`, `LEDGER_TRANSITION_MISMATCH`, and `SELL_EXCEEDS_POSITION`.

Reason codes are recorded in the internal persistence diagnostic. The user-facing control fault remains the existing generalized `PERSISTENCE_REPAIR_MESSAGE`; raw Ledger contents, database errors, and filesystem paths are not exposed.

## Consequences

No order admission, fill calculation, risk decision, Ledger schema, or Live Trading behavior changes. The only changed behavior is recovery: uncertain persisted Paper state remains stopped until repaired.
