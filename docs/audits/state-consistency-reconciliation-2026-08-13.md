# State Consistency / Projection Reconciliation Audit — 2026-08-13

## Finding

The durable PAPER account checksum protected persistence tampering, but the account validator did not fully reconcile the internal order, fill, idempotency, position, and accounting relationships before restart or dashboard projection.

## Remediation

`PaperTradingExecutionLoop` now rejects restored or saved state when:

- position, order, fill, or idempotency identities are duplicated or dangling;
- a filled order has no exactly matching fill;
- order/fill market, side, quantity, price, fee, or timestamp fields disagree;
- order status or accounting fields are invalid;
- every order is not represented by a durable idempotency tombstone;
- equity or unrealized PnL does not equal the current cash/position projection.

The existing SQLite checksum, writer lease, dashboard snapshot recovery, canonical PAPER risk boundary, and read-only projection remain authoritative. No automatic repair or guessed state is introduced.

## Evidence

- `tests/cloud-paper-trading-execution-loop.test.js`: 23/23 PASS, including restart, crash takeover, projection parity, and corrupted order/fill/accounting rejection.
- Cloud dashboard persistence, runtime PAPER operations, and recovery reconciliation suite: 40/40 PASS.
- Typecheck: PASS.
- Build: PASS.
- `git diff --check`: PASS.

## Safety

Inconsistent state fails closed before normal PAPER projection or mutation. No LIVE, broker, credential, transfer, withdrawal, AI, risk override, or kill-switch authority is added.
