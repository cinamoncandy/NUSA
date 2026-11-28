# Famous-trader discovery screen: result (2026-11-25)

Work order `WO-RESEARCH-20261125-FAMOUS-SCREEN`. Script `scripts/offline-famous-screen.js` was committed with its rules and bars (commit `4240d0351`) before the first run. Offline, read-only, PAPER_ONLY, `authority_impact: none`. No order-book value and no S2-S4 holdout value was read.

Korean summary (한 줄): 유명 트레이더 규칙 7가지(12개 설정)를 과거 차트로 시험했고, 1개만 1차를 통과했으며 2차에서 탈락했다. 앞으로 검증할 후보는 없다.

## Result
12 configurations (K=12), second-filter bar p < 0.05/12 = 4.17e-3. **1 passed discovery, 0 passed both.**

| Configuration | +windows | UP mean | DOWN mean | Discovery | Last-part trades | Mean/trade | 2x cost | p | Second filter |
|---|---|---|---|---|---|---|---|---|---|
| 60m Darvas box | 2/6 | +10.40% | -4.72% | fail | 12 | +5.49% | +5.28% | 0.079 | fail |
| 60m Livermore pivot | 2/6 | +8.12% | -4.35% | fail | 20 | +2.02% | +1.82% | 0.263 | fail |
| 60m O'Neil base | 2/6 | +5.74% | -2.41% | fail | 9 | +3.38% | +3.17% | 0.082 | fail |
| 60m Raschke pullback | 2/6 | +4.04% | -2.97% | fail | 16 | -0.03% | -0.23% | 0.513 | fail |
| 60m Volume spike | 2/6 | +12.28% | -9.02% | fail | 77 | +1.32% | +1.12% | 0.026 | fail |
| 1d Darvas box | 4/6 | +35.47% | -10.74% | fail | 24 | -3.51% | -3.70% | 0.996 | fail |
| 1d Livermore pivot | 5/6 | +47.17% | -18.15% | fail | 35 | -2.53% | -2.72% | 0.985 | fail |
| **1d O'Neil base** | **6/6** | +27.05% | +4.54% | **PASS** | 11 | +0.92% | +0.72% | 0.272 | fail |
| 1d Raschke pullback | 3/6 | +27.33% | -0.80% | fail | 30 | -1.10% | -1.30% | 0.923 | fail |
| 1d Volume spike | 4/6 | +21.91% | -8.29% | fail | 11 | +4.46% | +4.25% | 0.071 | fail |
| 1d Minervini template | 3/6 | +14.96% | +0.00% | fail | 5 | -2.66% | -2.86% | 0.999 | fail |
| 1d Weinstein stage 2 | 5/6 | +35.23% | -17.45% | fail | 10 | -6.29% | -6.47% | 0.992 | fail |

## Reading
- The common shape is the one seen before: positive in up markets, negative in down markets. These rules ride the trend and lose when it turns; the ten that failed discovery have a DOWN-window loss.
- **The one discovery pass (1d O'Neil base) is not a candidate.** It traded 11 times in the last part (p = 0.27, bar 4.17e-3, and the Research gate asks for 50 trades). Its +4.5% DOWN-window mean rests on few trades. With K=12 and one pass at this level, a chance pass is not unlikely.
- 60m volume spike has p = 0.026 and 77 trades but failed discovery (2 of 6 windows positive) and does not clear the K-corrected bar.

## Disclosures
- The last part of each series (120 days of 60m, 365 days of daily) was already read by the 2026-10-13 catalog screen; here it is only a second filter, not a clean holdout.
- 5 markets, long only, fills at the close; rule definitions are simplified readings of public descriptions, not the traders' own rules; low-volatility and cross-section families were not screened (5 markets are too few).
- Combined with the 2026-10-13 catalog (97 rules, 0 pass), **109 known rules have now been screened on history and none is eligible for a forward registration.**

## What this changes
Nothing in code, rules, thresholds, limits, capital or authority. No forward pre-registration is proposed from this screen. The owner's two-stage path (history first, then forward) works as designed; this round simply produced no survivor.
