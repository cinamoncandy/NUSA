# Walk-Forward Validation Contract (WO-0027)

## Purpose

Answers one question only: does an SMA short/long parameter chosen on a training (and
optional validation) window keep working on the very next, unseen test window? It is
deterministic research infrastructure. It is not a profitability guarantee, not a
Live Trading approval, and not a production parameter change.

## Scope decision (read this first)

The originating work order asked for a brand-new `MarketCandle` contract, a
`HistoricalDatasetDescriptor` with separate source/normalized SHA-256 hashes, and a
purpose-built candle-native Backtest Engine (WO-0023 through WO-0026). None of that
exists in this repository -- verified directly (`grep -rl "WO-002[3-6]"` across the
whole tree returns nothing, and no `MarketCandle`/`HistoricalDatasetDescriptor` type
exists anywhere) before this work began. Rather than inventing an untested parallel
contract stack, `scripts/lib/walk-forward-runner.js` reuses the real, already tested,
deterministic production modules that exist today:

- `apps/desktop/src/researchDataset.ts` -- candle validation (`validateResearchCandles`)
  and a single canonical content hash (`calculateCandleSha256`), not a source/normalized
  pair.
- `apps/desktop/src/backtestEngine.ts` -- `runBacktest()`, the real engine already used
  by the pre-existing `walkForwardEngine.ts`/`researchDataset.ts` research lineage. It
  constructs a real `PaperBroker` and `StrategyEngine` per candidate; this module never
  bypasses `PaperBroker` and never reimplements a mini broker.
- `apps/desktop/src/strategyEngine.ts` -- `SmaCrossoverStrategy(shortPeriod, longPeriod)`,
  already configurable; production default (5, 20) is used only as the `FIXED_PARAMETER_5_20`
  benchmark and is never changed by this work.

Consequences of that reuse, disclosed rather than hidden:

- **Same-candle fill, not next-candle.** `runBacktest()` generates a signal from prices
  up to and including the current closed candle, then fills at that same candle's close
  price adjusted by spread/slippage. This is a real, deterministic, cost-adjusted
  execution convention, but it is not literally "next-candle open" execution. Because of
  this, `execution.latencyCandles` is accepted only as `0` and rejected otherwise --
  never silently ignored.
- **Single dataset hash.** `dataset.datasetContentSha256` is the only dataset integrity
  hash. There is no separate "source" vs. "normalized" hash pair.
- **Rolling windows only.** Anchored (expanding) windows are out of scope, matching the
  work order's own "초기 구현은 rolling window 하나만 지원" guidance.
- **One selection metric.** Only `RETURN_OVER_DRAWDOWN` is implemented.

## Window definitions

Every window is `[training][validation?][test]`, in strictly increasing candle index
order, moving forward by `stepCandles` each iteration. `stepCandles` must be `>=
testCandles` (test windows across iterations must never overlap). An incomplete final
test window is excluded, never padded, and never selected after seeing partial data.
Training, validation, and test never overlap by construction; the independent verifier
re-derives every boundary from scratch and checks this directly.

## Parameter selection

1. Every parameter-grid candidate runs on the training window only, through the real
   `runBacktest()`.
2. A candidate is eligible only if its training closed-trade count is `>= minimumTrades`.
3. `RETURN_OVER_DRAWDOWN` score: `totalReturn / abs(maxDrawdown)`, except when
   `maxDrawdown === 0`, in which case the score is `totalReturn` directly (this avoids
   the division-by-zero policy gap the work order flagged; it never produces `NaN` or
   `Infinity`).
4. If a validation window is configured, the top 3 training-ranked eligible candidates
   are re-evaluated on the validation window and the best validation score wins; a fixed,
   documented tie-break order (lower max drawdown, higher profit factor, lower turnover,
   longer `longWindow`, ascending `shortWindow`, ascending `longWindow`) resolves ties in
   every case.
5. Test data is never used in selection. The selected candidate is applied to the test
   window exactly once.
6. If validation is not configured, selection uses training score alone; this raises
   overfitting risk and is exactly why the aggregate degradation section exists.

## Benchmarks

Every window's test result is compared against `CASH` (always flat), `BUY_AND_HOLD`
(compounded from the real per-window benchmark field the Backtest Engine already
computes), and `FIXED_PARAMETER_5_20` (the production default 5/20 re-run, unselected,
on the exact same test windows). All three share the identical dataset, cost
assumptions, and window boundaries as the Walk-Forward-selected run.

## Aggregate Out-of-Sample metrics

Out-of-Sample compounding uses an equity multiplier, `∏(1 + windowReturn)`, never a
plain sum. Aggregate max drawdown is computed from a single sequential equity curve
built by rescaling each window's own equity curve onto a running base (never averaging
independent per-window drawdowns). Parameter stability records the most-selected
parameter, switch count, unique-parameter count, and longest consecutive repeat.
Degradation is recorded per window as absolute return deltas (training→validation,
validation→test, training→test), plus two overfitting-adjacent counts: how often a
positive training return was followed by a negative test return, and how often the
validation and test directions disagreed.

## Determinism and hashing

`PaperBroker` order IDs are derived from the candle's own timestamp
(`new Date(point.timestamp)`), not wall-clock time, so the whole pipeline is
deterministic given a fixed candle array and request. `scripts/lib/canonical-hash.js`
provides a shared canonical-JSON + SHA-256 helper (a serialization utility only); the
runner records `requestSha256`, `datasetContentSha256`, `windowPlanSha256`,
`candidateGridSha256`, `aggregateResultSha256`, and a per-window training/validation/test
result hash.

## Independent verification

`scripts/lib/walk-forward-verifier.js` never calls the runner's window-plan, aggregate,
or selection functions. It re-derives window boundaries from the raw request with its
own loop, recomputes OOS compounding and benchmark parity from each window's recorded
test return, confirms every selected parameter is a genuine member of the declared grid,
confirms no eligible candidate scored higher than the one selected (when no validation
window was used), and recomputes every hash from the result's own recorded fields.

## Known limitations (do not overstate results)

- Walk-Forward validation does not eliminate overfitting; a favorable result is a
  screening signal, not proof.
- The parameter grid itself is a researcher choice; a different grid can produce a
  different "most robust" parameter.
- No market-regime segmentation is performed here (that is a separate, later study).
- Dataset quality PASS does not imply the dataset is representative of future markets.
- The reused Backtest Engine has no spread/market-impact/partial-fill model beyond the
  configured `spreadBps`/`slippageBps` constants.
- This is not Live Trading evidence, not a profitability claim, and not a production
  parameter change; the SMA production default remains untouched.
