# System Learning Evidence Freshness

This policy is a supervisor display policy only. It does not change strategy, promotion, capital, order, broker, or LIVE authority.

- `FRESH`: `recordedAt` is no more than 24 hours old.
- `AGING`: older than 24 hours and no more than 72 hours old.
- `STALE`: older than 72 hours. The UI must not imply that the record represents current system state.
- `INSUFFICIENT`: `recordedAt` is invalid or in the future. The UI must not infer freshness.

The classification is derived only from the canonical ledger record timestamp and the viewer's current clock. It is not confidence, quality, progress, performance, or a promotion signal.

Safety invariants remain `READ_ONLY`, `AI ZERO_AUTHORITY`, `liveAuthority=NONE`, and `productionMutationAllowed=false`.
