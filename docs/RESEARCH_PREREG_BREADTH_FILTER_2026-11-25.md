# Pre-registration: market-breadth filter on an equal-weight basket, judged forward (2026-11-25)

Status: **OWNER-REQUESTED ("사전등록해", 2026-11-25 KST), registers on merge, before any forward data exists.** The registration must be merged before **2026-12-06T00:00Z**; if it is merged later the study is not registered (no back-dating). Work order `WO-RESEARCH-20261125-PREREG-BREADTH-FILTER`. Follows `docs/RESEARCH_REGIME_FILTER_RESULT_2026-11-25.md` (history screen, 1 of 6 passed; PR #3313). Docs only: no code, workflow, host, release, rule, threshold, gate, risk limit, capital or authority changes. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`. **This is research. It places no orders and has no order path.**

Korean summary (한 줄): 종목 56개 바스켓을 "절반 이상이 50일선 위일 때만" 들고 아니면 현금으로 두는 규칙 하나를, 2026-12-06부터 쌓이는 데이터로 약 6개월 본 뒤 2027-06-07에 딱 한 번 판정한다. 목표는 시장을 이기는 것이 아니라 하락장 낙폭을 줄이는 것이다.

## 1. Question
Does holding a broad KRW altcoin basket only when market breadth is up cut the maximum drawdown clearly, while keeping a reasonable part of the return, on data that did not exist when the rule was fixed?

## 2. The rule (nothing is fitted; one rule, one test)
- **Universe (fixed list):** the union of `discoveryPool` and `forwardPool` plus `KRW-BTC` of `docs/research-data/broad-universe-filter-count-20bp-2026-11-24.json` (the 56 markets of the history screen). The list is fixed at registration; markets listed later are not added.
- **Eligible on day D:** at least 90 daily candles up to and including D, a candle for D, and no missing candle among the last 50 (no gap filling). A candle is closed if its timestamp + 24 h <= the fetch time. Fewer than 10 eligible markets: the day is held as cash and logged. All returns are compounded; drawdown is peak-to-trough of the daily compounded equity curve (fractions, not percentages).
- **Day D** is the UTC day of a daily candle; the candle of D closes at D+1 00:00Z. **Signal at the close of D** (uses candles dated D and earlier): breadth = share of eligible markets with close(D) above the simple arithmetic mean of their own last 50 consecutive UTC daily closes (D included). **Breadth >= 0.5: hold the equal-weight basket of the eligible markets over day D+1 (close D to close D+1); else cash.**
- **First signal day D = 2026-12-05** (first held day 2026-12-06); **last signal day D = 2027-06-05** (last held day 2027-06-06, closed 2027-06-07T00:00Z). The lookback uses candles that exist already; only held days from 2026-12-06 count.
- **Costs:** 15 bp times the position change as a fraction of equity (1.0 on a full switch in or out; stress 30 bp). The basket is rebalanced daily over the eligible set of D at no cost (optimistic; the same for the benchmark). Cash earns 0. A market return of -100 percent is allowed (no floor). The benchmark is charged one entry cost at the start only.
- **Benchmark:** the same basket always invested, same days, same costs.
- A market with no candle on D+1 (delisted or missing) is held at close(D) for that day (return 0) and is excluded from the next signal day onward; a missing candle is not forward-filled, and the loss of a delisted market stays in the result.

## 3. Test (fixed, one decision)
Computed once on a GitHub-hosted runner after **2027-06-07T03:00Z** (the same date as the weekly-trend study), from public daily candles fetched after that time. Pass requires **all** of the following seven conditions:
1. Maximum drawdown of the filtered version <= 0.7 x the benchmark's.
2. Net return of the filtered version >= 0.5 x the benchmark's if the benchmark's net return is positive, else >= the benchmark's.
3. Return per unit of drawdown (net return / max drawdown, defined only when max drawdown > 0; if the filtered max drawdown is 0 the ratio counts as +infinity only if its net return > 0, else condition 3 fails) of the filtered version exceeds the benchmark's when both net returns are positive; otherwise the filtered net return >= the benchmark's.
4. Stress (30 bp) net return of the filtered version >= the benchmark's stress net return.
5. Placebo: 10,000 random on/off schedules, each with exactly H invested days and exactly S switches (H and S of the filtered run; schedules drawn in a fixed order from mulberry32 with seed 20261206, one 32-bit draw per step), same universe, eligibility, costs and equity convention; the filtered maximum drawdown must be strictly smaller than in at least 9,500 of the 10,000 (ties count against the filter).
6. Activity: the filter is invested on at least 20 percent and at most 90 percent of the held days (else FAIL, an always-cash or always-in rule cannot pass).
7. If the benchmark's net return is negative, a pass additionally requires the filtered net return > -0.5 x |the benchmark's net return|, and it is reported as a **defensive-only pass**.

**Not informative** is evaluated first: if the benchmark's maximum drawdown over the span is below 20 percent (no real bear phase), or fewer than 150 of the 183 signal days have at least 10 eligible markets (data failure), the result is recorded `NOT_INFORMATIVE`: not a pass, not a fail. All conditions are still computed and published, labelled non-decisive. The study may then be extended only by a new pre-registration.

**Timing and fetch:** the evaluator computes every signal after the run from the stored candles, with the fetch times logged. One fetch after 2027-06-07T03:00Z; if it fails it is retried unchanged. No rule or number changes after registration.

## 4. What a pass means
Only eligibility for the owner to consider a separately decided PAPER-only use of the rule (it would go through the existing trade-permission chain; `docs/NUSA_PASS_TO_PERMIT_2026-11-25.md`). It is not evidence of an edge, not a promotion, and gives no live authority. Stage B and live trading remain owner-only decisions.

## 5. Disclosures
- The rule came from a history screen on the same 56 markets (1 of 6 filters passed; survivorship, flat costs, an already-read last year). The forward test is the real one. K for the whole family of studies is not controlled across studies (no family-wise correction is stated); this is one decision under the seven conditions above.
- Survivorship of the fixed list continues: delisted markets are kept as losses, but markets that never entered the list cannot appear.
- The result depends on the market: with no bear phase the study says nothing (`NOT_INFORMATIVE`). Power was not computed. One six-month window holds at most one or two market cycles, daily returns are autocorrelated, and conditions 1 to 4 are not significance tests, so the placebo (condition 5) is the only inferential condition; even a pass is weak evidence.
- The daily candle of the last signal day closes at 2027-06-07T00:00Z; the run is at 03:00Z so the candle is closed.
- The fetch workflow and the evaluate workflow are separate hosted-runner work orders and PRs; neither touches the PAPER host or any setting.

## 6. Not done
No code, workflow, run or data read by this document. Gates, thresholds, risk limits, capital and authority are unchanged.
