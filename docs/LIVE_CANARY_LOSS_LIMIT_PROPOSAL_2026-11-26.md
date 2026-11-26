# Proposed loss limits for a first live canary, and the owner's answers of 2026-11-26 (PROPOSAL)

Korean summary (한 줄): 사장님이 "손실한도는 니가 정해"라고 하셔서 **권고안**을 적었다. 자본 금액은 사장님이 정하고, 아래 한도는 전부 **자본(C)에 대한 비율이나 횟수**라서 어떤 금액에도 맞는다. 이 권고안은 **사장님이 서면으로 채택하기 전에는 아무 효력이 없고**, 채택 뒤에도 코드의 정책 파일이 강제하며 AI는 실행 중에 한도를 만들거나 바꾸지 않는다. 한도를 풀 때는 새 서면 승인이 필요하다.

Status: **PROPOSAL.** Nothing here is enabled, enforced or approved. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `aiAuthority=ZERO_AUTHORITY`, FAIL_CLOSED. Stage B and live activation remain the owner's fresh written approvals (`docs/NUSA_PASS_TO_PERMIT_2026-11-25.md`, `docs/LIVE_READINESS_RUNBOOK.md`). Part of `docs/ALPHA_LAB_TO_LIVE_DESIGN_2026-11-26.md` (section 4 lists these numbers as owner only).

## 1. Owner answers recorded (2026-11-26, in chat)
1. **Publish Codex's Alpha Lab branch:** "해". The session cannot reach Codex's Codespace; the owner (or Codex) must push `codex/alpha-lab-research-20261126` as a **draft PR**, and the CORE session then reviews it read-only before S1 (`docs/ALPHA_LAB_PAPER_FOLD_IN_PLAN_2026-11-26.md`). Not yet done.
2. **Live trading is the goal** ("실거래 목표"), read as the answer to "is a defensive-only live use acceptable as a goal": a rule that passes its **registered** conditions counts as a live candidate even if it is a defensive overlay; it must still pass every state of the design. If this reading is wrong the owner says so.
3. **Loss limits:** "니가 정해" for the loss limits; **capital is not delegated** and stays the owner's. The session drafts the limits below as a proposal; they become real only by the owner's written adoption.
4. **Progress report:** weekly (instead of the proposed monthly): every Monday 09:13 KST, a short report from the repository: candidate states and next dates, forward-study status (counts and dates only; no blinded order-book or S2 to S4 holdout values), releases, open owner items.
Still open: which candidate types come first (the default order proposed in `docs/ALPHA_LAB_TO_LIVE_DESIGN_2026-11-26.md` section 10 stands until the owner changes it).

## 2. Principles
- The canary tests the machinery and the cost model, not profit. Its capital C should be an amount the owner can lose entirely.
- Every limit is a ratio of C or a count, so the owner's capital choice scales them; PAPER ratios (`apps/cloud/src/paperRiskLimitScaling.ts`: order 0.2, position 0.5, daily loss 0.1 of capital) are the reference and the live canary is **stricter than PAPER everywhere**.
- Spot, long only, one allowlisted market, one concurrent position (runbook canary profile).
- A breach never auto-recovers: it halts, the kill switch and emergency disable order of the runbook apply, and only a fresh manual activation with a fresh owner confirmation resumes.
- After adoption the limits live in the reviewed policy file, bound to the model version; code may only tighten them; loosening needs a new written owner approval and an independent review.

## 3. Proposed limits (fractions of the owner's canary capital C)
| Limit | Proposed | PAPER reference | On breach |
|---|---|---|---|
| Market and positions | one allowlisted market, one concurrent position (runbook canary profile) | n/a | any other order rejected |
| Max order notional (**buys**; a **risk-reducing sell or a stop that closes the position is exempt** from this cap and may be up to the position size, otherwise a 0.25 C stop could not execute) | 0.10 C | 0.20 C | order rejected |
| Max position / symbol / portfolio exposure (one market, one position) | 0.25 C | 0.5 / 0.5 / 1.0 C | order rejected |
| Per-trade loss cap (a stop that closes the position at this loss) | 0.01 C | none | position closed, trade counted |
| Daily loss (realized + unrealized) | 0.02 C | 0.10 C | halt for the day |
| Weekly loss | 0.04 C | none | halt until the owner reviews |
| Drawdown from peak equity | 0.08 C | none | HALTED, fresh manual activation required |
| Cumulative loss since canary start | 0.15 C | none | canary ends; the owner decides whether to start another |
| Consecutive losing trades (`maxConsecutiveLosses`) | 3 | 3 is the gateway default; Cloud PAPER's own consecutive-loss enforcement is removed (WO-POLICY-20261015), so it is not a PAPER active gate | halt for the day |
| Orders per day (buys and sells together; reaching 0.25 C takes at least three buys of 0.10 C) | at most 6 | none (PAPER limits daily notional at 3 C: a different unit) | order rejected |
| Slippage | halt if the average slippage of the last 10 fills exceeds the model's forecast by 50 percent, or any single fill is worse than forecast by more than 0.30 percent | none | halt, review the cost model |
| Data staleness | no new order if the quote is older than 60 s | none | order rejected |
| Reconciliation, exchange error, abnormal balance drift, stale data, risk-budget breach | immediate halt | halt | HALTED |
**All numbers in this table are the AI's judgement, not derived from data.** The 60 s staleness, the 50 percent and 0.30 percent slippage and the order counts have no empirical basis and no PAPER reference. The limit names map to the contract (`maxDailyLoss`, `maxConsecutiveLosses`, order, position, symbol and portfolio exposure in `packages/contracts/src/global-risk-gateway.ts` and `IndependentRiskLimits`).
Reading: with a 0.25 C position and a 0.01 C stop, a 4 percent adverse move loses 1 percent of C; the daily 0.02 C limit allows two such losses; the 3-consecutive-loss limit is only a backstop, because three 0.01 C stops would already exceed the daily 0.02 C limit (it binds only when losses are smaller than the stop). The cumulative 0.15 C is not a derived worst case: the 0.08 C drawdown halt needs a fresh manual activation, so 0.15 C is reachable only across several restarts. A stop is not a guarantee: gaps, slippage and fees can make a loss exceed 0.01 C (the slippage halts are the control, not the stop). Percentages are proposals, not derived from data: no candidate exists, so none is calibrated to a strategy's own risk. A real policy file would be re-derived from a candidate's shadow evidence (largest adverse move, trade frequency, capacity). Any re-derived numbers are a **new proposal** that needs the owner's written adoption, even when they are tighter than these.

## 4. What this does not do
It does not choose capital, enable any gate, start Stage B, change a PAPER limit or any code, or claim a candidate exists. It sets no minimum canary duration or number of trades (owner decision, after the shadow evidence).

## 5. To adopt, change or reject
The owner records the decision in the policy approval record (a chat message alone is not enough for the policy file); adopting limits is **not** a Stage B approval and enables nothing; the session then turns the adopted numbers into the policy-file template (docs only first), reviewed independently, before any code change after the 2026-11-28 15:00 KST freeze.
