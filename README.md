# dokkaebi

Reconstructed TypeScript baseline for DOKKAEBI OS trading components.

Implemented today:

- immutable position-ledger contracts
- SQLite-backed position snapshots and replay markers
- deterministic pre-trade risk checks
- bounded order admission with explicit environment/account/strategy/symbol/order-type scope
- restart-safe SQLite idempotency and economic-intent replay protection
- synthetic execution gateway with explicit accepted/rejected/submission-unknown outcomes
- durable SQLite execution records across database close and reopen
- stranded `SUBMITTING` attempts recovered as `SUBMISSION_UNKNOWN`, never automatically retried
- terminal execution identity and status protected from rewriting
- conservative final-certification evaluation that refuses to invent implementation evidence

This repository is **not Production-authorized**. It contains no Binance Production credential, Production endpoint, Binance order adapter, capital activation, or unrestricted trading path.
