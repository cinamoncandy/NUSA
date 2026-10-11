# WO-PAPER-20261001-DAILY-LOSS-STREAK evidence

## Scope and authority

- Scope: PAPER canonical cloud risk gateway, consecutive-loss streak window only.
- Authority impact: PAPER risk policy; owner approved option 1 (daily reset) on 2026-10-01.
- Safety invariant: `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, `PAPER_ONLY`.

## Production observation that motivated the change

- `GET https://nusa-api.duckdns.org/health` at 2026-10-01T07:4xZ (0.9 s): `decisionCount=109746`, `paperOrderCount=0`, `paperFillCount=0` (this process), `lastPaperDecisionOutcome=REJECTED:PAPER_RISK_REJECT:CONSECUTIVE_LOSS_LIMIT`.
- Code reading: `realizedLossState` walked all persisted fills, counted trailing losing sell orders with no time window, and the limit is 3. An unmatched sell would instead halt with `RECONCILIATION_FAILED` (covered by tests/cloud-paper-cancelled-fill-risk.test.js), so the observed reason is a real historical loss streak.

## Change

- Source commit: `51f7ba6555b1306298eff11d9f408ef1cb82a1f1`.
- Risk source blob: `36526fb630290a11fde773c7be48af06c7bdab39` (pinned in cloudPaperCanonicalRiskGateway.requalification.test.ts).
- The streak counts only completed sells whose fill falls on the current UTC day.

## Tests

- tests/cloud-paper-daily-loss-streak.test.js: three losing sells today still trip the limit; the same streak on a previous UTC day no longer blocks.
- Requalification test: new blob, day-scoped assertion, full limit envelope unchanged.

## Local validation (Node v24.21.0, this branch)

- `pnpm install --frozen-lockfile`, `pnpm run build`, `pnpm run typecheck`: PASS
- `pnpm run validate`, `pnpm run security:gate`, `node scripts/aipos-work-order-index.js --check`: PASS
- `node --test tests/*.test.js`: PASS
- `node scripts/run-tests-isolated.js`: PASS after the requalification pin update (it failed first on the old pin, as designed).

## Remaining completion evidence

1. Exact-head CI, Audit and Release.
2. Owner-approved Oracle PAPER deploy, then /health showing the outcome is no longer CONSECUTIVE_LOSS_LIMIT (or a later, different reason).
