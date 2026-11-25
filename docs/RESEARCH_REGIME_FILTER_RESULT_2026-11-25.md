# Regime filter screen: result (2026-11-25)

Work order `WO-RESEARCH-20261125-REGIME-FILTER`. Script `scripts/offline-regime-filter-screen.js` was committed with its rules and pass bars (commit `ab97980c0`) before the first run. Offline, read-only, PAPER_ONLY, `authority_impact: none`. Input: the public daily candles of 56 KRW markets fetched by the cross-section screen (PR #3312), kept outside the repository.

Korean summary (한 줄): "상승장이면 보유, 아니면 현금" 규칙 6개를 시험했고, 6개 중 1개(알트 바스켓 + 시장 폭 필터)만 두 구간 모두 기준을 통과했다. 큰 낙폭을 피하는 효과는 보이지만 생존 편향 때문에 수치를 그대로 믿으면 안 되고, 앞으로 쌓일 데이터로 검증할 후보 자격만 생긴다.

## What was tested
Hold the asset on day D+1 only if the regime is "up" at the close of D, else cash; 15 bp a side per switch. Regimes: BTC above its 200-day mean (R200), BTC above its 50-day mean (R50), breadth (at least half of the eligible markets above their own 50-day mean). Assets: BTC alone, and an equal-weight basket of all eligible markets (daily rebalanced). The goal was a smaller drawdown with most of the return, not excess return. K=6, 1599 days 2022-07-10 to 2026-11-24; the last 365 days are the second part (already read by earlier screens).

## Result: 1 of 6 passed both parts (basket + breadth)
| Filter | First part: filtered return / maxDD | Benchmark | Last year: filtered / maxDD | Benchmark | Both |
|---|---|---|---|---|---|
| BTC R200 | +194.8% / 34.5% | +384.6% / 35.3% | -9.5% / 16.8% | -39.5% / 43.5% | fail (first part: no drawdown gain) |
| BTC R50 | +344.1% / 26.8% | +384.6% / 35.3% | -0.9% / 17.3% | -39.5% / 43.5% | fail (drawdown only 24% smaller, bar 30%) |
| BTC breadth | +165.4% / 18.7% | +384.6% / 35.3% | -4.6% / 10.9% | -39.5% / 43.5% | fail (return under half of benchmark) |
| Basket R200 | -50.2% / 78.6% | -12.4% / 68.1% | +0.8% / 26.0% | -55.9% / 58.4% | fail |
| Basket R50 | +32.3% / 58.3% | -12.4% / 68.1% | +3.8% / 25.7% | -55.9% / 58.4% | fail (drawdown only 14% smaller) |
| **Basket breadth** | **+167.9% / 33.7%** | -12.4% / 68.1% | **+2.7% / 19.6%** | -55.9% / 58.4% | **PASS** |

## Reading
- BTC filters cut drawdown in the bad last year (43.5% down to 11-17%) but gave up too much in the first part, where BTC rose strongly.
- The basket benchmark lost money in both parts: a basket of small markets bleeds in bear phases. Breadth avoided most of it (in the market 36% of days) and came out positive in both parts. This is mostly "do not hold alts in a bear market", not a new source of profit.
- Post-hoc check (not part of the pre-registration): charging the daily rebalancing cost of the basket (average turnover 1.8% a day, 15 bp a side) changes little: first part +164.1% / 33.8% drawdown, last year +2.4% / 19.6%.

## Why this is not yet an edge
- **Survivorship:** the basket holds today's tradable markets. Markets that died and left are missing, so in-market returns are biased up. The real basket would do worse.
- **Costs:** 56-coin daily rebalancing and small-market spreads are costlier in practice than 15 bp flat.
- Last year was already read, so the second part is only a filter.
- One of six passing at this strictness is not unlikely by chance (K=6), and the rule has never seen unseen data.
- Capital and order handling for a 56-coin basket are untested; this is a research candidate only, with no order path and no authority.

## What follows
Nothing in code, rules, thresholds, limits, capital or authority changes. If the owner wants it, a separate forward pre-registration can fix this one rule (basket, breadth at least 50 percent over the 50-day mean, daily decision, 15 bp a side) and judge it on data after 2026-12-05 with a drawdown-first test. It is not registered by this document.
