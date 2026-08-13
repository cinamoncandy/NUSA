# PAPER Order and Risk Boundary Hardening

## Finding

The canonical PAPER execution loop accepted an unvalidated runtime command from trusted internal callers. A malformed `side` could fall through to the SELL branch and an unknown `orderType` could be treated as a MARKET order. The HTTP boundary validates external payloads, but the execution boundary must also fail closed for direct or replayed internal inputs.

## Change

- Reuse `validatePersonalPaperOrderCommand` at the canonical execution-loop boundary.
- Reject malformed side/order-type input before idempotency, risk, or account mutation.
- Preserve existing Cloud risk-gateway, P0, kill-switch, stale-market, allocation, cash/position, LIMIT, and idempotency checks.

## Evidence

- Focused PAPER/risk suite: 68/68 PASS.
- New regression covers invalid `side` and `orderType` with zero order, fill, and idempotency mutation.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS.
- `pnpm build`: PASS.

## Safety

The change only narrows accepted PAPER commands. It adds no LIVE, broker, credential, risk override, or AI authority. `PAPER ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, and `AI ZERO_AUTHORITY` remain unchanged. Physical Android acceptance remains HUMAN_ENVIRONMENT_ONLY_PENDING.
