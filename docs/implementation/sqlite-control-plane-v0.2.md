# SQLite Control Plane v0.2

## Scope

This slice persists mobile control decisions without adding live trading, private exchange APIs, credentials, or withdrawal capability.

## Transaction boundary

A control command is handled inside one `BEGIN IMMEDIATE` transaction:

1. load persisted runtime state;
2. load and replay the complete audit ledger;
3. verify runtime mode, kill-switch state, and ledger hash;
4. validate and decide the command;
5. append one hash-chained audit record;
6. update the singleton runtime state;
7. commit.

Any failure rolls back both the audit append and runtime update.

## Tables

- `control_runtime_state`: singleton runtime mode, health, kill switch, ordering timestamp, and latest ledger hash.
- `control_audit_records`: append-only sequence, previous hash, canonical event JSON, and record hash.

## Fail-closed conditions

- storage not initialized;
- audit replay failure;
- runtime/audit mode mismatch;
- runtime/audit kill-switch mismatch;
- ledger hash mismatch;
- sequence or previous-hash conflict;
- persistence failure.

## Restart semantics

On restart, the service replays the stored audit records and compares the result with the persisted runtime snapshot. A mismatch prevents further command execution.

## Safety boundary

Supported commands remain `PAUSE`, `EMERGENCY_STOP`, and strongly authenticated `RESUME_PAPER`. Live activation and exchange order execution are intentionally absent.
