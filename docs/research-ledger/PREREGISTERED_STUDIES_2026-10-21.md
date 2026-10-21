# Pre-registered studies S2-S4 (design v2, after independent review; design only)

Status: DESIGN, frozen at the freeze point below. Owner request 2026-10-21: "다 해" after the root-cause read in
WO-LEARNING-20261021-ROOT-CAUSE (no strategy has an edge after costs; the candle-rule space is exhausted; the meta-learner recommends
order-book data). Nothing below has been run. No order, limit, threshold or authority is touched. A PASS qualifies only a forward
SHADOW test, never promotion.

What "before any data" means here: the design uses no data from its holdout period, which does not exist yet. Earlier collector data
(2026-10-14..10-20) was seen only as aggregate health counters (counts, spreads), never as returns or signals.

An independent review of v1 found that a 7-day holdout cannot reach a 50-trade, p < 2e-4 bar, that overlapping holds break the z-test,
and several ambiguities. v2 fixes them: one **primary** configuration per study (no selection on validation), a 30-day holdout, one
paired value per non-overlapping decision cohort, explicit costs and survivorship rules.

## Common rules (all times UTC; the existing order-book study is unchanged and its holdout 10-25..10-28 is never reused)

- Data: all-KRW order-book snapshots and trade ticks collected by the PAPER host (read-only, bounded, inside the existing nusa-research
  service, same shape as `scripts/run-orderbook-study.js`). The result line carries the sha256 of the books AND trade ticks actually
  consumed, and fails closed with DATA_INTEGRITY_FAIL if any row is stamped more than 5 s in the future.
- Splits (UTC, end exclusive): train 2026-10-15T00:00Z..2026-11-01T00:00Z (defines eligibility only; nothing is fitted); validation
  11-01..11-05 (reported as a sanity line, never used to pick anything); holdout 2026-11-05T00:00Z..2026-12-05T00:00Z (30 days). A
  decision whose exit time is after the split end is dropped. Result printed only on or after 2026-12-05T02:00Z (WAITING_DATA before).
- Eligible market: a book at 90% or more of the training decision times of that study AND median training spread <= 20 bp, both from
  training data only. Markets listed after 2026-11-01 are not eligible.
- Ranking uses information at the decision time only. A trade whose exit book is missing is marked to the last bid within 1 hour of the
  exit, otherwise to -100%; the number of such trades is printed. No trade is dropped because it later lacks a book.
- Costs, per side. Base: taker fee 5 bp + slippage 5 bp, entries at the best ask and exits at the best bid (so the spread is paid on
  top; the round trip is the spread plus 20 bp). Stress: taker fee 10 bp + slippage 10 bp. Maker fills (S3): fee 5 bp (the owner's maker
  tier is NOT assumed), no slippage; stress fee 10 bp.
- Unit of analysis: one value per non-overlapping decision cohort = mean net return of that cohort's picks minus the mean net return of
  the same-universe benchmark (equal-weight all eligible markets, same entry/exit times and costs). The test is a one-sided t-test on
  the cohort values. Holds never overlap inside a study, so cohorts are independent by construction.
- PASS needs all: at least 30 cohorts; mean cohort excess > 0 with one-sided p < 0.05 / 3 = 0.0167 (three primary tests in this family);
  the same excess mean > 0 under stress costs; the mean absolute net per trade > 0 under base costs; coverage (below) met.
- Coverage (evaluated before any outcome is computed): at least 90% of decision times in the holdout have a book for 60 or more eligible
  markets, and at least 90% of picks have an exit book; otherwise INSUFFICIENT_DATA (neither pass nor fail; the hypothesis stays
  re-runnable). Likewise INSUFFICIENT_DATA if fewer than 12 of 17 training days have 60 or more eligible markets.
- The result also prints the observed standard deviation, cohort count and the smallest mean excess that would have passed, so an
  unreachable bar is visible instead of silent.
- A FAIL is recorded as a FAIL and the hypothesis is not re-run on the same data.
- Sensitivity grids (below) are printed for information, labelled SENSITIVITY, do not count toward the family and cannot decide PASS.
- Freeze: the sha256 of this file is embedded and asserted by each study script. Each script must be merged and tested only on data
  before 2026-11-05T00:00Z. After this point rules change only by a dated addendum committed before 2026-11-05T00:00Z. Nothing may change
  after the holdout begins.

## S2 - Momentum with order-book pressure, daily, 24 h hold

Hypothesis: a daily move is large enough relative to ~20 bp of cost plus the spread that a signal agreeing across price and book pressure keeps an edge.
- Decision daily at 00:00Z; hold 24 h; cohorts = 30.
- Primary: eligible markets with 24 h mid return > 0 AND the 4 h average top-5 imbalance > 0; rank those by the sum of their cross-sectional
  percentile ranks of the two; buy the top 3 (fewer if fewer qualify; no cohort if none), equal weight; tie-break lowest market code.
- SENSITIVITY: holds 4 h, 12 h; look-back 48 h; reversal sign. (Not counted.)

## S3 - Cheaper execution, 4 h hold

Hypothesis: part of the lost edge is the spread and slippage paid by crossing; resting limit orders may keep more of a small edge if they fill and adverse selection does not eat the saving.
- Decisions every 4 h at 00,04,...,20Z; hold 4 h; the S2 signal with a fixed 24 h look-back; top 3. Cohorts = 180.
- Primary entry: a buy limit at the best bid read from the book at exactly the decision time (decision skipped if that book is older than 5 s),
  cancelled after 10 minutes. Primary exit: a sell limit at the best ask read at t+4 h, cancelled after 10 minutes; if unfilled the position is
  closed as a taker at the then-best bid with base slippage. Unfilled entries are missed trades (zero return, counted).
- Fill model, conservative: a buy limit fills only for the part of its notional covered by cumulative traded volume at prices strictly below
  the limit, counting only trades stamped at least 1 s after placement and before cancellation; a sell mirrors it with prices strictly above.
- PASS additionally needs: entry fill rate of at least 30%; and the paired per-cohort improvement of this maker execution over a taker execution
  of the same signal and decisions (taker entry at ask, taker exit at bid, base costs) is positive with one-sided p < 0.05. Missed trades count as
  zero in the maker cohort value, never dropped.
- SENSITIVITY: cancel 5 / 15 minutes; top-k 1, 2, 5; maker fee at an assumed lower tier (labelled, cannot decide PASS).

## S4 - Cross-sectional daily reversal

Hypothesis: a low-turnover reversal across ~300 KRW markets keeps an edge that single-market rules cannot.
- Series: per-minute mid prices from the order-book collector. Decision daily at 00:00Z; hold 24 h; cohorts = 30. Long-only (the PAPER account has no spot short).
- Primary: buy the 5 eligible markets with the lowest 24 h mid return, equal weight; tie-break lowest market code.
- Benchmark: equal-weight all eligible markets over the same holds. A market-wide rise cannot pass because the test is on the paired excess.
- SENSITIVITY: look-back 72 h; k = 3; momentum sign; spread <= 10 bp universe (benchmark uses the same filtered universe).

## Family and what a result changes

- Family: three primary holdout tests (S2, S3, S4) plus the existing order-book study (its own p < 0.05/195, unchanged). Sensitivities are not counted.
- HOLDOUT_PASS: a forward SHADOW test of that exact configuration is qualified for design. Nothing is deployed to PAPER; no gate changes.
- HOLDOUT_FAIL or INSUFFICIENT_DATA: recorded in `docs/research-ledger/experiments.json`; a new idea needs a new pre-registration.
- Expected outcome, stated plainly: most such studies fail. These are cheap, honest tests, not a promise of an edge.

## Not done here

No script, run or data read. Implementation (one deterministic read-only script per study) is a separate reviewed PR that must match this file exactly and embed its sha256.
