# Cross-Market / Cross-Period Validation Contract (WO-0030)

## Purpose

Answers one question: did this strategy only work on one symbol during one stretch of
history, or does it behave consistently across several markets and several periods? It
is deterministic research infrastructure. It is not a profitability claim, not a
portfolio study, and not a Live Trading approval.

## Scope decision

Same reuse decision as WO-0027/0028/0029 (see
`docs/research/walk-forward-contract.md`): no `MarketCandle`/`HistoricalDatasetDescriptor`
contract exists in this repository, so this reuses the real production modules
`apps/desktop/src/{researchDataset,backtestEngine,strategyEngine}.ts`. It never bypasses
`PaperBroker` and never reimplements a mini backtester. `execution.latencyCandles` is
accepted only as `0` and rejected otherwise. There is one dataset content hash per
dataset, not a source/normalized pair.

## Fairness rules, enforced by construction

- **One strategy everywhere.** Every cell runs the same `shortWindow`/`longWindow`.
  There is no per-market parameter selection anywhere in this module, so a
  market-specific re-optimisation cannot leak into the primary comparison.
- **One cost model and one risk policy everywhere.** All three cost conditions
  (`BASE`, `MODERATE`, `SEVERE`) are validated to be monotonically non-decreasing and
  are applied identically to every cell.
- **One timeframe and one quote currency.** A mixed request is rejected rather than
  silently resampled or currency-converted.
- **No cell is dropped.** A cell that cannot be evaluated is `BLOCKED` with a reason and
  is still counted in the plan; a losing cell is retained. The independent verifier
  re-checks completeness against the raw request.

## Sizing comparability (the trap this contract exists to avoid)

A fixed order quantity applied across markets at different price levels buys different
notional exposure: `0.001` units is roughly 100 KRW of a 100,000 KRW asset but roughly
0.8 KRW of an 800 KRW asset — a 125× difference. Net-PnL contribution compared across
such markets measures **the sizing policy, not the strategy**.

This was caught by dogfooding: an early run reported "100% of profit concentrated in
KRW-BTC", which was purely an artifact of BTC's price level, not a property of the
strategy. The runner now computes a per-market typical notional, and when the spread
exceeds `comparisonPolicy.notionalSpreadTolerance` (default 2×) it reports concentration
as `NOT_COMPARABLE` and withholds the numbers rather than publishing a figure that looks
meaningful and is not. Incomparable sizing also forces the generalization assessment to
`INCONCLUSIVE`. `aggregationPolicy: "NO_CROSS_MARKET_AGGREGATION"` suppresses the same
numbers explicitly.

## Two cohorts, never merged

- **`fullAvailablePeriod`** — each dataset over its own full range; used for per-market
  long-run character.
- **`commonPeriod`** — every dataset sliced to the window during which *all* symbols
  have data; used for direct market-to-market comparison. When symbols do not overlap at
  all, every common-period cell is `BLOCKED` with `NO_COMMON_PERIOD`.

The two views are reported as separate blocks and are never combined into one aggregate.
A disagreement between their assessments raises
`FULL_PERIOD_AND_COMMON_PERIOD_DISAGREE`.

## Benchmarks

Every evaluated cell is compared against `CASH` (flat), `BUY_AND_HOLD` (from the real
per-cell benchmark the Backtest Engine computes), and `FIXED_SMA_5_20` — the production
default re-run on the same cell under the same `BASE` cost. The fixed benchmark is never
re-selected per market.

## Generalization assessment (fixed before any run)

Sample gates first, then, on the `BASE` condition:

1. `INCONCLUSIVE` — fewer than 2 markets, fewer than 2 periods, fewer than half the
   cells evaluated, **or incomparable sizing**.
2. `BROADLY_WEAK` — positive-cell ratio ≤ 0.25. Checked before the concentration
   branches: when three quarters of the matrix loses, "weak" is the honest headline.
3. `MARKET_AND_PERIOD_CONCENTRATED` / `MARKET_CONCENTRATED` / `PERIOD_CONCENTRATED` —
   wins cluster: some market (or period) has no wins at all while another has at least
   one. An earlier draft required a group to be *uniformly* positive, which made the
   combined branch logically unreachable (a market positive in every period and a period
   negative in every market cannot coexist); that rule was corrected.
4. `BROADLY_GENERALIZABLE` — positive ratio ≥ 0.6 and buy-and-hold outperform ratio ≥ 0.5.
5. `MIXED` — positive ratio ≥ 0.4.
6. `INCONSISTENT` — otherwise.

## Execution status vs. research assessment, and the provenance gate

`executionStatus` (did the pipeline run correctly) and `researchAssessment` (what this
says about the strategy) are separate fields and must stay separate.

`dataProvenance` must be declared. **When it is `SYNTHETIC_FIXTURE`, `researchAssessment`
is forced to `INCONCLUSIVE` regardless of how the synthetic numbers come out.** The
computed pattern is still surfaced, but only as `syntheticPatternObserved`, explicitly
labelled a pipeline-exercise result. Running a strategy over invented candles tells you
the code works; it tells you nothing about a market, and this contract refuses to let
those two be confused.

## Determinism and independent verification

All computation is a pure function of the request. The verifier
(`scripts/lib/cross-market-validation-verifier.js`) does not call the runner's cell-plan
builder, group summarizer, concentration analyzer, or assessment function. It re-derives
cell completeness, canonical ordering, aggregate ratios, per-group summaries, the
`beats*` flags, and concentration from the result's own per-cell numbers, and separately
enforces fairness parity (strategy, cost, execution), timeframe parity, cohort
separation, bias disclosure, and every hash.

## Known limitations

- Markets and period boundaries are **researcher-chosen before the run**; a different
  panel can produce a different verdict.
- **Survivorship bias is present and not corrected**: delisted and halted markets are
  absent. This is disclosed in every result rather than hidden.
- A KRW-only panel does not represent the broader crypto market.
- Listing-history differences mean some symbols have shorter usable ranges.
- No per-market spread, market-impact, or partial-fill model beyond the configured
  `spreadBps`/`slippageBps`.
- This is a per-market comparison, **not a portfolio simulation** — cells do not share
  capital.
- Not Live Trading evidence; the production strategy and symbol are untouched.
