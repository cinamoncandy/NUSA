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
- active restrictions block admission before idempotency mutation
- manual restriction release requires every source execution to be resolved
- restriction requester and verifier must be different identities
- release rationale and verified Intent identities are stored as append-only evidence
- SQLite restriction release and evidence persistence can run in one transaction
- synthetic provider/local wallet-position reconciliation with explicit matched, mismatch, and provider-unavailable outcomes
- deterministic bounded worker for all local wallet-position snapshots
- open positions with unavailable provider state activate `POSITION_STATE_UNCERTAIN`
- closed positions do not create exposure restrictions solely because provider lookup is unavailable
- position quantity or average-entry mismatch activates an account-level new-exposure restriction
- position reconciliation results are stored as append-only SQLite evidence
- generic restriction release cannot clear a position-related restriction
- position restriction release requires a later `MATCHED` reconciliation for the same account
- position restriction release requires separated requester and verifier identities
- matched reconciliation identity is stored in a dedicated SQLite evidence field
- position restriction state and release evidence can be committed atomically
- failed release evidence persistence leaves the position restriction active
- stale, cross-account, mismatched, or provider-unavailable evidence cannot clear a position restriction
- accepted and rejected execution outcomes cannot regress to an uncertain state
- conservative final-certification evaluation that refuses to invent implementation evidence

Reconciliation safety limits:

- reconciliation performs provider lookup only; it never submits or resubmits an order
- per-run order and position scan volumes are bounded and deterministic
- overdue and critical counts are operational signals, not permission to change execution state
- critical unresolved state blocks new exposure but does not automatically close positions
- restriction release is prohibited while any source execution remains uncertain
- provider absence or lookup failure preserves uncertainty
- provider absence for an open local position blocks new exposure until a later matched reconciliation is independently verified
- provider absence for a closed local position does not invent an exposure restriction
- position mismatch blocks new exposure but does not automatically rewrite the local ledger or close positions
- reconciliation and release evidence are append-only

This repository is **not Production-authorized**. It contains no Binance Production credential, Production endpoint, Binance order adapter, capital activation, or unrestricted trading path.
