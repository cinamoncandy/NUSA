# dokkaebi

Reconstructed TypeScript baseline for DOKKAEBI OS trading components.

Implemented safety baseline:

- immutable position ledger and SQLite projections
- bounded order admission, pre-trade risk, durable idempotency, and synthetic execution
- explicit `SUBMISSION_UNKNOWN` handling without automatic resubmission
- append-only order reconciliation evidence and account-level new-exposure restrictions
- position, balance, funding-fee, trade-fee, fill, and PnL reconciliation
- explicit `MATCHED`, missing-record, duplicate, mismatch, and provider-unavailable outcomes
- bigint tolerance policies for quantities, prices, balances, funding amounts, fees, fills, and PnL
- deterministic latest-evidence lookup and freshness states: `FRESH`, `EXPIRING_SOON`, `STALE`, `NOT_MATCHED`
- stale or unavailable reconciliation evidence blocks new exposure
- domain restrictions require a later same-account `MATCHED` result for release
- restriction release requires separated requester and verifier identities
- matched position, balance, funding, fee, fill, and PnL reconciliation IDs are stored as append-only release evidence
- deterministic liquidation-risk assessment that blocks new exposure without automatically closing positions
- fail-closed exchange quantity, price-tick, notional, and metadata-freshness validation
- deterministic weighted token-bucket rate limiting with explicit allow, delay, and block outcomes
- clock-offset, round-trip, recvWindow, and synchronization-freshness validation for signed-request safety
- WebSocket sequence continuity checks with duplicate suppression, gap detection, and non-regressing snapshot recovery
- reconciliation never rewrites accounting records, positions, balances, fees, fills, or PnL
- no automatic position close, order retry, restriction release, or Production authorization
- conservative final certification that refuses to invent implementation evidence

Connectivity safety limits:

- oversized provider requests are blocked rather than split or retried implicitly
- rate-limit state rejects backwards time and deduplicates request decisions
- stale or unsafe clock evidence cannot authorize signed provider requests
- WebSocket events are not applied while a sequence gap remains unresolved
- recovery snapshots cannot regress the last applied sequence

Reconciliation safety limits:

- provider operations are synthetic and read-only
- reconciliation never submits or resubmits an order
- provider absence is not treated as success
- old `MATCHED` evidence expires according to policy
- mismatches and uncertainty block new exposure but do not automatically mutate economic state
- release evidence is append-only and must identify the later matching reconciliation

This repository is **not Production-authorized**. It contains no Binance Production credential, Production endpoint, Binance order adapter, capital activation, or unrestricted trading path.
