# Cross-sectional daily screen: result (2026-11-25)

Work order `WO-RESEARCH-20261125-CROSSSECTION-SCREEN`. Script `scripts/offline-crosssection-screen.js` was committed with every rule and bar (commit `8f99e771f`) before the first fetch and run. Offline, read-only, PAPER_ONLY, `authority_impact: none`. Public Upbit daily candles only (no key, no order); no order-book value and no S2-S4 holdout value was read.

Korean summary (한 줄): 종목 56개 일봉으로 종목 비교 전략 6가지를 시험했고, 1차 통과 0개였다. 앞으로 검증할 후보는 없다.

## Result
56 markets, 1800 days (to 2026-11-25), K=6, second-filter bar p < 0.05/6 = 8.33e-3, 5 picks per cohort, excess over the equal-weight basket of all eligible markets, 15 bp a side (30 bp stress). **0 passed discovery, 0 passed both.**

| Family | Cohorts | +windows | UP excess | DOWN excess | Discovery | Last-365d cohorts | Mean excess/cohort | p | Second |
|---|---|---|---|---|---|---|---|---|---|
| Low volatility (7 d) | 243 | 4/6 | -0.02% | +0.36% | fail | 51 | +0.17% | 0.32 | fail |
| Short reversal (3 d) | 569 | 0/6 | -0.01% | -0.49% | fail | 121 | -0.20% | 0.83 | fail |
| Volume-spike reversal (3 d, own idea) | 51 | 2/6 | -3.29% | -4.15% | fail | 10 | -2.77% | 0.87 | fail |
| BTC-lag laggards (2 d, own idea) | 64 | 2/6 | -0.15% | -1.69% | fail | 13 | -0.67% | 0.89 | fail |
| Volatility contraction (7 d, own idea) | 227 | 0/6 | -1.43% | -0.80% | fail | 49 | -1.08% | 0.83 | fail |
| Vol-adjusted momentum (7 d) | 243 | 2/6 | -0.13% | -0.76% | fail | 51 | -1.25% | 0.98 | fail |

## Reading
- Low volatility came closest: it beat the basket in 4 of 6 windows and in down windows (+0.36% per cohort), but lost slightly in up windows and failed the UP-window clause. It is a defensive tilt, not an edge; its last-year excess (+0.17%, p 0.32) is small and cannot be told from chance.
- The three own ideas did worse than the standard ones: reversal after a volume spike lost 2.8% to 4.2% per cohort (a fall on heavy volume tends to continue), and BTC-lag laggards lost (the lag, if real, is shorter than a day, so daily candles cannot see it).
- Vol-adjusted momentum was negative. This does not contradict the registered weekly trend (#3308): that study differs in signal (plain 28-day return), universe filter and costs, and is judged forward only.

## Disclosures
- Survivorship: current markets only. Costs: flat 15 bp a side, not per-market spreads. The last cohort exits at the close of the still-open current day. The last 365 days were already read by earlier screens, so the second filter is not a clean holdout.
- Not screened: families needing intraday data or data we do not collect (order book, foreign prices, futures).
- Counting all screens so far: 97 + 12 + 6 = 115 known or own rules screened on history; **none is eligible for a forward pre-registration.**

## What this changes
Nothing in code, rules, thresholds, limits, capital or authority. The remaining sources of evidence are the forward studies already registered (trade-flow v2 11/29, S2-S4 12/05, order-book third run 12/10, S5 12/20, RET48, weekly trend).
