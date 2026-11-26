# Alpha Lab v3: cross-section evidence with anytime-valid tests, and the F2 check (DESIGN PROPOSAL + RESULT, 2026-11-27)

Korean summary (한 줄): 사장님 지시("니가 할 수 있는 최고로", 권장대로 진행)로 알파랩을 **횡단면(56종목 순위) + 언제 봐도 되는 검정(e-값)** 구조로 재설계했다. 합성 자료 실험(F2) 결과: 횡단면은 **같은 예측력에서 샤프를 크게 올리지만**, **수수료가 매일 교체를 망가뜨리고**, 현실적인 순샤프(1~3)는 **1년 안에도 통과가 드물다**(최대 약 22%). 주 1회 교체가 매일 교체보다 나은지는 이 실험이 **보여 주지 못했다**(예측력 정의가 기간마다 달랐다). 기다림을 줄이는 마법은 없다.

Status: **PROPOSAL (design) + RESULT (offline synthetic script), independent review applied (2026-11-27).** PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, FAIL_CLOSED. Owner delegation 2026-11-26: the AI proceeds on its own recommendation and the owner amends afterwards; this never covers Stage B, risk limits, capital, live authority, host releases or release-control merges. Builds on `docs/ALPHA_LAB_2_SMALL_FARM_AND_TRACK_R_DESIGN_2026-11-26.md` and the F1 note. Server-code PRs frozen until 2026-11-28 15:00 KST.

## 1. Why change again
F1 showed that one rule on one time series over 180 days needs a true Sharpe near 5. v3 changes the **unit of evidence** (a daily ranking of many markets, not one price path) and the **test** (an e-process that may be read every day without inflating false passes).

## 2. Design
1. **Hypothesis registry** (roadmap A1): hash, K, state, verdicts; failures kept. Hypotheses come from repeatedly documented effects (momentum, low volatility, volume-shock reversal, breadth), at most about 10 per year, so K stays small.
2. **Cross-section engine**: each rebalance day, rank the 56 KRW spot markets by the frozen signal; hold the top third equal-weight; evidence is the daily excess over the equal-weight basket after 15 bp per side on turnover (long-only tilt; spot has no short). Public daily candles; hosted runner; no host code. Records signals daily, computes the e-process daily (allowed: an e-process is valid at every look).
3. **Test**: mixture betting e-process on the excess, clipped at a predictable scale (4 sd of past days), threshold 1/alpha with alpha 0.0125 per hypothesis under the programme budget. **The exact null is: the conditional mean of the clipped, scaled excess is at most zero.** On real data a no-edge tilt can still have a skewed excess (size or volatility tilts, lottery-like coins), so a PASS means "the clipped excess has a positive mean", not proof of skill; the registration must add a matched random-ranking control. The e-process starts on the first day after registration (its burn-in included); no back-filled or holdout data is used. PASS = shadow candidate only (PAPER-only tracking), then the existing path (shadow ledger, PAPER evidence, owner Stage B, canary).
4. **Track R** unchanged (registered breadth looks). **Data asset** unchanged (trade flow, order book, 1-minute), blind windows unchanged.
5. **Learning** is limited to measured cost and fill models and the list of failed hypotheses; no parameter is fitted to test data.

## 3. F2 result (synthetic only)
Command `node scripts/offline-lab-f2-crosssection-evalue.js 1000` (1,000 runs per row, seed 20261127, script sha256 prefix `2964a940be1e816a`). One-factor t4 model: market vol 3 percent a day, idiosyncratic 3.5 percent, 56 markets, 365 days, 20-day burn-in. The signal predicts the next HOLD days of idiosyncratic return with correlation IC.

| Hold | Cost | IC | Net Sharpe | Gross Sharpe (gross mean / net sd) | Pass by day 180 | Pass by day 365 | Median days, among passing runs only |
|---|---|---|---|---|---|---|---|
| 1 | none | 0 | 0.0 | 0.0 | 0 | 0 (upper 0.004) | - |
| 1 | none | 0.02 | 2.2 | 2.2 | 0.002 | 0.092 | 311 |
| 1 | none | 0.04 | 4.4 | 4.4 | 0.068 | 0.764 | 265 |
| 1 | 15 bp | 0.04 | -1.5 | 4.3 | 0 | 0 | - |
| 1 | 15 bp | 0.06 | 0.7 | 6.5 | 0 | 0.003 | 298 |
| 1 | 15 bp | 0.08 | 2.8 | 8.6 | 0.006 | 0.221 | 307 |
| 5 | 15 bp | 0 | -1.1 | 0.0 | 0 | 0 (upper 0.004) | - |
| 5 | 15 bp | 0.04 | 0.8 | 1.9 | 0 | 0.004 | 340 |
| 5 | 15 bp | 0.06 | 1.8 | 2.9 | 0.001 | 0.031 | 319 |
| 5 | 15 bp | 0.08 | 2.7 | 3.8 | 0.003 | 0.164 | 304 |
| 20 | 15 bp | 0.08 | 1.6 | 1.9 | 0 | 0.024 | 305 |
(Full output: 20 rows; the other rows lie between those shown.)

What it shows: (a) **no false pass** in any null row (upper bound 0.4 percent against 1.25 percent); only the no-cost IC 0 row really tests the false-pass rate (cost rows have a negative mean and are easy), and only under the synthetic symmetric null; (b) the cross-section turns a tiny IC into a large gross Sharpe (IC 0.02 gives about 2.2), much more than one series; (c) **daily rebalancing is destroyed by fees** (about 6 Sharpe of drag). The lower gross Sharpe at longer holds comes from the signal definition (IC is set on the HOLD-day sum, so per-day power is IC divided by the square root of HOLD), **not** from fees, so this run does not show that weekly holding keeps the edge; F2b must compare holds at equal per-day IC; (d) **the e-process is slow**: a net Sharpe near 2.7 passes within a year only about 16 to 22 percent of the time, and almost never within 180 days. The cause of the low power is not measured (at 4 sd the clip rarely binds; the small fixed bet grid is the more likely cause; F2b tests this). A fixed-horizon test would be somewhat faster but cannot be read early.

What it does not show: real data, real cross-market correlation beyond one factor, fill rates, maker fees, or whether any real IC near 0.04 to 0.08 exists after costs. Synthetic bounds only.

## 4. Consequences (AI recommendation, owner may amend)
- **Keep** the cross-section engine and the e-process; choose the rebalance interval only after F2b compares holds at equal per-day IC; always report turnover.
- **Do not promise speed**: realistic edges need about a year of forward data; early passes happen only for large effects.
- **Improve power before registering**: test a less conservative e-process (adaptive bet size, wider clip) in F2b; measure maker-fee execution in shadow; first register at most 3 hypotheses so alpha is not spread thin.
- Track R stays the first live-candidate path.

## 5. Build order (KST)
| Step | Work | When |
|---|---|---|
| V0 | this document and F2, independent review | now |
| V1 | F2b: adaptive e-process power check and equal per-day IC hold comparison (offline) | next |
| V2 | hosted-runner signal recorder and e-process calculator for the cross-section; breadth workflows (first held day 2026-12-06) | after 11-28 15:00, draft PRs, non-author review |
| V3 | first registration (at most 3 hypotheses), evaluated only on days after registration | after V1 and V2 |

## 6. Not done here
No code on the host, no workflow, no market data read, no release, no gate or policy value. No strategy is claimed.
