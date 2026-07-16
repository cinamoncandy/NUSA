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
- provider lookup reconciliation that can resolve unknown submissions without resubmitting orders
- bounded reconciliation scans for unresolved submissions
- unresolved submission age classified as recent, overdue, or critical
- append-only SQLite evidence for reconciliation runs and per-order lookup results
- critical unresolved submissions activate an account-level new-exposure restriction
- active restrictions require manual release and block admission before idempotency mutation
- accepted and rejected execution outcomes cannot regress to an uncertain state
- conservative final-certification evaluation that refuses to invent implementation evidence

Reconciliation safety limits:

- reconciliation performs provider lookup only; it never submits or resubmits an order
- per-run scan volume is bounded and deterministic
- overdue and critical counts are operational signals, not permission to change execution state
- critical unresolved state blocks new exposure but does not automatically close positions
- provider absence or lookup failure preserves uncertainty
- reconciliation evidence is append-only and duplicate run identities are rejected

This repository is **not Production-authorized**. It contains no Binance Production credential, Production endpoint, Binance order adapter, capital activation, or unrestricted trading path.
