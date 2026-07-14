# Orderbook Imbalance Paper v1

## Scope

This module is a deterministic PAPER/DRY_RUN-only execution ledger for the Orderbook Imbalance research pipeline.

## Contracts

- append-only event ledger
- SHA-256 event hash chain and ledger hash
- deterministic replay into immutable order snapshots
- explicit order state transitions
- partial-fill and overfill validation
- feature and decision provenance hashes
- daily PnL, fee, slippage, and order-count reports
- policy-gated Champion candidate report using Paper, Walk-Forward, and Stress evidence

## State flow

`NEW -> QUEUED -> ACCEPTED -> PARTIAL_FILL/FILLED -> CLOSED -> ARCHIVED`

Cancellation and rejection are terminal until archival. Invalid transitions, duplicate events, missing orders, malformed timestamps, invalid hashes, non-finite values, and ledger tampering fail closed.

## Safety boundary

The module does not contain a live exchange adapter, private API call, credential access, capital allocation, automatic promotion, or LIVE order path. An eligible Champion candidate report remains a research artifact and never promotes a strategy automatically.
