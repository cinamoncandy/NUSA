# Alpha Lab to live trading: a design of the whole route (DESIGN, 2026-11-26)

Korean summary (한 줄): 알파랩이 후보를 찾고 검증하고, 그림자 기록과 허가 절차를 거쳐 사장님이 승인한 한도 안에서만 실거래(소액 카나리아)에 이르는 **전체 경로의 설계안**이다. 승인이나 일정 약속이 아니다. 실거래, 자본, 위험 한도, Stage B는 전부 사장님만 정하며 이 문서는 숫자를 정하지 않는다. 지금까지 후보가 하나도 통과하지 못해서, 이 설계는 "못 찾으면 어떻게 하는가"까지 포함한다.

Status: **DESIGN only.** No code, no gate, threshold, limit, capital or authority change; nothing is approved. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `aiAuthority=ZERO_AUTHORITY`, FAIL_CLOSED. Owner request 2026-11-26: "알파랩을 이용한 새 설계를 짜 실거래까지 가도록". Builds on `docs/ALPHA_LAB_PAPER_FOLD_IN_PLAN_2026-11-26.md`, `docs/NUSA_PASS_TO_PERMIT_2026-11-25.md`, `docs/NUSA_PERMIT_PRODUCER_DESIGN_2026-11-16.md`, `docs/NUSA_STAGE_B_AND_NEXT_PLAN_2026-11-16.md` and `docs/LIVE_READINESS_RUNBOOK.md`; none of them is changed here.

## 1. The honest starting point
- 141 rules were screened on history (97 known families, the famous-investor rules, regime filters, scalping, desk batch 1); **none is eligible** for forward registration as a trading rule. The surviving research items are forward studies: the breadth filter (a defensive overlay on a basket, looks L30/L60 reject-only, L90 provisional, L183 confirm), the weekly trend (L13 strict, L26 confirm), tradeflow v2 (2026-11-29), S2 to S4 (2026-12-05), the order-book third run (2026-12-10), S5 (2026-12-20).
- The cost wall: fee 0.05 percent per side plus spread; the history screens of this programme found reversion edges below the fee alone per trade (see `docs/RESEARCH_STRATEGY_COLLECTION_2026-11-25.md`, scalping and reversion results), so they do not clear it. Frequent rules lose to cost, slow rules take months to prove.
- So the design must (a) raise the quality of candidates, (b) make each step cheap to reject, and (c) say plainly when to stop. It cannot promise that a live strategy exists.

## 2. The five lanes of Alpha Lab
1. **Intake.** Hypotheses come from the strategy collection, the desk method (a proposer writes hypotheses and a pre-registration with reasons and bars; the AI has no order authority and proposes only), and owner ideas. Nothing enters without a frozen hash taken before any data is read.
2. **History screen** (offline, cheap): costs 15 bp per side daily and 10 bp per side 5-minute, stress doubled, Bonferroni with K counted, six-window discovery, a second filter, survivorship and fill-at-close disclosures. Output: HISTORY_PASS or HISTORY_FAIL. A pass is a lead, never a promotion.
3. **Forward registration** (hosted runners, no host code): fixed looks with early reject, a strict early pass and a confirmation, as in the breadth and weekly-trend amendments; a FAIL is not re-run on the same span.
4. **Shadow** (the PAPER fold-in, plan S4 and S5): the candidate's decisions and outcomes are logged append-only with cost fields and no order path; a maker-fill model, if the candidate relies on limit orders, is validated here (fill probability and adverse selection are measured, not assumed).
5. **Permit and execution ladder** (existing design, owner gated): calibration, net-EV model, capacity and slippage forecast, a second independent model, the reviewed policy file, the permit producer, then the live readiness ladder.

## 3. Candidate states and who may move them
| From -> to | Evidence | Decided by |
|---|---|---|
| IDEA -> FROZEN | hypothesis and rules hashed before data | code (hash) and a non-author reviewer |
| FROZEN -> HISTORY_PASS or FAIL | script output, disclosures | code; independent review of the note |
| HISTORY_PASS -> FORWARD_REGISTERED | pre-registration merged before the first held day | independent review; merge by the bot, never by the author session |
| FORWARD_REGISTERED -> FORWARD_PASS or FAIL | the registered looks only | code on a hosted runner |
| FORWARD_PASS -> SHADOW | an owner-approved shadow policy; the shadow ledger exists (S4) | **owner** |
| SHADOW -> SHADOW_EVIDENCE_OK | enough labelled outcomes under the policy's minimum, calibration and net-EV on the same outcome definition | code; independent review |
| SHADOW_EVIDENCE_OK -> PERMIT_READY | the permit producer writes PERMIT with all inputs | code (every input present, else REJECT) |
| PERMIT_READY (the producer is verified able to issue PERMITs for this candidate; a PERMIT itself is still written per order intent) -> STAGE_B (orders ON, still PAPER) | fresh written approval naming "Stage B" | **owner only** |
| STAGE_B -> CANARY (first real order) | the live readiness ladder green and a manual activation ceremony | **owner only** |
| CANARY -> BOUNDED_LIVE | the canary's own evidence and the owner's decision | **owner only** |
A FAIL anywhere is terminal for that frozen rule; a changed rule is a new candidate with a new hash and K count. Any state can drop back (a gate going red, a drift alarm) and never moves up automatically.

## 4. What is owner only (this document sets none of it)
Capital, the position cap, every loss limit and risk threshold, the policy file's numbers (minimum calibration samples, regimes), Stage B, the activation ceremony, the canary size and duration, any release or restart of the host, the order of candidates. The design only requires that each number exists, is written down before use, is bound to the model version and is enforced in code. No AI session approves or merges its own work, and `aiAuthority=ZERO_AUTHORITY` holds at every state, including after live.

## 5. The live ladder (from the runbook, referenced not changed)
Steps 1 to 7 of `docs/LIVE_READINESS_RUNBOOK.md`: stable PAPER evidence, replayable SHADOW evidence from the same governed path, a healthy read-only account monitor with a known identity, governance and TradePermission gates and bounded risk, reconciliation and no-double-order and kill-switch and exchange-fault tests, all protected exact-head workflows green, then the `LiveReadinessGate`; only `READY_FOR_MANUAL_ENABLE` may expose an activation control. The canary profile, emergency disable (kill switch first, lease revoked, flags false, read-only reconciliation, no automatic re-enable) and rollback are as written there.

## 6. Time: how fast could it honestly go
The speed is set by trades per week of the candidate (`docs/NUSA_PASS_TO_PERMIT_2026-11-25.md` section 4: about 100 labelled outcomes in about 3 weeks for a five-pick daily rule, about 20 weeks for a weekly rule, days for an hourly rule). These figures count **from the shadow start**; they are not the total time to live.
**Scenario, not a forecast.** A forward verdict is final only at the confirming look: the breadth filter's L90 pass (2027-03-07) **stands only if L183 (2027-06-07) also passes**, and the weekly trend's early pass at L13 (2027-03-08) is valid on its own at alpha 0.01 but otherwise confirmation is at L26 (2027-06-07). So FORWARD_PASS exists at the earliest on 2027-03-08 (weekly trend, strict) and otherwise from 2027-06-07. Shadow evidence would start after that (the shadow ledger must exist by then), calibration, policy and permit work follow, and a first canary is realistic **no earlier than the second half of 2027**, and only with the owner's approvals. Optional pre-work (building the shadow ledger, the policy template) may start earlier at the owner's choice; it is not a state move. If nothing passes, there is no live date. The freeze until 2026-11-28 15:00 KST applies; "no host release before 2026-12-10" is the session's plan, not an owner rule.
Note on the breadth filter: it is a rule for holding an equal-weight 56-market KRW basket or cash (a defensive overlay), not a standalone alpha. It yields no per-decision labelled outcomes, so the outcome-count figures above do not apply to it; going live with it would need multi-market basket execution and rebalancing in the permit and risk design and a different evidence definition. That is an open design item, not a given.

## 7. What must be built (owner decides the order; none is started by this document)
1. PAPER fold-in S1 to S6 and the shadow ledger (plan; implemented by the CORE session after the freeze).
2. Hosted-runner fetch and evaluate workflows for the registered forward studies (own work orders after the freeze).
3. The permit producer part 2 (draft #3179), the calibration and net-EV models, a second independent model, the capacity and slippage forecast: only when a candidate exists (decision 2 of 2026-11-16 stands).
4. A maker-fill model validated in shadow, if limit orders are the cost answer (direction B of 2026-11-26).
5. The Lab tab of the phone app showing the candidate list with its state and the next date, from server facts only: nothing invented, "none yet" when there are no candidates.

## 8. Stop rules (so the search does not run forever)
- By the registered final looks (2027-06-07 for the weekly trend and the breadth filter) every active candidate has a verdict. If none passed, the record says so and the owner is asked once: widen the scope (futures, foreign venues, other horizons), accept a defensive-only use of a **registered pass** (or of a separately pre-registered use) in PAPER, or stop the strategy search; a FAIL is never rescued by this option.
- No new hypothesis family without a stated reason and a K count; no re-run of a failed rule on the same span; no gate, threshold or bar loosened to produce a pass.

## 9. Safety
Every state change is recorded in AIPOS with its evidence hash and reviewer. The kill switch and `liveAuthority=NONE` are the default at every state; live authority exists only inside the owner's manual activation window and lease. Synthetic or backfilled performance is forbidden at every state.

## 10. Open questions for the owner
1. Which candidate types come first: low-turnover limit-order rules (direction B), the defensive breadth overlay, the weekly trend, or new families?
2. Is a defensive-only live use acceptable as a goal at all, or must a candidate show positive net edge over holding?
3. When may the capital policy and loss limits be discussed (they gate the policy file, not the research)?
4. The review cadence: a monthly pipeline report to the owner (counts, states, dates; no values from blinded data).

## 11. Not done here
No code, workflow, run, release, policy value, capital or limit; no claim that a candidate exists; no live date.
