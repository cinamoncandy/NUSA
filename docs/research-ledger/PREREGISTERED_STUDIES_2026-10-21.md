# Pre-registered studies S2-S4 (design only, written before any row was examined)

Status: DESIGN. Owner request 2026-10-21: "다 해" after the root-cause read in WO-LEARNING-20261021-ROOT-CAUSE (no strategy has an edge after
costs; the candle-rule space is exhausted; the meta-learner recommends order-book data). Nothing below has been run. No order, limit,
threshold or authority is touched. A PASS qualifies only a forward SHADOW test, never promotion.

## Rules shared by every study

- Data: the all-KRW order-book/trade collector (deployed 2026-10-14, ~2.2 M books, ~443 k trade ticks) and the existing per-minute
  mid-price series. Read-only, bounded, run inside the existing nusa-research service like `scripts/run-orderbook-study.js`.
- The existing study (WO-RESEARCH-20261014-ORDERBOOK-STUDY) keeps its own span, holdout 10-25..10-28 and bar p < 0.05/195, unchanged.
  Its holdout is never reused: **every study below has a later holdout.**
- Span: train 2026-10-15 .. 2026-10-31, validation 2026-11-01 .. 2026-11-04, holdout 2026-11-05 .. 2026-11-11. Result printed only on or
  after 2026-11-12T02:00Z; before that it prints WAITING_DATA. Decision rows whose exit would cross into the next split are dropped.
- Multiple testing: configurations are counted across ALL studies. Family: 195 (existing) + 24 (S2) + 12 (S3) + 16 (S4) = 247.
  Every holdout PASS here needs one-sided p < 0.05 / 247 = 2.0e-4. The existing study is not re-judged against this stricter bar.
- Every PASS also needs: at least 50 trades; mean net per trade > 0 after base costs; mean net > 0 under stress costs (2x fee plus 5 bp
  per side); and mean net beating "buy every eligible market at the same times". A tie or a miss is a FAIL. A FAIL is recorded as a
  FAIL and the hypothesis is not re-run on the same data.
- Costs: Upbit KRW fee 0.05% per side (as in `RESEARCH_BACKTEST_COST`) and 5 bp slippage per side unless a study says otherwise. The
  maker fee tier of the owner's account is NOT assumed: S3 runs at the taker fee as its base case and reports a maker-fee line only as a
  labelled sensitivity that cannot decide PASS.
- Eligible market: a book in at least 90% of training decision times and median training spread <= 20 bp (training data only).
- Nothing is tuned on validation beyond the stated grid choice, and nothing on holdout.
- Data integrity: the result carries the sha256 identity of the data actually consumed and fails closed with DATA_INTEGRITY_FAIL if
  any row is stamped more than 5 s in the future, exactly as the existing study does.
- Stop rule: if fewer than 12 of the 17 training days have an eligible book for at least 60 markets, the study prints INSUFFICIENT_DATA
  and is neither a pass nor a fail.

## S2 - Longer holding periods (24 configurations)

Hypothesis: the failures on 1-minute and 60-minute holds are a cost-to-move problem; the same kind of signal may clear costs when each
trade holds long enough for the expected move to be several times the ~20 bp round-trip cost.
- Decisions: every 4 hours on the hour. Holds: 4 h, 12 h, 24 h (3).
- Signal families (4): 24 h mid return (momentum), negative 24 h mid return (reversal), top-5 book imbalance averaged over the last 4 h,
  and the sign-agreeing combination of momentum and imbalance.
- Rule: buy the top 3 eligible markets by the signal at the decision time, equal weight, hold for the horizon; entry at the best ask,
  exit at the best bid.
- Grid (2): signal look-back 24 h or 48 h. 3 x 4 x 2 = 24. Choose the configuration with the best validation mean net per trade.

## S3 - Cheaper execution (12 configurations)

Hypothesis: part of the lost edge is the spread and slippage paid by crossing; resting a limit order may keep more of a small edge, but
only if the order actually fills and adverse selection does not eat the saving.
- Signal: the S2 momentum+imbalance combination at a 4 h hold (the only signal family tested here).
- Execution: at the decision time place a buy limit at the best bid and a sell limit at the best ask for the exit; the order is cancelled
  after 15 minutes (3 cancel horizons: 5, 10, 15 min) and counts as a missed trade.
- Fill model (conservative, no queue luck assumed): a buy limit fills only when a trade prints strictly below the limit price after the order is
  placed; a sell only when a trade prints strictly above. Unfilled orders are missed trades and are counted, not dropped.
- Report fill rate, missed-trade mean outcome (what the missed trades would have earned), and net per filled trade. Grid: 3 cancel
  horizons x 4 top-k values (1, 2, 3, 5) = 12.
- PASS also needs a fill rate >= 20% and the net result per decision (including missed trades as zero) to beat S2's taker result on the
  same decisions. The maker-fee sensitivity cannot decide PASS.

## S4 - Cross-sectional daily reversal / momentum (16 configurations)

Hypothesis: a low-turnover, relative (market-neutral in spirit) rule across the ~300 KRW markets may keep an edge that single-market candle
rules cannot, and one trade a day amortises costs.
- Series: per-minute mid prices from the order-book collector for every eligible market (candles exist for one series only).
- Decision: once a day at 09:00 KST. Score = rank of the previous 24 h (or 72 h) mid return; long the bottom k (reversal) or top k (momentum), k in {3, 5}; hold 24 h.
- 2 look-backs x 2 directions x 2 k x 2 universe filters (all eligible, or spread <= 10 bp) = 16.
- Long-only (the PAPER account does not short spot). The benchmark is the equal-weight basket of all eligible markets over the same holds,
  so a market-wide rise cannot pass.

## What a result changes

- HOLDOUT_PASS on any study: a forward SHADOW test of that exact configuration is qualified for design. Nothing is deployed to PAPER and
  no gate changes.
- HOLDOUT_FAIL or INSUFFICIENT_DATA: recorded in `docs/research-ledger/experiments.json`; the next idea needs a new pre-registration.
- Expected outcome, stated plainly: most such studies fail. These are cheap, honest tests of the remaining ideas, not a promise of an edge.

## Not done here

No script, no run, no data read. Implementation (one deterministic script per study, same shape as `run-orderbook-study.js`, wired into the
existing daily research run) is a separate reviewed PR whose rules must match this file exactly.
