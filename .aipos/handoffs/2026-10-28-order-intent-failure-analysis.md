# ORDER_INTENT failure analysis — 2026-10-28 (static code analysis, not yet confirmed on the host)

Author: CORE session. Scope: read-only analysis for phase 1 of `docs/PROPOSAL_TARGET_ARCHITECTURE_2026-10.md`.
No code, setting or host change. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.

## Observation (run 40275442510, 2026-10-26)

- `DECISION:PASS:BUY = 4824` and `ORDER_INTENT:FAIL = 4824`: every BUY decision failed at order intent.
- No `RISK:*` funnel key: `runtime.ts` records RISK only when `result.risk != null`, so every BUY was stopped before the canonical risk gate.
- No `ORDER_INTENT:FAIL:<CODE>` detail key: the funnel turns a coded reason (`PAPER_…`) into a detail key, so all 4824 reasons were free text.
- `paperOrderCount = 0`, ledger `lastFillAt` 2026-10-18.

## What the code allows

`ORDER_INTENT` is FAIL for every result that is not FILLED or WAIT (`runtime.ts`: BLOCKED, REJECTED, DUPLICATE and FAILED all count).
For an actionable BUY, `CloudPaperExecutionBoundary.processTick` (`apps/cloud/src/cloudPaperExecutionBoundary.ts`) returns before the
risk gate either `this.blocked("<CODE>")` (coded, so it would have shown a detail key) or one of two free-text results:

- line 262: `rejected("decision allocation is zero")`, mapped from `PAPER_EXECUTION_INTENT_ALLOCATION_ZERO`, which is the BUY one;
- line 263: `rejected("insufficient paper position")`, which applies to SELL only.

`buildPaperExecutionIntent` (`apps/cloud/src/paperExecutionIntent.ts:126`) throws `PAPER_EXECUTION_INTENT_ALLOCATION_ZERO` when
`plannedCapital = allocation.capital × investmentPercent / 100` is not positive. `allocation.capital` must already be positive
(`requireFinitePositive`), and the exchange-minimum path throws its own coded errors, so in practice this means
**`investmentPercent` is 0**. `runtime.ts:537` takes it from the owner's saved investment-allocation setting (the app's 투자 비율),
falling back to `NUSA_PAPER_INVESTMENT_PERCENT` (default 100).

## Leading hypothesis (not proven)

The owner-side investment percentage reads 0%, so every BUY is sized to zero and rejected before risk. This is consistent with all
four observations above. Writer-lease loss is not a fit for these 4824: it yields FAILED `paper account persistence failed`
inside the loop, after the risk gate.

## How to confirm, cheapest first

1. Owner: open the app's investment percentage (투자 비율) setting and read the value. If it is 0%, that explains it.
2. After the release that includes #2892 (deployed in run 40448780153, not yet read back), `/health` `paperFunnel` will show
   `ORDER_INTENT:FAIL:DECISION_ALLOCATION_ZERO` if this is the cause.

## If confirmed

Setting the percentage is the owner's decision; this note changes nothing. Separately, a code change worth proposing is to
return a coded reason (for example `PAPER_INVESTMENT_PERCENT_ZERO`) and show "투자 비율 0%라 매수하지 않음" in the app, so a 0%
setting is visible instead of looking like a failure. That changes no gate, threshold or capital.
