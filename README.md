# dokkaebi

Reconstructed TypeScript baseline for DOKKAEBI OS trading components.

Implemented today:

- immutable position-ledger contracts
- SQLite-backed position snapshots and replay markers
- deterministic pre-trade risk checks
- bounded order admission with explicit environment/account/strategy/symbol/order-type scope
- idempotency and economic-intent replay protection
- conservative final-certification evaluation that refuses to invent implementation evidence

This repository is **not Production-authorized**. It contains no Binance Production credential, endpoint, order execution adapter, capital activation, or unrestricted trading path.
