# ADR-0025: The live signal has no demonstrable edge

## Status

Accepted. Measurement only; no strategy is promoted or retired by this record, no
LIVE, real-money, credential, or production-mutation surface is touched.

## Context

`upbitTickerObservation.ts` is the only producer of intelligence observations in
the running system. Its score is the 24-hour change rate through
`CHART_NORMALIZATION_V1` — zero inside a 0.2% dead zone, otherwise the change
divided by a 3% reference move and clamped to ±1. That score is weighted by
turnover confidence, fused, and handed to `decideCio`, which is what causes a
PAPER order.

ADR-0024 established that this horizon at least clears the cost floor, which the
order-book alpha never could. That made the next question answerable for the
first time: does the score forecast anything?

Nothing in the repository had asked. The evaluation framework — calibration,
multiple-testing correction, dependence groups, abstention — had never been given
a number to score.

## Method, fixed before running

`scripts/alpha/measure-chart-signal-edge.js`, 3000 hourly candles per market
(2026-05-08 to 2026-09-10) on KRW-BTC, KRW-ETH and KRW-XRP. Signal at each hour
is the 24h change ending there; forward return runs to +24h. Reported per market
and pooled: Spearman IC, and for every bucket the mean, the median, the excess
over the unconditional forward return, and the share of windows that rose.

Three guards were added after a first pass looked encouraging, because the first
pass reported only means:

- **Median beside mean.** A bucket whose winners are fewer than half its windows
  is a tail bet; the mean can be carried by a few large moves a live strategy
  would have to survive the drawdown to collect.
- **Unconditional baseline.** In a rising period every bucket looks good and none
  of it is the signal.
- **Effective independent samples.** Adjacent windows share 23 of 24 hours, so
  the honest count is n/24 — about 123 per market, not 2,952.
- **Split-half.** A finding that holds in one half and reverses in the other was
  a property of the period.

## Result

Pooled IC: +0.0117 at 8h, +0.0440 at 24h. Small, and at 8h indistinguishable
from noise (BTC +0.039, ETH +0.008, XRP −0.014).

The `STRONG_UP` bucket at 24h, which the first pass made look like an edge:

| Market | Mean | **Median** | Share up | Excess over baseline |
|---|---|---|---|---|
| BTC | +0.550% | **+0.243%** | 0.566 | +0.619% |
| ETH | +0.388% | **−0.037%** | 0.481 | +0.364% |
| XRP | +0.914% | **−0.345%** | 0.427 | +0.936% |

XRP's mean is +0.91% while its median is −0.345%: more than half of those windows
lose, and a handful of large winners carry the average. That is a lottery
profile, not an edge. ETH is the same shape.

Split-half, `STRONG_UP` excess over baseline:

| Market | First half | Second half |
|---|---|---|
| BTC | +0.504% (share up 0.656) | +0.754% (share up **0.464**) |
| ETH | **+1.013%** | **−0.228%** |
| XRP | +0.378% | +1.828% |

ETH reverses sign. BTC keeps its excess but its win rate falls below half. XRP
swings by a factor of five.

## Decision

**Record that no edge is demonstrated, and do not build on this signal as though
one were.**

BTC alone shows a coherent profile — positive median, majority of windows up,
excess over baseline. It is one market out of three, over four months, with
roughly 123 independent observations. Selecting it because it worked is exactly
what `aiEvaluationMultipleTestingCorrection.ts` exists to prevent, and this is the
first time that module has had a live case to apply to.

This is not a finding that the signal is worthless. It is a finding that four
months across three majors cannot tell the difference between this signal and
none, and that the shape of what looked positive — fat tails, sub-50% win rates,
sign reversal between halves — is the shape of noise rather than of edge.

## Consequences

`calibrationStatus` staying `UNVERIFIED` in the AI view is now known to be
correct rather than an integration gap: there is nothing calibrated to report.

What would change the answer is more history and an out-of-sample split that was
never looked at while choosing. The script takes `--markets` and `--candles` and
is the record of how; Upbit serves hourly candles well past this window.

Two ADRs now bound this project's alpha work. ADR-0024: a taker strategy needs a
horizon of eight hours or more on Upbit KRW majors. This one: the signal that
occupies that horizon today has not been shown to forecast anything.
