# A5D Durable Live Execution State Machine

## Scope

A5D adds a durable, evidence-shaped execution lifecycle without enabling live exchange mutation. It reuses the existing admission, risk, kill-switch, recovery, SQLite, and Evidence boundaries. The default exchange port is `DisabledExchangeExecutionPort`; `productionMutationAllowed` is a literal `false`.

## State model

`INTENT_CREATED -> RISK_APPROVED -> QUEUED -> SUBMITTING -> ACCEPTED/PARTIALLY_FILLED/FILLED` is the normal lifecycle. Rejection, cancellation, expiry, unknown submission, and reconciliation-required states are explicit. Terminal states are `RISK_REJECTED`, `REJECTED`, `FILLED`, `CANCELED`, `EXPIRED`, and `RECONCILED`.

Every state mutation appends an immutable transition with a per-execution sequence and increments `version`. Invalid transitions throw before persistence. `SUBMISSION_UNKNOWN` never transitions back to `SUBMITTING`; it can only be resolved through reconciliation.

## Durable storage

`SqliteDurableExecutionRepository` stores records, transitions, and fills in SQLite. Record and transition writes occur in the supplied database transaction. `clientOrderId` is unique and remains attached to the execution across process restarts. Fill events are deduplicated by `exchangeTradeId`.

The migration is additive and creates `execution_records`, `execution_transitions`, and `execution_fills`. Rollback is operational: stop submission, preserve the database, export the tables as evidence, and deploy the prior application version. No destructive migration is used.

## Safety boundary

`DisabledExchangeExecutionPort` rejects submit and cancel with `LIVE_MUTATION_DISABLED`. No Upbit mutation endpoint, credential, JWT, or authorization header is present. A future fake port belongs only in tests; it is not selected by the production desktop wiring.

## Reconciliation and recovery

Active and uncertain records are reconciled by `getOrder`; lookup failure remains unknown and does not imply “no order”. A mismatch remains fail-closed and must be reviewed before exposure. On restart, incomplete records remain queryable and cannot be automatically resubmitted.

## Evidence and next steps

Transition records are the execution evidence boundary. The next increment should connect the existing desktop Evidence writer and read-only IPC projection, then add the A5E risk-limit approval and A5F operations gates. This PR intentionally does not create a live operating approval.
