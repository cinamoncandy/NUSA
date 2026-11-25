# Three research directions after the owner's "다 해" (2026-11-25 KST): what is new, what is not

Status: **OWNER-CONFIRMED, independently reviewed, registers on merge** (owner: "해", 2026-11-25 KST, after the three numbers of section 2.5 were put to the owner; independent non-author read-only review the same day, findings applied below). Nothing was run and no data value was read to write this file. Direction 1 is registered only when this file is merged before 2026-12-07T00:00Z (UTC). PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`. No gate, threshold, risk limit, capital, host, release or authority is touched. A PASS would qualify only a forward SHADOW test, never promotion.
Work order: `WO-RESEARCH-20261125-THREE-DIRECTIONS`. Follows `docs/LEARNING_NEXT_CANDIDATES_2026-11-25.md` (which recommended waiting for the three results) and `docs/RESEARCH_BROAD_UNIVERSE_DISCOVER_RESULT_2026-11-25.md` (`NO_CANDIDATE`).

Korean summary (한 줄): 세 방향 중 새 것은 1번(주간 추세, 앞으로 모을 데이터로만 판정)뿐이고, 2번은 "안 본 과거 자료가 없다"는 점검 결과이며, 3번은 이미 있는 비용 표로 충분하다. 소유자가 숫자 3개를 확정했고("해"), 독립 검토 결과를 반영해 병합하면 1번이 등록된다.

## 0. The rule that decides everything: what data is still unseen
Taken from `docs/RESEARCH_BROAD_UNIVERSE_DISCOVERY_DESIGN_2026-11-24.md` and the S2-S4 design:
| Data | State |
|---|---|
| daily candles of all 295 KRW markets 2021-10-13 .. 2026-10-13 | **seen** |
| 60m closes of 106 markets 2025-10 .. 2026-10 | **seen** |
| 60m closes of BTC, ETH, SOL, NEAR, XRP 2021-12-20 .. 2024-10-31 | **seen** (spent look) |
| hourly closes of the other KRW markets 2021-12 .. 2024-10 | not read at hourly resolution; the broad discovery found `NO_CANDIDATE` on 2021-12-20 .. 2023-06-30, so its 2023-07 .. 2024-10 hold-back has no rule to veto |
| order-book values from 2026-11-25T19:00Z until the third order-book run (2026-12-10T02:00Z) | **must not be read** (counts and timestamps only) |
| S2-S4 holdout 2026-11-05 .. 2026-12-05 | **must not be read** until their result prints |
| data after 2026-12-05T00:00Z (S2-S4 later registrations must use it) | **unseen: this is the only blind data left** |
Consequence: **any new strategy can only be judged on data that does not exist yet.** A historical "analyse every past chart" run is not blind any more and was already done (`NO_CANDIDATE`, 56 markets, 686,063 hours, 64 rules, 0 passing).

## 1. Direction 3 first (it is short): execution and cost, no new study
The only established result across the rule study, the history mining and the broad discovery is the **cost wall**: spot fee 5 bp a side plus spread; hourly direction prediction cannot clear it. What is already measured and committed: per-market tick and spread-floor costs (`docs/RESEARCH_BROAD_UNIVERSE_METADATA_2026-11-24.md`, 300 KRW markets), and the maker-fill question is already inside S3 (first verdict 2026-12-05). A new cost study would have to read order-book values that are not allowed to be read before 2026-12-10 (section 0), so it would either break a blind or repeat S3. **Decision proposed: no new execution study now.** After 2026-12-10 the S3 and third order-book results give the measured cost and fill numbers; a cost-table update then needs no pre-registration (it is descriptive).

## 2. Direction 1: weekly trend with a seven-day hold, judged forward only (PRE-REGISTRATION)
Why this one: the cost wall is amortised by a long hold, and no pre-registered study covers a weekly horizon (S2/S4 hold 24 h on order-book pressure, S3 4 h maker, S5 15 m, RET48 BTC/ETH/SOL/NEAR 24 h). The choice is made from the cost argument, not from looking at returns. **Honest limit:** momentum with a long lookback is not a new idea and the daily history of all markets was seen, so the historical part cannot test it; only the forward test can.

### 2.1 Universe (fixed from metadata, before any return exists)
All KRW markets in a metadata snapshot taken on the registration day with: median tick over median close **at most 20 bp** (this is the bar the broad discovery finally used, `docs/RESEARCH_BROAD_UNIVERSE_LOOSER_FILTER_PREREG_2026-11-24.md`; the stricter 10 bp bar left only 29 markets and was dropped there, so it is not used here), median daily traded value at least 1 billion KRW over the 30 days before the snapshot, listed at least 30 days before the first decision, **excluding BTC, ETH, SOL, NEAR, XRP and DOGE** (the markets of other pre-registered studies) and markets under an exchange warning on the snapshot day.
- The filter reads **only tick size, median close and median quoted traded value of the 30 days before the snapshot, never a return, and no order-book value.** It is run on the registration day by the registering commit; the list is written into that commit and **frozen for the whole span**.
- **Minimum size:** if the frozen list has fewer than 30 markets, this study is **not registered** (no loosening of any bar). A cohort counts only if at least 20 universe markets have both an entry and an exit value; otherwise it is not counted.
- Disclosed: at registration the lookback of the first cohorts (from about 2026-11-09) already exists and partly lies in the S2-S4 holdout period; that is candle data, the test is forward (entry on or after 2026-12-07), and no order-book value is involved.

### 2.2 Rule (nothing is fitted)
- Decision every **Monday 00:00 UTC**; first decision **2026-12-07**; last decision **2027-05-31**; exit **seven days later** (last exit 2027-06-07T00:00Z). 26 weekly cohorts.
- **Signal (no look-ahead):** `close(D-1) / close(D-29) - 1`, where `close(X)` is the close of the **daily candle dated UTC day X** (an Upbit daily candle dated X covers X 00:00Z to X+1 00:00Z, so `close(D-1)` is the last trade price before 00:00Z of decision day D). **No candle dated D or later is read for the signal.** Cross-sectional rank over the universe.
- Picks: the **five** highest-ranked markets (long-only; ties by ascending market code).
- **Entry:** the open of the first 60-minute candle that starts at or after the decision time and within 6 hours of it. If there is none the pick is **not entered**, is counted as a gap, and is not replaced (the cohort mean is over the entered picks; fewer than 3 entered picks make the cohort not counted).
- **Exit:** the open of the 60-minute candle that starts at the exit time. If it is missing, the close of the last candle before the exit time is used and counted as a gap. A market that is delisted or has no later candle is closed at its last available close and counted (never dropped, never valued at -100 percent).
- Cost per side: taker fee 5 bp + slippage 5 bp + the market's tick-based spread-floor half cost from the committed metadata (as in the broad discovery); this is **optimistic** (an open price is not an ask-hit price and thin markets widen at the open). Stress: fee 10 bp + slippage 10 bp.
- Benchmark: equal-weight basket of every universe market with an entry and an exit value, same costs and times. It contains the five picks (a small overlap) and is a weak beta control for a small high-beta universe: the down-week clause and the stress costs are the mitigation.
- Cohort value = mean net return of the entered picks minus the benchmark's.
- **Gap cap:** gaps above 5 percent of picks, or of benchmark entries, make the result `INSUFFICIENT_DATA`.
- Warning or delisting notices after the snapshot day cannot be observed later and are not used; the gap cap and the delisting rule cover them.

### 2.3 Test and pass rule (one primary test, alpha 0.05, one-sided)
PASS needs all of: at least 24 of 26 counted cohorts; mean cohort excess > 0 with Student t p < 0.05 **and** a sign-flip permutation p < 0.05 (100,000 flips, mulberry32 with reference outputs for seed 1 of 2693262067, 11749833, 2265367787, seed 20261207, the S2-S4 procedure; a sample sd of 0 is a FAIL); mean excess under stress costs > 0; **mean excess still > 0 after removing the single largest cohort** (printed, not tuned); mean excess on down weeks (benchmark net return < 0) > 0 with p < 0.10 and at least 8 down weeks (fewer is `INSUFFICIENT_DATA`, never a pass; a strong bull market can make that happen). Printed for information and never deciding: lag-1..4 autocorrelation of the cohort values, their skewness, the largest cohort's share of the total, and the split of the excess by benchmark return above and below zero. Fewer than 24 counted cohorts is `INSUFFICIENT_DATA`. A FAIL is recorded and the rule is not re-run on the same span or retuned.
- Note on the test: weekly excess of a top-5 pick set is right-skewed and the 28-day lookbacks overlap by 21 days, so the same coins can repeat; the sign-flip test assumes symmetric, exchangeable values, which is why the leave-one-out clause and the autocorrelation print exist. Return windows themselves do not overlap.

### 2.4 Power, disclosed now
With 26 cohorts and p < 0.05 the one-sided critical value is t = 1.708 at 25 degrees of freedom, so the mean weekly excess must exceed about 0.335 sd just to be significant, which is only about **50 percent power**; about 0.5 sd is needed for 80 percent. For an assumed weekly excess sd of 4 to 8 percent (a guess; no return was read) that is roughly **1.3 to 2.7 percent per week net to pass, and about 2 to 4 percent for 80 percent power**. The down-week clause and the leave-one-out clause lower the joint power further, and `INSUFFICIENT_DATA` is a possible outcome in a strong bull market. **A non-PASS is weak evidence against the idea**; it only means a large edge was not shown. This direction is a sieve for a big effect, not a proof of absence.

### 2.5 The three numbers the owner confirmed ("해", 2026-11-25)
1. Lookback 28 days, five picks, hold seven days.
2. Span: first decision 2026-12-07, 26 weekly cohorts, one calendar decision date 2027-06-07, no early look, no optional stopping. **Reviewer fix, to be confirmed by the owner:** the earliest run time is **2027-06-07T03:00:00Z** (not 01:00Z): the last exit price is the open of the candle that starts 2027-06-07T00:00Z and is only complete after 01:00Z, so two hours of margin cover candle availability.
3. One primary test at alpha 0.05 per test, with **no family-wise control across the programme**: with about nine independent tests at 5 percent each the chance of at least one false PASS is about 37 percent (1 - 0.95^9), so a PASS is a lead for a forward SHADOW replication only. The earlier pre-registered studies (`docs/LEARNING_NEXT_CANDIDATES_2026-11-25.md` section 1) keep their own alphas and are not pooled.

### 2.6 What must happen (none of it is done here)
1. Independent non-author review: done (this file carries its fixes). Merge **before 2026-12-07T00:00Z**; on that day the registering commit takes the metadata snapshot and writes the frozen list (a separate small PR, hash-pinned).
2. A **fetch workflow** on a GitHub-hosted runner as its own work order, PR and review, following the broad discovery's fetch-with-manifests pattern (rate limits, retries, one manifest per fetch run, each reproduced once), and an **evaluate workflow** (dispatch-only, hash-pinned, no host, no release, no restart). They must refuse to run before 2027-06-07T03:00Z and must read only candles dated up to the cohort's exit.
3. **The blind is a rule, not a technical lock:** daily candles are public, so nobody reads or computes a cohort result before 2027-06-07, and this is recorded, as in the RET48 and broad documents. Counts of fetched candles are allowed; returns are not.
4. The result record follows the broad-discovery record format (counts, freeze fingerprint, verdict).

## 3. Direction 2: "different data": the check says there is none
A long daily-candle study was proposed as the different data. Section 0 shows the daily candles of every KRW market from 2021-10 to 2026-10 were already read, so no historical daily test is blind. The only usable fresh data is the daily and 60-minute candles that will exist from 2026-12-07; that is Direction 1 (it reads exactly those). **Direction 2 therefore merges into Direction 1 and adds no second study.** No external or off-venue data is proposed: `ML_EXTERNAL` was read, and a new source would need its own provenance work.

## 4. Why only one new study
The earlier recommendation (wait for 11/29, 12/05, 12/10) still holds for the order-book and intraday families: they are not touched. Direction 1 uses different data (daily and 60 minute candles of other markets), a different horizon and a different time span from every registered study, so it adds one test to the programme without sharing a holdout. The multiple-comparison accounting is stated in section 2.5 item 3 (per-test alpha, no family-wise control) and in the work order.

## 5. Not done here
Any code, workflow, host action, rule, threshold, gate, limit, capital or authority change; reading any value of the blind data in section 0; running any historical analysis; a re-run of a failed study.
