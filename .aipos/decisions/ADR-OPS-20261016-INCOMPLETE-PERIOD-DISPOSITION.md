# Incomplete PAPER period disposition
Status: PROPOSED — not runtime policy and not an authorization to retire data.

The existing COMPLETED/REJECTED/HALTED period envelope still requires numeric cost components and benchmark/returns. Constructing that envelope for an unknown-cost fill would fabricate performance. Existing retirePending deletes the pending row and emits only an observer event; the bounded observability projection is not durable failure history. Neither path is sufficient for this case.

Proposed smallest integration:
1. Extend the EXISTING pending-period repository with an explicit ACTIVE/INELIGIBLE disposition and immutable, checksum-bound failure receipt. Preserve the original pending payload/checksum, canonical fills and realized records; add no parallel ledger or scheduler.
2. Receipt binds period ID/index/start, source/runtime revision when actually known, immutable incomplete fill/cost-receipt fingerprints, boundary, existing INCOMPLETE_EXECUTION_COST_EVIDENCE code and validPerformanceEvidence=false. Do not infer a historical source SHA from candidate codeSha. Do not include prices, balance or account IDs in public receipts.
3. A compare-and-swap transaction must persist the receipt and successor boundary plan together, or persist a resumable checkpoint before successor creation. Failed receipt persistence must leave the original ACTIVE period blocked. Duplicate/replay requests return the same receipt; conflicting evidence fails closed.
4. Recovery must validate both payload and disposition checksums, reconstruct the active successor exactly once and retain all failed history. Allocate indexes from retained dispositions and realized periods, never just the realized count.
5. No rejected disposition enters performance/qualification/Governance or cycle completion. Preserve open-position exposure across the boundary; no reset of basis/PnL and no disposal of orphan fills. An incomplete SELL/BUY interval may require remaining blocked until an admissible account boundary exists.
6. Required fault tests: failure before/after receipt/next-plan commit; restart on each checkpoint; concurrent CAS; repeated replay; corrupt disposition; old-schema recovery/rollback; no duplicate period/cycle and no fabricated cost.
7. Architecture/Governance review must accept the schema/recovery contract before implementation or migration. Until then the existing period stays blocked, truthfully.

This proposal is NOT IMPLEMENTED, does not close #2589/#1605, and grants no AI/Research/Risk/Release authority.
