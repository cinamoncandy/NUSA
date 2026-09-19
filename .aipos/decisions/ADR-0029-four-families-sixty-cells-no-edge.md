# ADR-0029: Four price-history families, sixty cells, no edge

## Status

Accepted. Measurement only; no runtime behaviour changes. Extends ADR-0026, ADR-0027 and ADR-0028
from the basket level to the per-market research grid.

## Context

ADR-0026 through ADR-0028 closed price-history alpha at the *basket* level: neither choosing which
KRW major to hold (cross-sectional momentum and its reversal, 6 of 6 negative; longer holds and
dispersion conditioning, 0 of 12) nor choosing whether to hold them at all (absolute momentum,
0 of 12 under the comparable rule) showed an edge surviving cost and a sealed holdout.

Separately, the research grid had been run across three families x five markets x three
timeframes: 45 cells, `researchAllocation` null in every one, and `DEFLATED_SHARPE_BELOW_
CONFIDENCE_THRESHOLD` present in every one. That run left an obvious objection open: two of the
three families — SMA crossover and Donchian breakout — are the same return driver read two ways, so
the grid tested fewer independent ideas than its size suggested.

This ADR closes that objection. `time-series-momentum` was added as a fourth family — the asset's
own trailing return against a precommitted zero-centred dead band — and the grid re-run at 4 x 5 x 3
= 60 cells.

The dead band was the point. ADR-0026 through ADR-0028 attributed the basket-level failures to the
0.172% round trip rather than to the quality of any rule, so the fourth family was designed to
turn over less while still trading: a threshold that must be exceeded before the state flips.

## Measurement

Run on `8ca08f76` (origin/main plus the family registration), 60 cells, **0 errors**. The three
pre-existing families' 45 cells were run first and are unchanged from the earlier run in their
conclusion; the fourth family's 15 cells were re-run after a defect fix described below.

**Result: 60 of 60 cells have `researchAllocation: null`. 59 of 60 are blocked by deflated Sharpe.**

The single exception, `donchian-breakout KRW-BTC 1d`, is not an edge: it clears DSR and is blocked
by benchmark outperformance, closed trades and regime fragility instead.

### The dead band worked, and it did not matter

The fourth family did what it was designed to do. Cells blocked by the closed-trade gate, out of 15
per family:

| family | blocked by `trades` | eligible at 240m |
|---|---|---|
| rsi-mean-reversion | 15 | 4–5 of 9 |
| donchian-breakout | 12 | 3–4 of 5 |
| **time-series-momentum** | **5** (all at 60m) | **12 of 12, every market** |
| sma-crossover | 0 | 9 of 9 |

It turns over less than Donchian or RSI and still closes enough trades at 1d and 240m, reaching
full league eligibility at 240m in every market — the only family to do so. And its deflated Sharpe
cleared nothing.

**This falsifies the hypothesis that execution cost is the binding constraint.** A family that
demonstrably pays the round trip less often, while keeping enough trades to be evaluated, produced
no edge. The cost explanation survived ADR-0026 through ADR-0028 because every candidate there
either concentrated or flipped often. This one does neither, and fails identically.

A prediction made before the run — that wide-band cells would starve the closed-trade gate — was
wrong: not one 1d or 240m cell was blocked on trades.

## Correction: regime robustness is a property of the data slice, not the strategy

Partway through the run, on seeing that `KRW-ADA 240m` came back FRAGILE for the new family where
the other three returned ROBUST, I reported that "regime robustness is produced by the strategy."
**The completed grid does not support that and it is withdrawn.**

Across all 60 cells the regime class is fixed by timeframe, and at 240m by market:

| timeframe | class | families affected |
|---|---|---|
| 1d | FRAGILE in 20 of 20 | all four, every market |
| 60m | INSUFFICIENT in 20 of 20 | all four, every market |
| 240m | by market | BTC/ETH/XRP FRAGILE for all four; DOGE ROBUST for all four |

**59 of 60 cells' regime class is explained without reference to the strategy at all.** Exactly one
cell — `KRW-ADA 240m` — splits by family (ROBUST for three, FRAGILE for the fourth). I generalised
from the single cell that happened to differ, before the cells that would have contradicted it had
run. The honest statement is the opposite of what I said: the classifier is reading the data slice,
and the strategy barely enters.

## Decision

**No family is promoted and no candidate binding is created.** `researchAllocation` stays null
because nothing qualifies, which is the gate behaving correctly rather than a malfunction.

Four families spanning three distinct drivers — trend (SMA crossover, Donchian breakout), mean
reversion (RSI), and absolute momentum (time-series momentum) — across five markets and three
timeframes produce no candidate clearing deflated Sharpe. Together with ADR-0026 through ADR-0028
at the basket level, **price history alone is closed on this venue at both levels.**

The next candidate must take an input that is not the price series. ADR-0022 and the alpha
readiness declarations already record what that rules out here: Upbit KRW is spot-only, so there is
no funding rate, and crypto has no fundamentals of the kind a value or quality driver needs. What
remains available is not obvious and is not decided here.

## A defect this run exposed

The fourth family's first cell failed at run time with `real parameter robustness failed:
unsupported`, after the 60-cell grid had been declared and started.

`scripts/lib/parameter-robustness-runner.js` carried its own family knowledge in two separate
hardcoded places — the strategy factory and the request validator — and neither knew the new
family. Every registration point in `research-real-market-run.js` had been updated, and the commit
adding the family claimed it was registered "at every point the existing three are". That claim was
false: the runner that *executes* a robustness request had not been checked, only the one that
*builds* it.

This is the failure shape this repository keeps recording — a thing registered, enumerated, and
never reached — reproduced while adding a guard against it elsewhere in the same change.

The fix is not a fourth entry in two lists. Two parallel lists is the defect. They are now one
frozen `SUPPORTED_ROBUSTNESS_FAMILIES`, with a regression test asserting that every family the
research runner accepts is executable by the robustness runner, verified by reverting the fix and
confirming the test fails.

The 45 already-completed cells were preserved rather than re-run, because the defect could not
affect families the runner already supported.

## Evidence

- Grid: `8ca08f76`, 4 families x 5 markets x 3 timeframes, 0 errors.
- Declared depths, unchanged and contiguity-verified: 1d 2000, 60m 1500, 240m 4000 candles.
- 240m cells reproduced the earlier run's deflated Sharpe to four decimal places for SMA and RSI
  (0.2524/0.1907/0.5272/0.5416 against 0.2523/0.1907/0.5271/0.5416). Donchian moved
  (KRW-DOGE 240m 0.7488 → 0.6707) and `KRW-ADA 240m` changed class, consistent with its being the
  family most often short of closed trades and therefore the thinnest statistically.

## Search cost

This is a grid run of a registered family through the full qualification pipeline — deflated
Sharpe, PBO, walk-forward, regime robustness, parameter stability — and not an addition to the
ADR-0026..0028 alpha-measurement series. That series' ledger stands at **42** and is untouched
here. The grid's own multiple-comparison correction is the deflated Sharpe applied within each
family; it does not account for families or markets tried across runs, which is why this ADR
reports every cell rather than any subset.

## Safety

Measurement and measurement tooling only. No strategy semantics, execution path, or authority
changed. `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, AI
`ZERO_AUTHORITY` are unchanged, and nothing here creates order, withdrawal, or transfer authority.
