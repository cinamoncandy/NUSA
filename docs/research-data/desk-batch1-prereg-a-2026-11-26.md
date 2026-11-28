# PREREG desk-a: six NEW cross-sectional daily families (K=6). Fixed before any run.
Data: cs-data/<MARKET>.json, rows [tsMs, o,h,l,c,vol]. Offline only. Mechanics copied from reference scripts/offline-crosssection-screen.js (commit 8f99e771f).
## Common
- Decision at close of day D (all features use candles <= D only); entry close D, exit close D+H. Cohort days: (D/86400000) % H == 0 (non-overlapping), exit <= last day. Exception WEEKDAY_XS (below).
- Benchmark universe: markets with candle on D and age >= 90 days (D - first candle >= 90d). Need >=20 such markets else skip cohort. Picks must also have full lookback candles (missing -> not a candidate).
- Top N=5 by score (ties by market code), equal weight, long only; fewer than 5 candidates -> hold those; none -> no cohort. Markets lacking an exit candle are dropped from the average.
- Cost per side 15bp base, 30bp stress: ret = c_exit*(1-fee)/(c_entry*(1+fee))-1. Excess = pick mean - benchmark mean (benchmark = all benchmark-universe markets, same costs).
- Discovery: cohorts with day < last-365d; cut into 6 consecutive equal-count windows (size=floor(n/6), need size>=10); base mean excess>0 in >=4/6; mean excess over UP-benchmark windows >0 AND over DOWN-benchmark windows >0 (both must exist; window sign = mean benchmark return); stress mean excess>0 in >=4/6.
- Second filter (last 365d cohorts): >=30 cohorts, mean excess>0, one-sided normal-approx t p < 0.05/6 = 8.33e-3, stress mean excess>0.
## Families
1 SIZE_REV H=7: turnover = mean over D-29..D of volume*close; keep the lowest floor(n/2) markets by turnover (among those with 30d history and 7d history); score = -(close D/close D-7 - 1).
2 LISTING_AGE H=7: candidates age in [90,240] days since first candle in file; score = (close D/close D-28 -1) / std of last 28 daily log returns.
3 WEEKDAY_XS H=3: cohort only when UTC weekday of D is Friday ((D/86400000+4)%7==5); score = 3-day return close D/close D-3 -1. (Fridays 7d apart, hold 3: no overlap.)
4 BTC_BETA_ROT H=7: if KRW-BTC close D/close D-20 -1 > 0: score = OLS beta of market daily simple returns on BTC daily simple returns over last 60 days (cov/var); top 5 highest beta (excluding BTC). Else no cohort (skipped, not counted as zero).
5 VOL_COMPRESS_BREAK H=5: range10(t) = (max high t-9..t - min low t-9..t)/close t; candidate if range10(D) <= 20th percentile (sorted value at index floor(0.2*(n-1))) of range10 over the 120 days D-119..D, AND close D > max high of D-10..D-1; score = volume D / mean volume D-20..D-1.
6 DOWNVOL_LOW H=14: score = -(sample std of negative daily simple returns among the last 60 daily returns; need >=5 negatives else not candidate).
## Pass bars: both discovery and second filter as above. A pass is only eligibility for forward pre-registration, not evidence. No rule/bar changes after results.
