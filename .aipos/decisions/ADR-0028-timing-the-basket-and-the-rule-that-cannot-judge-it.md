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
