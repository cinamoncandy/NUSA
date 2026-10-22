# Pre-registered study S5: order-book imbalance, 15-minute horizon (design v1, 2026-10-22)

Status: DESIGN ONLY. No script, no data read. Committed before any order-book row was examined for this signal. PAPER_ONLY,
liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY. A result is research evidence; a PASS only qualifies a
forward SHADOW test, never a promotion. Nothing below may change after the freeze (see Freeze).

## Why this study

S2-S4 decide once a day, so one cohort is one sample and a verdict needs about 30 days. The order-book collector sees ~290 KRW
markets every minute, so a decision every hour gives 24 cohorts a day. S5 asks one narrow question that is fast to answer: **does the
top-5 depth imbalance predict the next 15 minutes of mid-price return across markets, and if so, is it larger than what taking liquidity
costs?** Expected outcome, stated plainly: the gross effect may exist but is likely to be a few basis points, below taker cost, so the
net test probably fails. The gross answer still matters: it tells S3/maker work whether there is any signal worth executing cheaply.

## Data (what exists, and the limit it sets)

Books come from `research_orderbook_samples` UNION `research_orderbook_study_rows` (scripts/lib/orderBookSource.js). After the 14-day
prune only minutes 58, 59, 0 of every hour, minutes 1-10 of the 4-hourly hours and minutes 43-45 of every hour are kept. S5 therefore
uses only books at minutes 43-45 and 58-0. This needs PR #2854 (migration 032) deployed on the server before 2026-10-28T01:22Z, else
the early training days are gone and the study is VOID (declared, not repaired).

## Design

- **Spans (UTC):** eligibility training 2026-10-15T00:00 .. 2026-11-05T00:00. Reserved gap 2026-11-05 .. 2026-11-12 (the S2-S4 holdout; never
  used here). **Holdout 2026-11-12T00:00 .. 2026-11-26T00:00 (14 days, 336 decision hours).** First verdict printed from 2026-11-26T02:00Z.
- **Decision times:** every hour at hh:45. Entry book at t = the last sample in (t - 2 min, t]. Exit book = the last sample in
  (t + 13 min, t + 15 min]. Horizon is 15 minutes from the decision time.
- **Eligible market** (training data only): has an entry book and an exit book in >= 90% of training decision hours AND median training
  spread <= 20 bp. At least 60 eligible markets must have a valid entry+exit book in a cohort, else that cohort is counted as empty
  (excess 0, counted in n, not a down block).
- **Signal:** imb5 = (bid_size_5 - ask_size_5) / (bid_size_5 + ask_size_5) of the entry book (0 when both are 0). One feature, no model,
  no fitted parameter, nothing tuned. Rank markets by imb5; ties broken by market code ascending.
- **Picks:** S5H = the top ceil(10% of valid markets) by imb5 (high bid-side depth); S5L = the bottom ceil(10%). Equal weight. Two
  hypotheses, one cohort each hour.
- **Returns:** gross r_i = mid(exit) / mid(entry) - 1. Benchmark = mean r over all valid markets of the cohort (same universe, same hour).
  Excess_c = mean(r of picks) - benchmark. Taker net of a pick = bid(exit) x (1 - fee) / (ask(entry) x (1 + fee)) - 1 with fee 5 bp per
  side (base) and 10 bp per side (stress); the spread is already inside ask/bid.
- **Data gaps:** a pick whose exit book is missing is valued -100% and counted; a benchmark market with a missing exit book is excluded
  and counted. Pick gaps above 5% of picks or benchmark gaps above 5% of benchmark markets give INSUFFICIENT_DATA. At least 300 of the 336
  cohorts must be non-empty (integer minimum ceil(9 x 336 / 10) = 303 is used), else INSUFFICIENT_DATA.
- **Unit of inference = 4-hour block** (84 blocks: 00-04, 04-08, ... UTC). Block value = mean of the Excess_c of its cohorts. Hours inside
  a block share market state, so cohorts are not independent; blocks are the pre-registered compromise. The lag-1..6 autocorrelation of
  block values is printed.
- **Tests per hypothesis** (S5H and S5L separately), on block values: one-sided Student t (df = blocks - 1) AND sign-flip permutation
  (100,000 flips, mulberry32 seed 20261022, p = (1 + count) / 100001). **Alpha = 0.05 / 2 = 0.025** (Bonferroni over the two
  hypotheses; they are the only primary tests of S5).
- **Verdict per hypothesis:**
  - `SIGNAL_NOT_FOUND` if either gross test has p >= 0.025 or the mean excess <= 0.
  - `SIGNAL_EXISTS_NOT_TRADABLE` if both gross tests pass but base taker net per pick <= 0 (or stress net <= 0). This is information, not a pass.
  - `HOLDOUT_PASS` only if both gross tests pass AND mean base taker net per pick > 0 AND stress taker net per pick > 0 AND the mean excess on
    blocks whose benchmark return is negative is > 0 (at least 8 such blocks, else the clause is not met).
  - `INSUFFICIENT_DATA` per the gap and cohort rules above; `WAITING_DATA` before 2026-11-26T02:00Z.
- **Printed (not tested):** mean gross excess in bp, mean taker net in bp (base and stress), block count, sd of block values, minimum
  detectable excess at the used alpha, the fraction of picks that are gaps, the dataset sha256 and row count (same dataset-identity rule
  as the other studies), S5H and S5L excess in each half of the holdout.
- **Fails closed:** any stored row stamped more than 5 s after the run time gives DATA_INTEGRITY_FAIL.

## What is deliberately not done

No learned model, no combination of features, no maker/limit-order fill model (that is S3's job; S5 only says whether a signal exists),
no second look at the holdout, no change of the 10% pick size, the horizon or the block length after seeing data. Sensitivity runs
(pick share 5% / 20%, horizon-matched benchmark) may be printed but are outside the decision.

## Freeze and amendments

The design is frozen by a sha256 of this file's exact LF bytes, set as `DESIGN_SHA256` in a commit after the final design commit and
before 2026-11-05T00:00Z. The runner refuses to run while the hash is PENDING or the bytes differ. Changes after the freeze are only dated,
hashed addenda that change no rule above. The scripts must be reviewed, merged and tested before 2026-11-12T00:00Z, else S5 is VOID.
