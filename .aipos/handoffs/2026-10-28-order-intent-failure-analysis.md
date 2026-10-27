# ORDER_INTENT failure analysis — 2026-10-28 (static code analysis plus the owner's app reading; not yet confirmed on the host)

Author: CORE session. Scope: read-only analysis for phase 1 of `docs/PROPOSAL_TARGET_ARCHITECTURE_2026-10.md`.
No code, setting or host change. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.
Revised after the non-author review on PR #2910 (CHANGES REQUESTED: long coded reasons, evidence window).

## Evidence and its window

Diagnosis run 40275442510 read `/health` of the process that started 2026-10-26T00:30Z on runtime `c59b522`. Its funnel counts
cover that process only, about 5 hours, not 2026-10-18..27. In that window:

- `DECISION:PASS:BUY = 4824` and `ORDER_INTENT:FAIL = 4824`: every BUY decision failed at order intent.
- No `RISK:*` key: `runtime.ts` records RISK only when `result.risk != null`, so every BUY stopped before the canonical risk gate.
- No `ORDER_INTENT:FAIL:<CODE>` detail key.
- Ledger `lastFillAt` 2026-10-18; `paperOrderCount = 0`. The cause on 2026-10-18..25 may differ and is not observed.

Owner's app on 2026-10-28 08:32 KST (settings screen): investment percentage (현금 투자 비중) **100%**, investable cash **₩8,398**,
protected cash ₩0.

## Why "no detail key" does not mean "free text"

`funnelReasonCodes` keeps only pieces matching `/^[A-Z][A-Z0-9_]{1,47}$/`, so a code longer than 48 characters is dropped like free
text. On `c59b522` these pre-risk BLOCKED codes therefore leave no detail key (found by the reviewer with the compiled function):

`PAPER_EXECUTION_INTENT_MINIMUM_ORDER_EXCEEDS_CASH`, `PAPER_EXECUTION_INTENT_MINIMUM_ORDER_EXCEEDS_EQUITY_CEILING`,
`PAPER_EXECUTION_INTENT_EXECUTABLE_QUOTE_BELOW_MINIMUM`, `PAPER_EXECUTION_INTENT_PORTFOLIO_ALLOCATION_REQUIRED`,
`PAPER_EXECUTION_INTENT_PORTFOLIO_ALLOCATION_MISMATCH`, `PAPER_EXECUTION_INTENT_ALLOCATION_EXCEEDS_DECISION`,
`PAPER_EXECUTION_INTENT_PORTFOLIO_DECISION_MISMATCH`, `PAPER_EXECUTION_INTENT_ACCOUNT_PORTFOLIO_MISMATCH`,
`PAPER_EXECUTION_INTENT_CANDIDATE_BINDING_REQUIRED`, plus the free-text `decision allocation is zero`.

## Candidates

1. **Account too small for the exchange minimum (leading candidate).** `applyExchangeMinimumOrder` (`paperExecutionIntent.ts:25-37`)
   raises a BUY below the minimum to `5,000 × 1.01 = 5,050 KRW`, but refuses when `5,050 > equity × 0.6`, that is when
   **equity < about 8,417 KRW** (`…_MINIMUM_ORDER_EXCEEDS_EQUITY_CEILING`), or when `5,050 × 1.005 > cash`
   (`…_EXCEEDS_CASH`). The app shows ₩8,398 investable cash; if the account holds no position, equity ≈ ₩8,398 < ₩8,417, and
   every BUY whose planned capital is below 5,050 KRW (all of them, at this account size) is blocked before risk.
   This rule protects against one order taking most of a small account; it must not be loosened.
2. **Investment percentage 0%** (`decision allocation is zero`): **ruled out for now**, the app reads 100%. Whether it was 0% on
   2026-10-26 is not known.
3. **No BUY allocation in the portfolio plan for the market** (`…_PORTFOLIO_ALLOCATION_REQUIRED`) or another long code above:
   possible, not excluded by the evidence.
4. Writer-lease loss: does not fit these 4824 (it fails inside the loop, after the risk gate).

## How to confirm, cheapest first

1. Owner: read total PAPER assets (cash plus open positions) in the app. Below about ₩8,417 supports candidate 1.
2. After the release that includes #2892 (deployed in run 40448780153, not yet read back), `/health` `paperFunnel` shows either
   `ORDER_INTENT:FAIL:DECISION_ALLOCATION_ZERO` (candidate 2) or `ORDER_INTENT:FAIL:BLOCKED_UNCODED_REASON` (candidate 1, 3 or
   another long code; the long codes all collapse into that one bucket).

## If candidate 1 is confirmed

The rule is working as designed: a ₩8,398 account cannot place a ₩5,050 order without exceeding 60% of equity. Restoring trading is
an owner decision about PAPER capital (for example a governed reset or top-up of the PAPER account), not a code fix, and this
session does not change capital. Display-only follow-ups that change no gate:

- map the long codes to short funnel codes (or raise the 48-character cap) so `/health` names the exact reason;
- show "자산이 최소 주문(₩5,050)의 기준보다 작아 매수하지 않음" in the app instead of a silent stop.
