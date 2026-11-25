# Three research directions after the owner's "다 해" (2026-11-25 KST): what is new, what is not

Status: **PROPOSED. Not registered. Nothing was run and no data value was read to write this file.** Direction 1 becomes a registered pre-registration only when the owner confirms the three numbers in section 2.5 and this file is merged before 2026-12-07T00:00Z (UTC). PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`. No gate, threshold, risk limit, capital, host, release or authority is touched. A PASS would qualify only a forward SHADOW test, never promotion.
Work order: `WO-RESEARCH-20261125-THREE-DIRECTIONS`. Follows `docs/LEARNING_NEXT_CANDIDATES_2026-11-25.md` (which recommended waiting for the three results) and `docs/RESEARCH_BROAD_UNIVERSE_DISCOVER_RESULT_2026-11-25.md` (`NO_CANDIDATE`).

Korean summary (한 줄): 세 방향 중 새 것은 1번(주간 추세, 앞으로 모을 데이터로만 판정)뿐이고, 2번은 "안 본 과거 자료가 없다"는 점검 결과이며, 3번은 이미 있는 비용 표로 충분하다. 소유자 숫자 3개만 확정하면 1번이 등록된다.

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

## 2. Direction 1: weekly trend with a seven-day hold, judged forward only (PROPOSED PRE-REGISTRATION)
Why this one: the cost wall is amortised by a long hold, and no pre-registered study covers a weekly horizon (S2/S4 hold 24 h on order-book pressure, S3 4 h maker, S5 15 m, RET48 BTC/ETH/SOL/NEAR 24 h). The choice is made from the cost argument, not from looking at returns. **Honest limit:** momentum with a long lookback is not a new idea and the daily history of all markets was seen, so the historical part cannot test it; only the forward test can.

### 2.1 Universe (fixed from metadata, before any return exists)
All KRW markets in a metadata snapshot taken on the registration day, with: tick size over median close at most 10 bp (the same filter as the broad discovery, same metadata method), listed at least 30 days before the first decision, **excluding BTC, ETH, SOL, NEAR, XRP and DOGE** (the markets of other pre-registered studies), and median daily traded value at least 1 billion KRW over the 30 days before registration. The list is written into the registration commit and **frozen for the whole span**; a market that is delisted is a data gap valued at -100% for picks and excluded from the benchmark with the gap counted.

### 2.2 Rule (nothing is fitted)
- Decision every **Monday 00:00 UTC**; first decision **2026-12-07**; last decision **2027-05-31**; exit **seven days later** (last exit 2027-06-07). 26 weekly cohorts.
- Signal: cross-sectional rank of the 28-day close-to-close return from daily candles (closes at 00:00 UTC).
- Picks: the **five** highest-ranked universe markets (long-only; ties broken by ascending market code).
- Fill: entry at the open of the 60-minute candle that starts at the decision time, exit at the open of the 60-minute candle that starts at the exit time. A missing candle is a data gap (valued as in 2.1).
- Cost per side: taker fee 5 bp + slippage 5 bp + the market's spread-floor half cost from the committed tick metadata. Stress: fee 10 bp + slippage 10 bp.
- Benchmark: equal-weight basket of every universe market with an entry and an exit value, same costs and times.
- Cohort value = mean net return of the five picks minus the benchmark's.

### 2.3 Test and pass rule (one primary test, alpha 0.05, one-sided)
PASS needs all of: at least 24 of 26 counted cohorts; mean cohort excess > 0 with Student t p < 0.05 **and** a sign-flip permutation p < 0.05 (100,000 flips, mulberry32, seed 20261207, the S2-S4 procedure); mean excess under stress costs > 0; mean excess on down weeks (benchmark net return < 0) > 0 with p < 0.10 and at least 8 down weeks (fewer is `INSUFFICIENT_DATA`, never a pass). Fewer than 24 counted cohorts is `INSUFFICIENT_DATA`. A FAIL is recorded and the rule is not re-run on the same span or retuned.

### 2.4 Power, disclosed now
With 26 cohorts and p < 0.05 the mean weekly excess must exceed about 0.34 sd. For an assumed weekly excess sd of 4 to 8 percent that is roughly **1.4 to 2.7 percent per week net**, a very large edge. **A non-PASS is weak evidence against the idea**; it only means a large edge was not shown. This direction is a sieve for a big effect, not a proof of absence.

### 2.5 The three numbers the owner must confirm (nothing registers without them)
1. Lookback 28 days, five picks, hold seven days.
2. Span: first decision 2026-12-07, 26 weekly cohorts, the one calendar decision date **2027-06-07T01:00Z**, no early look, no optional stopping.
3. One primary test at alpha 0.05 (not 0.05 divided: this is a separate one-test family; the seven earlier pre-registered studies keep their own alphas and are not pooled).

### 2.6 What must happen (none of it is done here)
1. Owner confirms 2.5; independent non-author review; merge **before 2026-12-07T00:00Z**.
2. A fetch and evaluate workflow on a **GitHub-hosted runner** (the pattern of `broad-universe-discover.yml`: dispatch-only, hash-pinned, no host, no release, no restart) as its own work order, PR and review. It must refuse to run before 2027-06-07T01:00Z and must read only candles dated up to the cohort's exit.
3. Nobody reads a cohort result before 2027-06-07. Counts of fetched candles are allowed; returns are not.
4. The result record follows the broad-discovery record format (counts, freeze fingerprint, verdict).

## 3. Direction 2: "different data": the check says there is none
A long daily-candle study was proposed as the different data. Section 0 shows the daily candles of every KRW market from 2021-10 to 2026-10 were already read, so no historical daily test is blind. The only usable fresh data is the daily and 60-minute candles that will exist from 2026-12-07; that is Direction 1 (it reads exactly those). **Direction 2 therefore merges into Direction 1 and adds no second study.** No external or off-venue data is proposed: `ML_EXTERNAL` was read, and a new source would need its own provenance work.

## 4. Why only one new study
The earlier recommendation (wait for 11/29, 12/05, 12/10) still holds for the order-book and intraday families: they are not touched. Direction 1 uses different data (daily and 60 minute candles of other markets), a different horizon and a different time span from every registered study, so it adds one test to the overall count (eight pre-registered tests plus this one) without sharing a holdout. The multiple-comparison budget is stated in section 2.5 item 3 and in the work order.

## 5. Not done here
Any code, workflow, host action, rule, threshold, gate, limit, capital or authority change; reading any value of the blind data in section 0; running any historical analysis; a re-run of a failed study.
