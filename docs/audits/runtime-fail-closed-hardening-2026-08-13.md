# Runtime Failure Fail-Closed Hardening

## Finding

`startCloudRuntime` allowed a caller-supplied `PaperTradingExecutionLoop` to become a direct strategy-tick or manual-order mutation path when the canonical Cloud PAPER risk boundary was not composed. That made dependency injection capable of bypassing the Cloud risk gateway.

## Change

- Compose `CloudPaperCanonicalRiskGateway` and `CloudPaperExecutionBoundary` whenever durable PAPER state and configured PAPER capital are available, including supplied loops.
- Remove direct execution-loop fallbacks from market-tick and manual-order runtime paths.
- When no canonical boundary exists, market ticks remain read-only projections and manual orders return `PAPER_RISK_BOUNDARY_UNAVAILABLE`; no order/fill/account mutation is attempted.

## Verification

- Focused runtime fail-closed suite: **56/56 PASS**.
- Covered startup hydration failure, dashboard persistence/recovery, P0 open/corruption, kill switch, stale/offline state, runtime stage exception, invalid stage output, shutdown/runtime recovery, and canonical PAPER risk wiring.
- `pnpm build`: PASS.

## Safety

The fix narrows mutation paths. `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `realTransferAuthority=false`, and AI `ZERO_AUTHORITY` remain unchanged. Physical Android acceptance remains `HUMAN_ENVIRONMENT_ONLY_PENDING`.
