# Pre-registration (DRAFT for independent review): pooled hourly signal screen on five KRW markets, candles only (PAPER research)

Status: **DRAFT, written 2026-11-20 (KST), before any candle value of the screening span exists.** It becomes a pre-registration only when this file is merged on main after an independent non-author review and **before 2026-11-30T00:00Z** (before the cross-market holdout opens, so that its result cannot steer the signal list); from then on nothing here may change, and any change starts a new pre-registration with a new date. **If it is merged later than that, this document is void and a new pre-registration with a new date is needed.**
Work order: `WO-LEARNING-20261120-SIGNAL-SCREEN-PREREG`. Study id: `RULE_SIGNAL_SCREEN_60M_20261120`.
Design it follows: `docs/RESEARCH_SIGNAL_SCREEN_DESIGN_2026-11-20.md`. **Owner decision 2026-11-20 (KST): use the 30-day screen ("쓰자").** Learning loop: L1 candidate supply (the label used by the cross-market pre-registration).

Scope: PAPER research only. No order, no account, no runtime wiring, no limit change. A PASS makes a signal eligible for **its own** pre-registered tradability test (costs, spreads, a later span); it is not eligible for a SHADOW test and is not promotion evidence.

## 1. Question and prior
Does any of six fixed candle-only signals carry hourly cross-sectional information about the next-hour return on KRW-XRP, BTC, ETH, SOL and DOGE? Honest prior: **low**. Hour-scale predictability on liquid spot markets is rarely found, and earlier families here failed. The value is information per calendar time, not a high chance of success.

## 2. Universe, bars, eligibility
- Markets: KRW-BTC, KRW-DOGE, KRW-ETH, KRW-SOL, KRW-XRP (fixed). Ties inside a rank vector use average ranks.
- Data: stored 1-minute candles (`research_closed_candles`, interval 60000) and the candle absence proofs. `close_i(t)` is the `close` of the stored row whose field `close_time_ms` equals t (the stored close time is used as it is, with no shift: the row for the minute that ends at t). A one-hour bar ending at t is **complete** if all 60 one-minute closes with close times in (t - 60 min, t] are present or proven exchange-absent; an incomplete bar is missing. Order books and trade ticks are **not used** (their coverage is partial; a later screen may use them after a separate coverage rule).
- Decision times are every full UTC hour t. A market is **eligible at hour t** (it needs `close_i(t)` to exist: a complete bar whose last minute is absent has no close and is not eligible) if its bar ending at t is complete and `close_i(t)`, `close_i(t - 72 h)` and `close_i(t + 1 h)` exist (the latter only in the screening span). An hour with fewer than **3** eligible markets is skipped and counted.
- A market is **eligible for the study** if at least **152 of the 168** decision hours of the eligibility part (below) have a complete bar (bar completeness only). Markets that fail are left out of the whole screen. Fewer than 3 eligible markets: `INSUFFICIENT_DATA`.

## 3. Spans (fixed now, in the future; none overlaps the cross-market study, whose holdout ends 2026-12-10T00:00Z)
Decision hours of a part are the full hours t with `from <= t` and `t + 1 h <= to` (an exit exactly at the part end is kept); the screening span therefore has the 720 decision hours t = 2026-12-18T00:00Z .. 2027-01-16T23:00Z and needs `c(t+1h)` up to 2027-01-17T00:00Z.

| Part | From (UTC) | To (UTC) |
|---|---|---|
| Eligibility | 2026-12-11T00:00Z | 2026-12-18T00:00Z |
| Screening | 2026-12-18T00:00Z | 2027-01-17T00:00Z |
- The screening span has 720 decision hours (30 blocks of 24 h). The 72 h lookback of the first decision needs candles from 2026-12-15T00:00Z; their coverage is counted in the eligibility check only as presence of bars, no value is read.
- The run may not start before **2027-01-17T00:30Z**; the screening span is opened **once**.
- Blindness is a **convention, and this document says so**: nobody may read candle values from 2026-12-11T00:00Z on before the run. Counting hours that hold data is allowed. Disclosed facts: KRW-XRP candle values flow into the daily XRP experiments and their records, so XRP is **not blind after the fact**; earlier studies read order-book and trade data of several markets (not used here); the signal list was written after those studies, which is a family-selection channel that is disclosed and limited by the freeze (this file must be merged before the cross-market run so that its result cannot steer the list).
- If the service is down, **manual repair is not allowed**; rows that the service's automatic gap-fill stored by the run time are used as stored (the dataset sha256 records the identity); a missing hour counts against the 90 percent bar and the usable hours.

## 4. The family (K = 6, frozen)
Every signal is computed per market i at decision hour t from closes only (`c_i(t)` = close at t), and **its direction is fixed**: the tested quantity is `s * IC` where s = +1 or -1 below, so that a positive tested value means the stated direction.
| # | Signal | Formula | Direction s |
|---|---|---|---|
| 1 | RET6 | c(t)/c(t-6h) - 1 | -1 (short-term reversal) |
| 2 | RET24 | c(t)/c(t-24h) - 1 | +1 (momentum) |
| 3 | RET72 | c(t)/c(t-72h) - 1 | +1 (momentum) |
| 4 | VOL24 | sample standard deviation of the 24 hourly log returns ln(c(u)/c(u-1h)) for u = t-23h..t | -1 (lower realized volatility, higher return) |
| 5 | SURGE | sum of volume over the last hour / (sum of volume over the last 24 h / 24) | +1 |
| 6 | RANGE | (c(t) - min close over t-24h..t) / (max close - min close) over the same 25 closes (undefined if max = min) | +1 |
- **Missing values (all signals):** there is **no forward fill**. Any needed close that does not exist (including a minute that is proven exchange-absent, which has no candle) makes that signal missing for that market-hour. RET6, RET24 and RET72 need only `c(t)` and the lagged close; VOL24 and RANGE need the **25 hourly closes** `c(t-24h), c(t-23h), ..., c(t)` (the closes at the full hours, not minute closes); VOL24 uses natural log returns and the sample standard deviation (n - 1) of the 24 hourly log returns.
- **SURGE** uses the stored candle column `volume` (the volume as stored per 1-minute candle). The last-hour sum covers the 60 candles with close times in (t - 60 min, t] and the 24 h sum the 1440 candles with close times in (t - 24 h, t] (they include the last hour). A minute proven exchange-absent counts as volume **zero**; a stored row with a null `volume` makes SURGE missing; a 24 h sum of zero makes SURGE missing. RANGE with max = min has no value.
- A market-hour that is missing for a signal is left out of that signal's cross-section for that hour (reported by counts).
- Target: `y_i(t) = c_i(t + 1h) / c_i(t) - 1`.
- Dropped on purpose and not in the family: 1 h return (nested with the target), the return relative to the market mean (same cross-sectional ranks as the same-lookback return), and every order-book or trade-tick signal.

## 5. Statistic and test (identical for each signal)
- For each hour t with at least 3 markets that have a value of the signal and `y`: the **Spearman rank correlation** (average ranks for ties) `IC(t)` between the signal values and `y` across those markets. Hours with a constant rank vector have no IC and are excluded and counted. `n(t)` = the number of markets used.
- Per signal the series is the **usable hours in time order with the unusable hours removed (gaps closed up)**; `T` is its length; `x_j = s * IC(t_j)` and `w_j = n(t_j) - 1`. Weighted mean `M = sum_j w_j x_j / sum_j w_j`.
- **Stationary bootstrap** (null imposed by centring), algorithm (IEEE double arithmetic, sums in index order):
  ```
  x'_j = x_j - M
  for b = 1..B (B = 10,000, in order):
    sumWX = 0; sumW = 0
    for pos = 0..T-1:
      if pos == 0:                j = floor(u() * T)
      else if u() < 1/24:         j = floor(u() * T)      # a new block; the test is strict
      else:                       j = (j + 1) mod T
      sumWX += w_j * x'_j; sumW += w_j
    Mstar_b = sumWX / sumW
  p = (1 + #{b : Mstar_b >= M}) / (B + 1)
  ```
  (the draw order inside the `if` is: one `u()` for the restart test, then, only if it restarts, one `u()` for the start index; the pair `(x'_j, w_j)` is resampled together). Random numbers: **splitmix64** seeded with the integer 20261120 gives, in order, the four 64-bit state words `s0, s1, s2, s3` of **xoshiro256\*\*** (`result = rotl(s1 * 5, 7) * 9`, `t = s1 << 17`, `s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 45)`, all mod 2^64); a uniform `u` is the top 53 bits of one output divided by 2^53. **A new generator seeded with 20261120 starts for every signal** (the same stream is used for each signal, in the table order). Test vector: the first three uniforms for seed 20261120 are 0.33736467085460264, 0.38063347140274995, 0.34159181396718497.
- **Holm adjustment over K = 6:** order the six raw p-values ascending (ties by table order) as `p_(1) <= ... <= p_(6)`; `adj_(k) = min(1, max_{j<=k} (6 - j + 1) * p_(j))`. A signal marked INSUFFICIENT_DATA **stays in K = 6 with p = 1**. A signal **passes** if `M > 0` and its adjusted p < 0.05.
- A signal is `INSUFFICIENT_DATA` if it has fewer than **600 usable hourly ICs** (25 blocks; deliberate slack for outages: the power numbers below are for 720 hours); the whole screen is `INSUFFICIENT_DATA` if fewer than 3 markets are eligible. The rules are not changed and the span is not re-run. The p-values are **approximate** (a block bootstrap with about 30 blocks and signals whose IC series have an autocorrelation longer than 24 hours, such as RET72, can be anti-conservative); a **null simulation of the script** (size at 0.05 and at 0.0083 on autocorrelated synthetic series, stated in the script PR) is required before the screening span opens.
- A PASS must be re-tested under **executable prices** in its own tradability test: the target here is last trade to last trade without execution lag, so a reversal signal (RET6) or a thin market (DOGE) can look informative from bid-ask bounce alone.
- Reported, not tested: per-signal mean `s IC`, number of usable hours, p and adjusted p; the same IC against the next-4 h return (descriptive only, never PASS-eligible, no p; hours with `t + 4 h` after the span end are excluded and counted); the mean `s * IC` by UTC week counted in blocks of 7 days from the span start (the last block has 2 days); dataset identity as sha256 over the ordered rows used with their counts and time range.

## 6. Power (assumptions, not measured data)
For one hourly rank IC across 5 markets the null standard deviation is about 0.5. Over 720 hours (the figures are for 720 usable hours only) the standard error of the weighted mean is about 0.019 if hours were independent, larger with autocorrelation and the common factor. Holm with K = 6 needs a one-sided p near 0.008, a z near 2.4: a mean IC near **0.05 or more to pass** and about **0.07 for 80 percent power** (the plain calculation gives about 0.06; 0.07 already allows for autocorrelation). An IC of 0.03 has well under 50 percent power. **A FAIL says nothing about smaller information coefficients.** Holm is valid under any dependence but is conservative because the signals are correlated.

## 7. Hypothesis count and family
K = 6 (the 4 h target is descriptive and not counted). The threshold 0.05 with Holm is used for every test. This is a **separate family and dataset**, registered like the trade-flow, order-book and cross-market studies; it is not part of the runtime experiment ledger or its cumulative holdout bar, nor of the cross-market study's family.

## 8. Preconditions and recording
- The five-market candle collection runs (running since the release of 2026-11-19; the build released on 2026-11-20 is `fd8f4770b`). Coverage is reported as counts only.
- A study script (`scripts/run-signal-screen.js`) and its tests are written **after** this document is merged, reviewed independently, and released before the eligibility part starts if possible; one release inside the span is tolerable only if the coverage bars still hold. The script pins its commit in its PR.
- A result line `SIGNAL_SCREEN_STUDY {...}` (fixed status code, numbers, booleans, dataset identity) is read by the host diagnosis and recorded in the work order and in `docs/research-ledger/experiments.json` **as a separate family that does not add to the cumulative holdout count**.

## 9. What this document does not do
It does not change any experiment, gate, threshold, limit, capital, order switch or authority, starts no run, writes no study code, and does not widen the experiment markets (`experimentMarkets` stays KRW-XRP).
