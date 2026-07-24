# Hedge Recovery Ledger v0.1

Partial hedge recovery is persisted separately from owner control commands. Each hedge has an append-only SHA-256 chain and a latest-state snapshot. The record append and snapshot update occur in one SQLite transaction.

Recorded actions include fill updates, cancellation, compensation, rollback, fault, and kill-switch recommendation. Replay rejects sequence gaps, hash tampering, timestamp regression, mixed hedge identifiers, and invalid terminal-state transitions.

A successful API response is not proof of a completed hedge. Only actual fill quantities determine delta and state. Unresolved exposure is persisted as `FAULTED`; a kill-switch recommendation remains set after restart.

Safety boundaries:

- PAPER and DRY_RUN coordination only
- no exchange credentials or private API integration
- no live order path
- no automatic withdrawal behavior
- persistence uncertainty fails closed
- this ledger records recovery evidence; it does not guarantee atomic execution across an exchange
