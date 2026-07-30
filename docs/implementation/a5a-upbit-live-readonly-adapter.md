# A5A — Upbit Live Read-Only Adapter

## Scope

A5A introduces the first authenticated Upbit integration while keeping every economic mutation technically disabled.

Implemented reads:

- account balances,
- open orders,
- one order by UUID,
- timestamped account/open-order snapshot.

Explicitly blocked operations:

- order submission,
- order cancellation,
- withdrawals.

## Safety properties

- The adapter does not persist API credentials.
- Credentials are supplied only at runtime by the caller.
- Authentication uses an HS256 JWT generated with Node.js cryptography.
- Requests with query parameters include a SHA-512 query hash.
- Provider errors fail the read operation; they do not fall back to assumed state.
- Mutation methods always throw `LiveMutationDisabledError`.

## Not included

This change does not connect the adapter to the Electron renderer, settings storage, strategy engine, decision engine, or execution coordinator. It does not enable live trading.

A later stage must add an OS-backed credential provider, account reconciliation, durable intents, risk approval, idempotent execution, kill-switch enforcement, owner approval, and fixed-capital limits before any order submission path can exist.

## Verification

The accompanying tests cover:

- authenticated account reads,
- query construction for open orders,
- credential non-disclosure in the authorization header,
- fail-closed mutation methods,
- provider error propagation.
