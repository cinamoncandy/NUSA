# Short-term (5-minute) screen: result (2026-11-25)

Work order `WO-RESEARCH-20261125-SCALP-SCREEN`. Script `scripts/offline-scalp-screen.js` was committed with every rule and bar (commit `7bc95aea0`) before the first fetch and run. Offline, read-only, PAPER_ONLY, `authority_impact: none`. Public Upbit 5-minute candles of KRW-BTC, ETH, XRP, SOL, DOGE from 2025-11-05 to 2026-11-04 (104,712 bars each). **Nothing from 2026-11-05 on was fetched or read** (S2-S4 holdout stays unread); no order-book value was used.

Korean summary (한 줄): 5분봉 단타 규칙 8가지를 1년치로 시험했고 통과 0개였다. 반전형은 비용을 빼기 전에는 한 번에 +0.05~0.08% 벌었지만, 왕복 비용 0.2%에 먹혔다.

## Result
8 rules (K=8), long only, fixed holds of 30 to 180 minutes, taker cost 10 bp a side (20 bp round trip), stress 15 bp. Part 1 = first 275 days (6 windows), part 2 = last 90 days. **0 passed part 1, 0 passed both.**

| Rule | Trades (part 1) | Gross/trade | Net/trade | Positive windows | Part 2 net/trade |
|---|---|---|---|---|---|
| Momentum burst, hold 30 min | 2334 | -0.030% | -0.229% | 0/6 | -0.218% |
| Momentum burst, hold 60 min | 2068 | -0.020% | -0.220% | 0/6 | -0.188% |
| Reversal after a drop, 30 min | 2162 | +0.050% | -0.151% | 0/6 | -0.151% |
| Reversal after a drop, 60 min | 1916 | +0.056% | -0.144% | 0/6 | -0.141% |
| 4-hour breakout with volume, 60 min | 2820 | -0.043% | -0.243% | 0/6 | -0.204% |
| 4-hour breakout with volume, 180 min | 2182 | -0.059% | -0.259% | 0/6 | -0.136% |
| Bollinger reversion, 30 min | 4228 | +0.079% | -0.122% | 0/6 | -0.096% |
| Bollinger reversion, 60 min | 4016 | +0.075% | -0.125% | 0/6 | -0.082% |

## Reading
- **Momentum and breakout rules have negative gross returns**: chasing a 15-minute burst or a 4-hour high loses before any cost.
- **The two reversion families show a small positive gross edge (+0.05% to +0.08% per trade)**, consistent with a small over-reaction after sharp drops. It is smaller than the cost: a taker round trip is 0.20%.
- **Even perfect maker fills would not rescue it.** The exchange fee alone is 5 bp a side, 10 bp round trip, which is above the best gross edge (0.08%) before any spread or adverse selection. So within this fee schedule these rules cannot pay, however the orders are placed.
- The result is the same in every window and in both parts, so it is not a lucky split.

## Disclosures
- Candle-only: no spread, queue position, partial fills or latency; long only; five large markets only (small markets have wider spreads, so they are worse); the second part overlaps prices read at 60-minute resolution by earlier screens.
- This does not test order-book or trade-flow signals; those are the forward studies already registered (trade-flow v2 on 2026-11-29, S3 2026-12-05, order-book third run 2026-12-10, S5 2026-12-20).

## What this changes
Nothing in code, rules, thresholds, limits, capital or authority. No forward pre-registration follows from this screen. Counting all history screens so far: 97 + 12 + 6 + 6 + 8 = 129 rules, none eligible.
