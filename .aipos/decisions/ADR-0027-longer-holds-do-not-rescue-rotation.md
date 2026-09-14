# ADR-0027: Longer holds and dispersion filtering do not rescue rotation

- Status: Accepted
- Date: 2026-09-14
- Supersedes: nothing. Extends ADR-0026.

## Context

ADR-0026 found that rotating into the single strongest of five KRW majors
lost to simply holding the basket, at every horizon tested, for both the
momentum and the reversal sign of the ranking rule. Because reversing the
rule did not help, the loss was attributed not to the ranking but to the
0.172% round trip plus the diversification given up by concentrating.

That ADR named the only two reasons left to believe the concentration
penalty might still be paid:

- **Hypothesis A, amortisation.** A fixed round trip is a smaller drag on a
  longer hold. At some holding period the edge might outrun the cost.
- **Hypothesis B, dispersion.** Picking one of five is only worth paying for
  when the five have actually separated. Conditioning on a wide trailing
  spread might isolate the occasions where the pick carries information.

`scripts/alpha/measure-rotation-amortisation.js` tests exactly those two and
nothing else: horizons of 7, 14, 30 and 60 days crossed with dispersion
bands of all / top 33% / top 10% by best-minus-worst trailing spread. Twelve
cells. Direction fixed to MOMENTUM, since ADR-0026 established that the sign
of the ranking rule is not what decides the outcome. The decision rule is
unchanged from ADR-0026: **both** the in-sample half and the sealed
time-ordered holdout must clear zero after cost with a win rate above 0.5.

## Measurement

900 daily bars per market across KRW-BTC, ETH, XRP, SOL, ADA. 0.172% charged
per rotation. Holdout is the last 30% of the period and was never consulted
while choosing the grid.

Ten of twelve cells fail outright. The two that clear both halves are both at
the 60-day horizon:

| cell | holdout median | holdout win | effective independent samples |
|---|---|---|---|
| 60d, all | +1.893% | 57.7% | **3** |
| 60d, top 33% | +1.481% | 55.1% | **1** |

## Decision

**Both hypotheses are rejected. Rotation is not pursued further.**

The two surviving cells are not evidence, for a reason visible in the table
above: they carry the *smallest* effective sample in the entire grid. A
60-day horizon over 900 bars of five correlated majors leaves 3 and 1
genuinely independent observations. A raw n of 234 overlapping windows is
one long stretch of market counted many times, not 234 trials. At an
effective n of 1, a positive median is the statement "the last two months
of the holdout happened to go up", which is a fact about that stretch and
not about the rule.

That this cell and only this cell survives is itself the tell. Across the
grid, the measured result improves monotonically as the effective sample
shrinks — 7d fails everywhere with eff 38, 60d clears with eff 3. A signal
that appears only where there is the least data to contradict it is a
signature of noise, not of amortisation. Hypothesis A predicted that cost
drag falls with horizon; what the grid actually shows is that *dispersion of
the estimate* rises with horizon, which is a different and uninteresting
thing.

Hypothesis B fares worse still. Tightening from all to top 10% makes the
holdout monotonically worse at 7d, 14d and 30d — win rates of 3.8%, 3.8% and
8.0% against in-sample win rates of 48%, 66% and 60%. That is not a filter
that failed to help; it is a filter that reliably selected the wrong
occasions out of sample while looking excellent in sample. The in-sample
60d top-10% cell reports a 98.1% win rate on an effective n of 1 and is the
cleanest example of curve fitting this repository has produced.

## Consequences

- The rotation line of enquiry is closed. Neither ADR-0026's unconditional
  test nor this conditional one found anything that survives out of sample.
- `UPBIT_MAJOR_HORIZON_FLOOR_HOURS = 8` stands unchanged. Nothing here
  argues for raising or lowering it.
- Cumulative search cost across ADR-0026 and this script is **18 hypotheses
  tested**. Any future claim of edge on these five markets must be
  discounted against that number, and this ADR exists partly so that the
  count cannot quietly reset.
- The general lesson is recorded for the next measurement: **report
  effective independent samples beside every cell, and treat a result that
  survives only in the lowest-n cell as refuted rather than promising.**
  The script prints eff n on every line for this reason, and the two cells
  it labelled PROMISING are rejected here on that basis — the label is a
  mechanical arithmetic check, not a verdict.

## Reproduction

```
node scripts/alpha/measure-rotation-amortisation.js --days 900
```
