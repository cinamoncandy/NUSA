# SMA Parameter-Neighborhood Robustness Contract (WO-0028)

## Purpose

Answers one question: is a favorable SMA parameter's performance a lonely accident at
one exact `(shortWindow, longWindow)` tuple, or does it hold up across the small
neighborhood of nearby tuples around it? This is not a parameter search -- the
neighborhood offsets and the three cost conditions are fixed by the request before any
candidate runs, and no "best" parameter is ever re-selected after seeing results.

## Scope decision

Same situation as WO-0027 (see `docs/research/walk-forward-contract.md`): no
`packages/contracts/src/parameterRobustness.ts`-style contract exists, and none is
invented here. `scripts/lib/parameter-robustness-runner.js` reuses
`apps/desktop/src/{researchDataset,backtestEngine,strategyEngine}.ts` plus the generic
(non domain-specific) `buildWindowPlan`/`compoundedSequence`/`computeMaxDrawdownFromCurve`
helpers already built for WO-0027 in `scripts/lib/walk-forward-runner.js`. It never
bypasses `PaperBroker` and never reimplements a mini broker. The same disclosed
deviations from WO-0027 apply here (same-candle-close fill, single dataset content
hash, `execution.latencyCandles` accepted only as `0`).

## Candidate grid

For every declared reference parameter and every `(shortOffset, longOffset)` pair in
the declared `neighborhood`, one candidate tuple is generated. Duplicate tuples
produced by different references collapse to a single evaluated candidate (with a
`distanceFromReferences` entry per reference), never evaluated twice. A candidate is
`valid` only if `shortWindow > 0`, `longWindow > shortWindow`, and `longWindow` is
smaller than the applicable training bound (the full candle count in `FULL_SAMPLE`
mode, or `evaluation.oosWindows.trainingCandles` otherwise); invalid candidates are
recorded with `status: "INVALID_CANDIDATE"`, never silently dropped.

`distanceFromReferences` is the plain absolute-difference (Manhattan) metric --
`abs(shortWindow - reference.shortWindow) + abs(longWindow - reference.longWindow)` --
used only for locality analysis, never as a performance score.

## Evaluation modes

- `FULL_SAMPLE`: every candidate runs once over the entire candle array via the real
  `runBacktest()`. Carries in-sample bias by construction; never used alone to declare
  robustness.
- `WALK_FORWARD_OOS_WINDOWS`: the candle array is split into rolling train/test windows
  (via WO-0027's `buildWindowPlan`, with `validationCandles: 0`), and the SAME candidate
  is applied, unchanged, to every test window -- there is no re-selection here, since
  this measures a fixed tuple's neighborhood robustness, not walk-forward selection.
  Returns compound via the same `∏(1+r)` formula as WO-0027.
- `BOTH`: runs both of the above independently; a robustness conclusion should never
  rest on `FULL_SAMPLE` results alone.

## Immediate neighbors

Immediate neighbors of a reference are the grid cells at index-distance 1 in the
*declared* `shortOffsets`/`longOffsets` arrays (Chebyshev-adjacent, 8-connected),
not raw value distance -- an irregular grid like `[-5, -2, 0, 2, 5]` still treats `+2`
and `-2` as the adjacent step near the reference, not `+5`/`-5`. Local smoothness (used
for the `UNSTABLE` classification) instead uses 4-connected adjacency (one axis moves
by one declared step at a time).

## Plateau classification

Fixed, documented, deterministic rules (evaluated on `costConditions.BASE`, full-sample
or OOS-compounded return depending on the request's mode):

1. `UNSTABLE` -- if `>= 50%` of all 4-connected adjacent candidate pairs in the whole
   grid disagree in return sign (checked first; overrides everything else).
2. `FLAT_WEAK` -- if the reference's own return is not positive.
3. `BROAD_PLATEAU` -- reference return positive, and `>= 75%` of immediate neighbors
   share its return-sign direction, and `>= 50%` of immediate neighbors also beat the
   `BUY_AND_HOLD` benchmark.
4. `NARROW_PLATEAU` -- reference return positive and `>= 50%` (but `< 75%`) of
   immediate neighbors share its direction.
5. `ISOLATED_PEAK` -- reference return positive but `< 50%` of immediate neighbors
   share its direction.

These thresholds are fixed here, before any real dataset is run, and are not tuned
against a specific result.

## Cost-stressed robustness

Every candidate is evaluated identically under exactly three named cost conditions --
`BASE`, `MODERATE`, `SEVERE` -- declared in the request and validated to be
monotonically non-decreasing in `feeRate`/`slippageBps`. All candidates share the same
three conditions; no per-candidate cost tuning is possible. `aggregate.costSurvivorCounts`
reports how many valid candidates keep a positive return under each condition.

## Determinism and independent verification

All computation is a pure function of the candle array and request (see WO-0027's
determinism note on `PaperBroker` order-ID derivation from candle timestamps).
`scripts/lib/parameter-robustness-verifier.js` never calls the runner's grid,
neighbor, or classification builders: it independently rebuilds the expected candidate
key set from the raw request, recomputes each recorded distance from `abs()` first
principles, recomputes `aggregate.positiveRatio`/`worstReturn`/`bestReturn` from each
candidate's own recorded cost results, sanity-checks that `BROAD_PLATEAU`/`FLAT_WEAK`
labels are consistent with their own recorded `referenceReturn`, and recomputes every
hash.

## Known limitations

- The neighborhood offsets themselves are a researcher choice; a wider or narrower grid
  can change the classification.
- `FULL_SAMPLE` robustness does not eliminate look-ahead bias inherent in in-sample
  evaluation; only the OOS mode addresses that, and only for the windows it covers.
- No market-regime segmentation is performed here (a later, separate study).
- This is not a profitability claim, not Live Trading evidence, and does not change any
  production SMA parameter.
