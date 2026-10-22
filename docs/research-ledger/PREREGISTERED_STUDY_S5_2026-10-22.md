# Pre-registered study S5: order-book imbalance, 15-minute horizon (design v3, 2026-10-22)

Status: DESIGN ONLY. No script, no data read. Committed to the repository before any order-book row was examined for this signal. The older order-book study (WO-RESEARCH-20261014-ORDERBOOK-STUDY) contains imb5 among its features, so S5 is not blind to the idea; this design is frozen before that study prints (2026-10-29T02:00Z), so S5 has seen none of its output. PAPER_ONLY,
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

- **Spans (UTC):** eligibility training 2026-10-15T00:00 .. 2026-11-01T00:00 (it includes the old order-book study's holdout days 10-25..10-28, used only for eligibility, as S2-S4 also do; the S2-S4 validation window 2026-11-01..11-05 is not touched). Unused gap 2026-11-01 .. 2026-11-12. **Holdout 2026-11-12T00:00 .. 2026-11-26T00:00 (14 days, 336 decision hours).** This holdout lies inside the S2-S4 holdout (2026-11-05..12-05), i.e. the same weeks; S5 is a separate test with its own alpha and is never pooled with S2-S4. If S5 and S2-S4 disagree, every verdict is reported as it is. First verdict printed from 2026-11-26T02:00Z.
- **Decision times:** every hour at hh:45. Entry book at t = the last sample in (t - 2 min, t]. Exit book = the last sample in
  (t + 13 min, t + 15 min]. Horizon is 15 minutes from the decision time.
- **Book at a time (no look-back):** the book at t is the LATEST sample in the window; if that sample is not valid the market has no book at t (no fall-back to an earlier valid sample). The entry window is (t - 2 min, t], the exit window is (t + 13 min, t + 15 min]; a market whose exit sample is invalid has no exit book. The last decision (2026-11-25T23:45Z) exits at 2026-11-26T00:00Z exactly, which is allowed. Rows are never ties after the (market, stamp) dedup.
- **Valid book:** best_bid > 0, best_ask > 0, best_bid <= best_ask, bid_size_5 + ask_size_5 > 0, stamp inside the window (open at the start, closed at the end). Rows are deduplicated by (market, stamp) before use, so the row count and sha256 are stable. Mid = (best_bid + best_ask) / 2.
- **Eligible market** (training data only): has a valid entry book and a valid exit book in at least minimumCount(training decision hours) = ceil(9n/10) of the n training decision hours (integer arithmetic, as scripts/lib/preregisteredStudyStats.js `minimumCount`) AND the UPPER median of its entry-book spreads (bp) over those training decision hours is <= 20 (no values = not eligible). The ranked set, the benchmark set and every gap denominator below are the eligible markets with a valid entry book at t. A cohort is non-empty only if at least 60 eligible markets have a valid ENTRY book at t, else it is empty (excess 0, counted in n, not a down block).
- **Signal:** imb5 = (bid_size_5 - ask_size_5) / (bid_size_5 + ask_size_5) of the valid entry book. One feature, no model, no fitted
  parameter, nothing tuned. Rank the eligible markets with a valid entry book at t (ranking never looks at the exit book) by imb5; ties are broken by the LOWEST market code (bytewise) winning the better position for both S5H and S5L.
- **Picks:** S5H = the top ceil(n/10) (integer: floor((n + 9) / 10), n = ranked markets) by imb5 (high bid-side depth): a momentum hypothesis, bid-heavy books are followed by rises. S5L = the bottom ceil(n/10): a contrarian long-only hypothesis, ask-heavy books are followed by rises (it tests that low-imbalance picks OUTPERFORM; no short position is simulated). Equal weight per pick. Two hypotheses, one cohort each hour.
- **Returns:** gross r_i = mid(exit) / mid(entry) - 1. Benchmark = mean r over the benchmark set of the cohort (the ranked markets with a valid exit book, same hour).
  Excess_c = mean(r of picks) - benchmark. Taker net of a pick = bid(exit) x (1 - fee) / (ask(entry) x (1 + fee)) - 1 with c = (fee + slippage) / 10000 per side, the SAME costs as S2-S4: base 5 bp fee + 5 bp slippage, stress 10 bp fee + 10 bp slippage. The spread is inside ask/bid, so the slippage term is deliberately conservative (an extra safety margin, not a double count error).
- **Data gaps:** among ranked markets, a pick without a valid exit book is valued -100% and counted as a gap; a benchmark market without a valid exit book is excluded and counted. Gap limits are pooled over the whole holdout, per hypothesis: pick gaps above 5% of all picks, or benchmark gaps above 5% of all benchmark markets, give INSUFFICIENT_DATA (integer test: gaps x 20 > picks, or benchmark gaps x 20 > benchmark markets). At least 303 of the 336 cohorts (integer ceil(9 x 336 / 10)) must be non-empty, else INSUFFICIENT_DATA.
- **Unit of inference = 4-hour block** (84 blocks: 00-04, 04-08, ... UTC). A cohort belongs to the block of its decision hour (the 03:45 decision, which exits at 04:00, is in block 00-04). Block value = mean of the Excess_c of its 4 cohorts (empty cohorts contribute 0). Hours inside a block share market state, so cohorts are not independent; blocks are the pre-registered compromise. The lag-1..6 autocorrelation of block values is printed, and the dependence guard is: for each hypothesis, the lag-1 autocorrelation r1 of its 84 gross-excess block values, r1 = sum over t = 2..84 of (x_t - m)(x_(t-1) - m) divided by sum over t = 1..84 of (x_t - m)^2, m = mean, is compared with 0.3. If r1 > 0.3 the outcomes HOLDOUT_PASS and SIGNAL_EXISTS_NOT_TRADABLE of that hypothesis become INCONCLUSIVE_DEPENDENCE (positive dependence only inflates false positives, so SIGNAL_NOT_FOUND is never changed).
- **Tests per hypothesis** (S5H and S5L separately), on block values, with exactly the implementations of scripts/lib/preregisteredStudyStats.js (`studentTUpperP`, `signFlipP`, the sd tolerance 1e-12; sd below it fails the test): one-sided Student t (df = blocks - 1) AND sign-flip permutation (100,000 flips, mulberry32 seed 20261022, same draw order, p = (1 + count) / 100001). **Alpha = 0.05 / 2 = 0.025** (Bonferroni over the two
  hypotheses; they are the only primary tests of S5).
- **Verdict per hypothesis** (precedence, first match wins): DATA_INTEGRITY_FAIL; VOID (a deadline below was missed); WAITING_DATA (before 2026-11-26T02:00Z);
  INSUFFICIENT_DATA (gap limits, 303 cohorts, or fewer than 8 down blocks); INCONCLUSIVE_DEPENDENCE (r1 > 0.3 and both gross tests passed); then
  - `HOLDOUT_PASS` only if both gross tests pass (p < 0.025, mean excess > 0) AND mean base taker net > 0 AND stress taker net > 0 AND the mean excess on down blocks is > 0 with one-sided Student t p < 0.10 (the S2-S4 down-day clause). A down block is a block whose benchmark base-cost net return is < 0 (mean over its non-empty cohorts of the mean base-cost net return of the benchmark set); at least 8 are needed.
  - `SIGNAL_EXISTS_NOT_TRADABLE` if both gross tests pass and the net or down-block condition above fails. Information, not a pass.
  - `SIGNAL_NOT_FOUND` otherwise (a gross test failed). If both S5H and S5L pass the gross tests the likely cause is thin books at both tails, not direction; this is recorded as such and neither is treated as a signal without a new pre-registration.
  Taker net is the mean over all 336 cohorts of the cohort-mean net of its picks (gap picks -100%, empty cohorts 0). Assumptions, all optimistic for the taker: fill of the whole position at the best ask/bid of the same snapshot that produced the signal, no size limit, no latency, no depth impact.
- **Printed (not tested):** mean gross excess in bp, mean taker net in bp (base and stress), block count, sd of block values, minimum
  detectable excess at the used alpha, the fraction of picks that are gaps, the dataset sha256 and row count (same dataset-identity rule
  as the other studies), S5H and S5L excess in the first and the last 7 days of the holdout, the distribution of the realised horizon (exit stamp - entry stamp), and the gap-pick share per cohort. The dataset identity is the sha256 over the deduplicated rows actually read (entry and exit windows of eligible markets) in canonical (market, stamp) order.
- **Fails closed:** any stored row stamped more than 5 s after the run time gives DATA_INTEGRITY_FAIL.

## What is deliberately not done

No learned model, no combination of features, no maker/limit-order fill model (that is S3's job; S5 only says whether a signal exists),
no second look at the holdout, no change of the 10% pick size, the horizon or the block length after seeing data. Sensitivity runs
(pick share 5% / 20%, horizon-matched benchmark) may be printed but are outside the decision.

## Freeze and amendments

The design is frozen by a sha256 of this file's exact LF bytes, set as `DESIGN_SHA256` (and addenda in the ADDENDA registry) in scripts/lib/preregisteredDesign.js, in a commit after the final design commit and
before 2026-10-29T00:00Z (before the older order-book study prints). The runner refuses to run while the hash is PENDING or the bytes differ. Re-run rule as S2-S4: only an INSUFFICIENT_DATA verdict may be re-run ONCE, with the same design hash and code, after a documented data repair, and the first outcome is recorded; every other verdict stands and the hypothesis is not re-run on the same data. A missed PR #2854 deadline makes the study VOID. Changes after the freeze are only dated, hashed addenda that change no rule above. The scripts must be reviewed, merged and tested before 2026-11-12T00:00Z, else S5 is VOID.
