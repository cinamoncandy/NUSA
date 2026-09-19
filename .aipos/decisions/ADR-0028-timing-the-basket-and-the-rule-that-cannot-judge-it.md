# ADR-0028: Timing the basket is rejected, and the rule that rejected it cannot judge this family

## Status

Accepted. Measurement only; no runtime behaviour changes. Extends ADR-0026 and ADR-0027.

## Context

ADR-0026 found that rotating into the single strongest of five KRW majors lost to holding the
basket, in both directions of the ranking rule, at every horizon. It attributed the loss to two
charges — the 0.172% round trip on every rotation, and the diversification given up by holding one
asset instead of five — and named the only useful next move:

> the next candidate here should not be a better ranking rule; it should be a reason to believe the
> concentration penalty is smaller than measured.

ADR-0027 tested the two remaining reasons to believe that penalty could be paid (amortisation over
longer holds, and conditioning on dispersion) and rejected both, 0 of 12.

This ADR takes the other available answer to ADR-0026's question: **do not concentrate at all.**
Hold the whole equal-weight basket and decide only whether to be in it. That candidate pays the
diversification charge never, and the round trip only when the state actually flips rather than on
every rebalance. It is absolute (time-series) momentum — a different driver from the cross-sectional
momentum ADR-0026 rejected, because it asks whether to hold rather than which to hold.

`scripts/alpha/measure-basket-exposure-timing.js` fixed the hypothesis, the 4x3 grid, the holdout
split, the decision rule, the effective-sample floor and the search cost in its header before any
result was seen.

## Measurement

900 daily bars per market across KRW-BTC, ETH, XRP, SOL, ADA. Equal-weight basket. 0.172% charged
on state flips only. Holdout is the last 30% in time order. Rebalances step by the horizon, so
windows do not overlap and every observation is an independent draw — an improvement on ADR-0027,
where effective n had to be discounted for overlap.

Decision rule unchanged from ADR-0026/0027 so results stay comparable: median excess over
buy-and-hold above zero **and** win rate above 0.5, in **both** halves.

**Result: 0 of 12.** No cell clears. The hypothesis as stated is rejected.

## Decision

**Timing exposure to the basket by its own trailing return is rejected.** Together with ADR-0026 and
ADR-0027 this closes both the selection and the timing form of price-history alpha on this venue:
neither choosing *which* major to hold nor choosing *whether* to hold them has shown an edge that
survives cost and a sealed holdout.

## The finding that matters more than the verdict

The verdict above stands as precommitted. But the measurement also showed that **the decision rule
inherited from ADR-0026/0027 is structurally incapable of passing this family**, and that is worth
recording before it rejects something real.

For an exposure overlay the excess is, by construction:

| state | excess over buy-and-hold |
|---|---|
| invested, no flip | **exactly 0** |
| out of market, basket rose | large negative |
| out of market, basket fell | large positive |

Excess is exactly zero whenever the overlay is invested. So a win — excess strictly above zero —
can only occur in a window the overlay sat out. **The win rate is therefore capped by the fraction
of time spent out of market.** Observed, and consistent across the grid:

| cell | in-market | out-of-market | win rate | cap respected |
|---|---|---|---|---|
| 60d / 7d | 25% | 75% | 50.0% | yes |
| 30d / 7d | 45% | 55% | 23.7% | yes |
| 30d / 14d | 47% | 53% | 26.3% | yes |

A `win > 0.5` clause thus demands the overlay be out of market a majority of the time *and* right
most of those times. It does not measure whether standing aside pays; it rewards overlays that are
rarely invested. The clause was written for a *selection* rule, which is always invested and whose
excess is almost never exactly zero. Carried onto an *exposure* rule it is not a neutral bar.

The same structure explains the medians of exactly `0.000%` throughout the table: they are not "no
effect", they are the invested windows, which are identical to the benchmark by definition.

## What this does not license

Every cell cut drawdown substantially — strategy maximum drawdown ranged from -0.8% to -39.5%
against a basket drawdown of -40.8% to -50.1%, with 60d/14d at -0.8% versus -48.0%. That column was
printed as context and **precommitted as excluded from the verdict**, and it stays excluded. Moving
the bar to a statistic chosen after seeing that it favours the result is the exact failure the
ADR-0022..0027 series exists to prevent, and a drawdown-flattering overlay that is simply out of the
market most of the time is what the naive version of that bar would select for.

## Precommitted follow-up

A risk-adjusted rule may be tested, but only as its own precommitment, stated here **before** it is
run:

- **Statistic:** ratio of compounded return to maximum drawdown, strategy versus basket, computed
  independently in each half.
- **Bar:** the strategy must exceed the basket's ratio in **both** halves, and its compounded return
  must not be below the basket's by more than 25% in either half — so an overlay that avoids
  drawdown merely by avoiding the market cannot pass.
- **Grid:** unchanged. The same 4 lookbacks x 3 horizons, so no new parameter search is introduced.
- **Floor:** unchanged at 10 effective holdout observations.
- **Falsification:** fewer than 2 of 12 cells clearing both halves closes the family outright.

## Search cost

ADR-0026 spent 6 hypotheses, ADR-0027 spent 12, this ADR spends 12. **30 cumulative.** The
precommitted follow-up above will add 12 more if run, for 42. The count does not reset.

## Safety

Measurement only. No strategy, registry entry, or execution path changed. `PAPER_ONLY`,
`liveAuthority=NONE`, `productionMutationAllowed=false`, AI `ZERO_AUTHORITY` are unchanged, and
nothing here creates order, withdrawal, or transfer authority.

---

# Addendum: the precommitted risk-adjusted rule was itself defective

The follow-up rule precommitted above was implemented in
`scripts/alpha/measure-basket-exposure-risk-adjusted.js` and run after this ADR was committed.

**As precommitted, it returns 3 of 12** — above the falsification threshold of 2, which would read
as "the family is not closed". That number is recorded, because it is what the committed rule says.

On inspection all three pass for arithmetic reasons rather than evidence of edge, and the fault is
in the rule I wrote, not in the data.

| clearing cell | holdout strategy return | holdout basket return | strategy maxDD | in-market | n |
|---|---|---|---|---|---|
| 14d / 7d | **-1.0%** | -29.6% | -23.6% | 45% | 38 |
| 14d / 14d | **-9.6%** | -29.8% | -18.7% | 47% | 19 |
| 60d / 14d | +26.8% | -24.8% | **-0.8%** | 22% | 18 |

Three defects, each of which alone is enough to void the reading:

1. **A negative numerator makes the ratio meaningless.** Two of the three cells lost money in the
   holdout. Their return/drawdown is negative, and they "beat" the basket only because `-0.04` is
   greater than `-0.59`. Comparing two negative ratios rewards losing less — which is what *any*
   overlay that stands aside does in a falling market, by construction and without forecasting
   anything. The rule should have required a positive strategy return before the ratio could be
   compared at all.

2. **The anti-avoidance guard was switched off in the half that decides.** The shortfall clause
   existed precisely so an overlay could not pass by avoiding the market, but it was gated on
   `benchmarkReturn > 0`. Every holdout cell in this grid has a negative basket return, so the guard
   never ran in the holdout. The one protection against the failure mode I anticipated was inactive
   exactly where it was needed.

3. **A near-zero denominator.** The third cell reports return/drawdown of 32.79 because its maximum
   drawdown is -0.8%. `returnOverDrawdown` refuses an exactly-zero drawdown but not a vanishing one,
   so an overlay that was in the market for 4 of 18 windows scores an unbeatable ratio for having
   barely participated.

Underlying all three: **the holdout is a bear market.** The basket lost 21.8% to 39.5% in every
cell. A defensive overlay is flattered there whether or not it can forecast. That is a property of
the split, not of the candidate, and no statistic evaluated only on this holdout can separate them.

## Corrected rule, precommitted for any future run

Requiring a positive strategy return in each half before its ratio is compared, and applying the
shortfall clause unconditionally, **1 of 12 cells clears** (60d/14d) — below the falsification
threshold of 2. Adding the unmeasurable-denominator floor below takes it to **0 of 12**, because
that surviving cell is the one whose 0.8% drawdown produced the 32.79 ratio.
That number is reported as a diagnosis of the instrument, **not as the verdict**, because it was
computed after seeing the first result. The precedent is ADR-0027, where the UNDERPOWERED floor was
added after the same kind of near-miss and both counts were printed.

Any future run of this family must, fixed in advance:

- require strategy return above zero in a half before that half's ratio is compared;
- apply the return-shortfall clause in every half, with no benchmark-sign gate;
- reject a half whose maximum drawdown is smaller than 5%, as an unmeasurable denominator;
- use a holdout that is not a single directional regime, or state that it is and decline to read a
  defensive candidate on it.

## Standing conclusion

**The family is not promoted and no registry entry is created.** The ADR-0026/0027 rule rejected it
0 of 12 and cannot fairly judge it; the risk-adjusted rule passed it 3 of 12 and cannot be trusted.
Two rules that disagree, each for a reason internal to the rule, is not evidence of edge in either
direction — and the corrected count of 1 of 12 is below the bar besides.

What is now established and reusable is narrower and more durable than a verdict on this candidate:
a defensive overlay cannot be evaluated against a directional holdout, by either a per-window
excess rule or a ratio rule. Fixing that is a prerequisite for the next candidate of this shape,
and it is the reason no further parameter search was spent here.

## Search cost

42 cumulative across ADR-0026, ADR-0027 and this ADR. The corrected recount introduced no new
parameters and is not counted as additional hypotheses. The count does not reset.
