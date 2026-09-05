# Market Regime Performance Contract (WO-0029)

## Purpose

Answers one question: in which market states does the SMA strategy work, and in which
does it structurally break down? It is deterministic research infrastructure. It does
not predict future regimes, does not enable regime-based automatic trading, and does
not change any production strategy setting.

## Scope decision

`apps/desktop/src/strategy/marketRegime.ts` **already implements** the trailing-only classifier
this work order specifies — trend from a trailing log return over `trendLookback`,
realized volatility from the population standard deviation of trailing log returns over
`volatilityLookback`, warm-up windows labeled `UNKNOWN`, a SHA-256 classifier id over
the canonical config, and transition counting. It is already covered by
`tests/market-regime.test.js`. Per the WO-0027/WO-0028 precedent, this work therefore
does **not** write a second classifier; `scripts/lib/regime-analysis-runner.js` calls
`buildRegimeTimeline()` and builds the analysis layer on top of it.

Disclosed deviations from the literal work order, none of them silent:

- **Threshold source is `FIXED_ABSOLUTE`, not training quantiles.** The existing
  classifier takes absolute `lowVolatilityThreshold`/`highVolatilityThreshold` values,
  declared in the request before any candle is read. Because no distribution is
  estimated from any window, there is no in-sample/out-of-sample quantile leakage path
  to guard against *by construction*. Equally, the training-quantile mode the work
  order recommends is **not implemented**, and the absolute thresholds remain a
  researcher choice that a different value would change. `thresholdSource` is validated
  to be exactly `"FIXED_ABSOLUTE"` and any other value is rejected rather than silently
  coerced.
- **`ENTRY_SIGNAL_REGIME` and `ENTRY_FILL_REGIME` are identical here.** The reused
  Backtest Engine fills at the same candle's close (see
  `docs/research/walk-forward-contract.md`), so a trade's signal candle and fill candle
  are the same candle. They are reported as one field rather than pretending two
  independent attributions were derived.
- **Regime keys use trend × volatility only.** The classifier also emits a liquidity
  dimension; it is computed per candle but is not part of the combination matrix,
  matching the work order's own 3×3 + UNKNOWN specification.

## Trailing-only guarantee

Every label at candle *N* is a function of candles at index ≤ *N* only. No centered
moving average, no future high/low, no full-period quantile. Two tests prove this
behaviourally rather than by inspection: truncating the series leaves every earlier
label unchanged, and appending a wildly different future candle leaves every earlier
label unchanged.

Because the label is only final once its candle has closed, any real-time use of these
labels would necessarily lag by at least one candle. This analysis makes no claim about
real-time regime detection.

## Segments

Consecutive candles sharing one `(trend, volatility)` pair form one segment. Segments
tile the candle array exactly once — no gap, no overlap, no merging, and **no deletion
of short segments**. The independent verifier re-checks this tiling from scratch and
also checks that every candle inside a segment really carries that segment's label.

## Trade attribution

Each closed trade is attributed to **exactly one** regime: the regime of the candle the
position was entered on. The exit candle's regime is recorded for reference but never
adds the trade to a second regime's totals. Per-regime trade counts, net PnL, and fees
must therefore sum exactly to the aggregate totals; both the runner and the independent
verifier assert this partition, and a failure is a hard `FAIL`, not a warning.

## Rare-regime gate

A regime whose candle count, segment count, or trade count falls below the declared
`minimumSample` is graded `INCONCLUSIVE` and can never receive a performance verdict —
the sample gate is checked **before** any profitability rule, so a lucky rare regime
cannot be labeled `STRONG`. A bucket containing an `UNKNOWN` dimension (i.e. warm-up)
is graded `UNCLASSIFIED` and is excluded from strongest/weakest selection entirely; a
warm-up window is not a market state.

## Assessment rules (fixed before any run)

Evaluated per regime on the `BASE` cost condition, with `SEVERE` used only for the
`STRONG` survival requirement:

1. `UNCLASSIFIED` — the bucket contains an `UNKNOWN` trend or volatility dimension.
2. `INCONCLUSIVE` — below the declared minimum candle/segment/trade sample.
3. `HOSTILE` — negative net PnL **and** (fees ≥ 50% of gross profit **or** win rate
   below 25%).
4. `WEAK` — net PnL ≤ 0 without cost domination.
5. `STRONG` — positive net PnL at `BASE` **and** still positive under `SEVERE` cost.
6. `ACCEPTABLE` — positive at `BASE` but collapsing under `SEVERE`.

Strategy dependency over the conclusive trend regimes: `BROADLY_STABLE` (no conclusive
regime loses), `RANGE_SENSITIVE` (only RANGE loses), `TREND_DEPENDENT` (a trend regime
profits while something else loses), `BROADLY_WEAK` (nothing profits),
`REGIME_UNSTABLE` otherwise, `INCONCLUSIVE` if no regime clears its sample gate.

## Per-regime drawdown and benchmark conventions

Per-regime drawdown concatenates each segment's own equity slice, rescaled onto a
running base, then applies a single running peak. Per-regime buy-and-hold return is the
compounded product of each segment's own price return. Both are **aggregation
conventions over disjoint time slices**, not simulations of a portfolio that only
traded during that regime, and must not be presented as such.

## Cost stress

All three declared conditions (`BASE`, `MODERATE`, `SEVERE`) are validated to be
monotonically non-decreasing in fee and slippage, and are applied identically to every
regime. No per-regime cost tuning is possible.

## Independent verification

`scripts/lib/regime-analysis-verifier.js` does not call the runner's segment builder,
attribution, or assessment functions — **and does not call the production classifier
either**. It re-implements the trailing-only labeling from the raw candles with its own
arithmetic, so a bug in `apps/desktop/src/strategy/marketRegime.ts` could not hide behind a
verifier that simply asked that same module what the answer was. It then independently
checks segment tiling, coverage, the trade/PnL/fee partition, the rare-regime gate, the
`STRONG` survival requirement, cost monotonicity, transition ordering, and every hash.

## Known limitations

- The regime definition is a researcher-chosen rule; different lookbacks or thresholds
  can produce materially different labels and conclusions.
- Labels are confirmed only after a candle closes; real-time use would lag.
- This does not predict future regimes and is not a market-state detector.
- Applying a regime filter to the production strategy is explicitly **out of scope** and
  would require its own separate study (filter overfitting, classification lag, and
  real-time reproducibility all remain unproven).
- Not a profitability claim, not Live Trading evidence; the production SMA default is
  untouched.
