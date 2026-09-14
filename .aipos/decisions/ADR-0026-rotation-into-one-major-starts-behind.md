# ADR-0026: Rotating into one KRW major starts behind the basket, in both directions

## Status

Accepted. Measurement only; no runtime behaviour changes.

## Context

ADR-0025 established that the only signal reaching a live PAPER decision — the 24h change rate
through `CHART_NORMALIZATION_V1` — has no demonstrable forecasting power over 500 days across five
KRW majors. That closed a question about one signal. It left open the obvious next family: rather
than asking *whether* to trade a market, rank the majors and hold the best one.

That family is worth testing before any more signals are built, because if the act of rotating is
itself unprofitable here, the quality of the ranking rule does not matter.

`scripts/alpha/measure-cross-sectional-momentum.js` states the hypothesis, the horizons, the
holdout split and the falsification condition in its header, before any result was seen.

## Measurement

Five KRW majors (BTC, ETH, XRP, SOL, ADA), 500 daily bars each, Upbit public candles. The rule
holds the top-ranked market by trailing k-day return for the following k days, against an
equal-weight basket of the same five as the alternative actually on the table. Every rotation is
charged the round trip this venue imposes: 0.172% — 0.032% spread, 0.05% fee per leg, 0.02%
slippage per leg. The final 30% of the sample, in time order, is a sealed holdout.

Horizons below 24h are not measurable on daily bars and were skipped rather than approximated;
`UPBIT_MAJOR_HORIZON_FLOOR_HOURS` already puts the floor at 8h for cost reasons.

Median excess over the basket, after cost:

| direction | horizon | in-sample | holdout | in-sample win | holdout win |
|-----------|---------|-----------|---------|---------------|-------------|
| MOMENTUM  | 24h     | −0.189%   | −0.169% | 43.1%         | 43.3%       |
| MOMENTUM  | 48h     | −0.593%   | +0.224% | 35.7%         | 54.4%       |
| MOMENTUM  | 96h     | −0.594%   | −0.308% | 41.3%         | 43.2%       |
| REVERSAL  | 24h     | −0.279%   | −0.350% | 39.7%         | 31.3%       |
| REVERSAL  | 48h     | −0.239%   | −0.639% | 46.1%         | 32.9%       |
| REVERSAL  | 96h     | −0.420%   | −0.428% | 44.5%         | 41.2%       |

## Decision

Recorded as NO EDGE DEMONSTRATED for the cross-sectional rotation family on this venue, at these
horizons, under this cost model.

The result that matters is not either direction on its own. **Both** directions lose to the basket
at every horizon, which means the loss is not coming from the ranking rule. Two things are being
paid regardless of which market the rule picks: the 0.172% round trip on every rotation, and the
diversification given up by holding one asset instead of five. A ranking signal has to recover both
before its quality is even legible. Nothing tested here recovers either.

So the next candidate in this family should not be a better ranking rule. It should be a reason to
believe the concentration penalty is smaller than measured — a longer holding period that amortises
the round trip, or a subset of majors whose dispersion is wide enough that picking pays.

## What would overturn this

A rotation rule whose median excess clears the round trip in **both** halves with a win rate above
0.5, on effective independent samples rather than overlapping ones. The 48h MOMENTUM holdout is the
closest thing here and is not that: its in-sample median is −0.593% against a +0.224% holdout, on 74
effective samples. A holdout that looks better than in-sample is the signature of a regime, not of
validation — the same tell recorded in ADR-0023 and ADR-0025.

## Honesty about the search

Six hypotheses were tested: two directions across three horizons. REVERSAL was **not** independent —
it was tested because MOMENTUM came back negative, so the first result chose the second test. Both
directions are printed by the script whatever they show, so the search cost stays visible rather
than being hidden by reporting only a survivor. With six tests behind it, a single nominally
positive cell would not have been evidence of anything, which is why the decision rule was fixed to
require both halves before any result was seen.

## Safety

Measurement only. `liveAuthority=NONE`, `productionMutationAllowed=false`, AI remains
`ZERO_AUTHORITY`. No strategy, registry entry, or execution path is added or changed by this ADR.
