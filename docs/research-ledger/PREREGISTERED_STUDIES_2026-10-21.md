# Pre-registered studies S2-S4 (design v5: v4 plus the S3 gross-edge gate found by simulation; design only)

Status: DESIGN. Freeze point: 2026-10-28T00:00Z (before the existing order-book study prints on 2026-10-29 and before validation data
exists). Owner request 2026-10-21: "다 해" after the root-cause read in WO-LEARNING-20261021-ROOT-CAUSE (no strategy has an edge after
costs; the candle-rule space is exhausted; the meta-learner recommends order-book data). Nothing below has been run. No order, limit,
threshold or authority is touched. A PASS qualifies only a forward SHADOW test, never promotion.

What "before any data" means: the design uses no data from its holdout period, which does not exist yet. Earlier collector data
(2026-10-14..10-20) was seen only as health counters (counts, coverage and spreads). The hypotheses were chosen after earlier
candle-rule results on the same venue. The training window (10-15..11-01) contains the existing study's holdout 10-25..10-28; that is
acceptable because here training defines eligibility only and nothing is fitted.

v5 adds one rule to S3 (test d): while building the S3 core, a simulation showed that a signal with NO information still passed S3 through the maker execution's own saving (excess vs a taker benchmark, execution improvement and a positive absolute return are all produced by cheaper execution alone), so S3 now also requires a gross (cost-free) signal edge. v4 closes the third review: exact formulas, empty-cohort and data-gap valuation, S3 cohort counting, the beta clause on all studies, byte-immutability after the freeze, and a single allowed re-run. v1 -> v2 -> v3: a 7-day holdout could not reach the bar; overlapping holds broke the test; then v2 left book lookups, p-value method,
cohort counts, S3 exit/benchmark handling, the freeze mechanics and the stress test under-specified. v3 fixes those.

## Common rules (all times UTC; every split end is exclusive; the existing order-book study is unchanged, keeps its own alpha 0.05/195 and its holdout 10-25..10-28 is never reused)

- Data: all-KRW order-book snapshots and trade ticks from the PAPER host (read-only, bounded, inside the existing nusa-research
  service, same shape as `scripts/run-orderbook-study.js`). The result carries the sha256 of the books AND trade ticks actually
  consumed (canonical JSON lines sorted by (market, stamp)) and fails closed with DATA_INTEGRITY_FAIL if any row is stamped more than 5 s after its ingest time.
- Book at time t: the last snapshot in (t - 2 min, t], for every study (as in the existing script). Spread in bp = (ask - bid) / mid x 1e4
  from the best bid and ask. Mid = (bid + ask) / 2. Top-5 imbalance = (bid5 - ask5) / (bid5 + ask5) over the top five levels' sizes, 0 if
  the denominator is 0. Percentile rank of x among n values = (rank - 1) / (n - 1) with average ranks for ties, 0.5 if n = 1.
- Splits: train 2026-10-15T00:00Z .. 2026-11-01T00:00Z (eligibility only); validation 11-01T00:00Z .. 11-05T00:00Z (printed as a
  sanity line, never used to choose anything, and not computed before the freeze); holdout 2026-11-05T00:00Z .. 2026-12-05T00:00Z.
  A decision is dropped if its SCHEDULED exit time (decision + hold) is later than the split end; an exit exactly at the split end is allowed.
  For S3 the scheduled exit is decision + 4 h, never the realised exit. Printed only on or after 2026-12-05T02:00Z (WAITING_DATA before).
- Eligible market (per study, from training data only): over the study's training decision times (S2/S4: 17 daily 00:00Z; S3: 102 at
  00,04,...,20Z) the market has a decision-time book and a snapshot under the (t - 2 min, t] rule at the scheduled exit for at least ceil(9n/10) of them (integer arithmetic; marked values do not count as exit books), and the upper median of its
  decision-time spreads at those times is <= 20 bp. Markets first seen after 2026-11-01 are not eligible. The universe is fixed at 2026-11-01 for the
  whole holdout.
- Survivorship: ranking uses information at the decision time only. A pick whose exit book is missing is marked to the last bid in
  [exit - 1 h, exit] (before the exit, never after); if none exists the pick is a data gap, valued at -100% in the picks AND in the benchmark basket (same rule for both). If data gaps exceed 5% of picks the study is INSUFFICIENT_DATA. The numbers of marked trades and data gaps are printed. 'Delisted or halted' is not used: any missing exit value is a data gap.
- Costs per side. Base: taker fee 5 bp + slippage 5 bp, entries at the best ask and exits at the best bid (the spread is paid on top, so
  a round trip costs the spread plus 20 bp). Stress: taker fee 10 bp + slippage 10 bp. Maker fills (S3): fee 5 bp (the owner's maker tier
  is NOT assumed), no slippage; stress fee 10 bp.
- Cohort and benchmark: one value per decision = mean net return of that decision's picks minus the mean net return of the benchmark. The
  benchmark is the equal-weight basket of every eligible market that has an entry book at the decision time and an exit or marked value,
  with the same costs and times (and the same execution as the picks, except where S3 says otherwise).
- Net return of one trade = bid_exit x (1 - c_exit) / (ask_entry x (1 + c_entry)) - 1 with c = (fee + slippage) / 10000 per side (multiplicative; for maker fills the price is the limit price and c = fee only). Ranks are ascending (the highest value gets rank n). Tie-break is the bytewise-ascending market code. A cohort with no pick (S2 empty set) has value 0 minus the benchmark return and still counts toward n. S4 buys as many as qualify, up to 5; none means 0 minus the benchmark.
- The test (one-sided): Student t with n - 1 degrees of freedom on the cohort values (sample sd with n - 1), p from the regularised
  incomplete beta function, AND a sign-flip permutation test on the same values with 100,000 flips and a fixed seed, both at the stated
  alpha: permutation p = (1 + #{flipped mean >= observed}) / 100001 with statistic = mean, PRNG mulberry32, seed 20261021. A sample sd of 0 means FAIL for that test. For S3 (autocorrelated by construction: 4 h steps on a 24 h look-back) the unit is one value per UTC day, the mean of that day's six
  4 h cohort values, giving 30 values; the same two tests apply. Lag-1..6 autocorrelation of the S3 cohort values is printed.
- PASS needs all: at least 27 of 30 counted cohorts for S2/S4; for S3 a UTC day counts if at least 5 of its 6 cohorts exist (its value is the mean of the existing ones) and at least 27 of 30 days must count; mean cohort excess > 0
  with p < 0.05 / 3 = 0.0167 on both tests; the mean cohort excess under stress costs > 0; the mean absolute net return per pick (missed trades counted
  as zero return, per pick not per cohort) > 0 under STRESS costs as well as base costs (printed with its own t statistic, not a decider beyond sign);
  coverage met. A cohort shortfall is INSUFFICIENT_DATA, not FAIL. Counts use integer arithmetic (ceil(9n/10)).
- Coverage, evaluated before any outcome is computed: at least 90% of scheduled holdout decision times have a book for 60 or more eligible
  markets and at least 90% of picks have an exit book; for S3 trade ticks must be exported and sha256-hashed daily (the host's retention pruning must not delete them before the print) and a tick gap above 10 minutes for a picked market inside a trading window makes that pick a data gap; otherwise INSUFFICIENT_DATA. Likewise
  INSUFFICIENT_DATA if fewer than 12 of 17 training days have 60 or more markets with a 00:00Z book that day. INSUFFICIENT_DATA is neither pass nor fail; it may be re-run ONCE with the same design hash and code, only after a documented data repair, and the first run's outcome is recorded.
- Planned minimum detectable excess (disclosed now, estimated from training-period spreads and an assumed daily cohort sd of 2-4%): with 30
  cohorts and p < 0.0167 a mean daily excess of about 0.4 sd, i.e. roughly 80-160 bp per day net, is needed. That is a very large edge. A
  non-PASS here is therefore NOT evidence that no edge exists; it only means none large enough was shown. The result line prints the
  observed sd, n and the smallest mean excess that would have passed.
- Beta caveat: long-only top-k picks can load on high-beta coins, so a strong rally can lift the paired excess without skill. The result
  prints each study's cohort excess split by benchmark return above and below zero (information only; the benchmark's sign is not conditioned on).
  A down day is a day whose benchmark base-cost net return is < 0 (empty-cohort days count). ALL three studies need a positive mean excess on down days with one-sided t p < 0.10 and at least 8 down days; with fewer than 8 down days the result is INSUFFICIENT_DATA (a strong rally never switches the clause off).
- A FAIL is recorded as a FAIL; the hypothesis is not re-run on the same data. Sensitivity grids (below) are printed for information,
  labelled SENSITIVITY, do not count toward the family and cannot decide PASS. The holdout 11-05..12-05 is consumed by this family: any
  later registration, including one inspired by a printed sensitivity, must use data after 2026-12-05T00:00Z.
- Family: three primary tests (S2, S3, S4), alpha 0.05/3 each. The existing order-book study keeps its own alpha and is not pooled here.

## Freeze and amendments

- The scripts embed the sha256 of this file's exact bytes (LF line endings) at the freeze commit and assert it; addenda are separate dated
  files listed in a registry and their hashes are asserted too. The hash proves the design is unchanged, not that a script implements it,
  so each script ships with tests that check its rules line by line against this file.
- The design is frozen at 2026-10-28T00:00Z. Before that only this review process changes it. After it this file is byte-immutable (any byte change would break every script's hash assert); typo corrections go only in a dated addendum listed in the registry. Validation returns are not computed before the freeze.
- Each script must be merged and tested only on data before 2026-11-05T00:00Z. A study whose script is not merged by then lapses (VOID)
  and is never run late.

## S2 - Momentum with order-book pressure, daily, 24 h hold

Hypothesis: a daily move is large relative to the ~20 bp cost plus the spread, so a signal agreeing across price and book pressure may keep an edge.
- Decision daily at 00:00Z; hold 24 h; 30 scheduled cohorts.
- Primary: among eligible markets with a book at t and at t-24 h, keep those with 24 h mid return > 0 AND the mean top-5 imbalance of the
  snapshots at t, t-1 h, t-2 h, t-3 h and t-4 h (each by the (t-2 min, t] rule; fewer than 3 available excludes the market) > 0;
  rank the kept markets by the sum of their percentile ranks (computed within the kept set) of the two signals; buy the top 3 (fewer if
  fewer qualify; no cohort if none, which then counts against the cohort minimum), equal weight; tie-break lowest market code.
- SENSITIVITY: holds 4 h, 12 h; look-back 48 h; reversal sign.

## S3 - Cheaper execution, 4 h hold

Hypothesis: part of the lost edge is the spread and slippage paid by crossing; resting limit orders may keep more of a small edge if they fill
and adverse selection does not eat the saving.
- Decisions every 4 h at 00,04,...,20Z; hold 4 h; the S2 signal with a fixed 24 h look-back; top 3; equal notional per pick: order quantity = 1,000,000 KRW / limit price (coin units); the fill fraction f = min(1, cumulative strictly-through volume / quantity).
  180 scheduled cohorts, analysed as 30 UTC days.
- Primary entry: a buy limit at the best bid of the book at the decision time (the last snapshot in (t - 2 min, t]; decision skipped if none),
  cancelled after 10 minutes. Primary exit: a sell limit at the best ask of the book at t+4 h by the same rule, cancelled after 10 minutes; if it
  is unfilled, or the book is missing, the position is closed as a taker at the best bid of the last snapshot in (t+4 h+10 min-2 min, t+4 h+10 min]
  with base slippage; if no such book exists the pick is a data gap. Unfilled entries are missed trades (zero return, counted).
- Fill model, conservative: a limit fills only for the part of its size covered by cumulative traded volume strictly through its price (below a
  buy limit, above a sell limit), counting only trades with placement + 1 s <= stamp < placement + 10 min, with no queue credit.
  Partial fills are allowed; an entry's fill fraction f scales that pick's size (it exits f of the quantity, and the unfilled remainder of a partially filled exit is closed as a taker under the same fallback); cohort return = sum(f_i x r_i) / (number of picks selected), missed picks have f = 0; the entry fill
  rate printed is the size-weighted fill fraction, and a pick with fraction below 0.05 counts as a missed trade. The hold is measured from
  the decision time t, not the fill time.
- Tests: (a) execution test: the paired per-day improvement of the maker execution over a taker execution of the SAME signal and picks
  (taker entry at the ask at t, taker exit at the bid at t+4 h, base costs), missed trades counted as zero in the maker value, both tests at
  one-sided alpha 0.05; (b) the excess-vs-benchmark test is computed against the TAKER benchmark (same eligible basket, taker execution) scaled by that day's size-weighted fill fraction, so that being out of the market on a falling day cannot produce excess, and
  needs p < 0.0167; (c) size-weighted entry fill rate at least 30%. (d) the signal itself must carry information, independent of how it is executed: the per-day gross excess (mid-to-mid return of the picks minus the mid-to-mid return of the same-universe benchmark, no costs; a missing exit mid is marked to the last bid, a gap is -100%) must be > 0 with both tests at one-sided alpha 0.05. PASS needs all four plus the common conditions. Missed trades are
  never dropped.
- SENSITIVITY: cancel 5 / 15 minutes; top-k 1, 2, 5; maker fee at an assumed lower tier (labelled).

## S4 - Cross-sectional daily reversal

Hypothesis: a low-turnover reversal across ~300 KRW markets keeps an edge that single-market rules cannot.
- Series: mid prices from the (t - 2 min, t] book rule. Decision daily at 00:00Z; hold 24 h; 30 scheduled cohorts. Long-only (the PAPER account
  has no spot short).
- Primary: buy the 5 eligible markets with the lowest 24 h mid return (markets with a book at t and t-24 h only), equal weight; tie-break
  lowest market code.
- SENSITIVITY: look-back 72 h; k = 3; momentum sign; spread <= 10 bp universe (benchmark uses the same filtered universe).

## What a result changes

- HOLDOUT_PASS: a forward SHADOW test of that exact configuration is qualified for design. Nothing is deployed to PAPER; no gate changes.
- HOLDOUT_FAIL, INSUFFICIENT_DATA or VOID: recorded in `docs/research-ledger/experiments.json`.
- Expected outcome, stated plainly: most such studies fail, and the bar needs a very large daily edge. These are cheap, honest tests, not a promise of an edge.

## Not done here

No script, run or data read. Implementation (one deterministic read-only script per study) is a separate reviewed PR that must match this file exactly.
