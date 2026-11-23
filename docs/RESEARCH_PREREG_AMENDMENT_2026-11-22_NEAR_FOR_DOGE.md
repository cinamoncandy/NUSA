# Pre-result amendment (2026-11-22): KRW-NEAR replaces KRW-DOGE in the research markets

Status: amendment record, written 2026-11-22 (KST), **before any result** of the studies it touches. Work order: `WO-RESEARCH-20261122-NEAR-FOR-DOGE`.
Owner decision of 2026-11-22: "replace KRW-DOGE with KRW-NEAR everywhere in the live research path". PAPER only; no order, limit, capital, threshold or authority change.

## 1. What changes
The pre-registrations call the market set "fixed" (cross-market study) or "(fixed)" (signal screen V2). This amendment is the owner's pre-result decision and overrides that wording for the DOGE slot only; no other market, rule or number changes.

KRW-DOGE becomes KRW-NEAR (position kept: last; the cap of five research markets is unchanged) in:
- `deploy/oracle/paper-markets.json` `researchMarkets` (candle collection, backfill, gap-fill). `markets` and `experimentMarkets` stay KRW-XRP.
- the cross-market momentum study (`scripts/run-crossmarket-study.js`, `RULE_CROSSMARKET_MOM_60M_20261119`): market set now KRW-BTC, ETH, NEAR, SOL, XRP (alphabetical, so the tie-break rule "alphabetical" is unchanged).
- the signal screen V2 (`scripts/run-signal-screen.js`, `RULE_SIGNAL_SCREEN_60M_20261120_V2`): same set; the coverage output key `dogeMinutes` becomes `nearMinutes`.
- the history mining (`scripts/run-history-mining.js`): blind markets KRW-BTC, ETH, NEAR, SOL (XRP stays discovery-only).
- the read-only candle extent probe (`scripts/run-candle-extent-probe.js`): keys `DOGE...` become `NEAR...` (`NEARRows` etc.; the diagnosis projection keeps any `^[a-zA-Z]{1,40}$` key with a safe integer, so no workflow change).

Not changed: the offline/historical analyses with their own pre-registered data (`forward-regime-breakout`, `offline-*`, `fetch-futures-history`, `research-real-market-run`), the history-mining windows, every analysis plan, threshold, decision rule, seed, fee/cost value and the reserved cut (2026-11-20T00:00Z).

## 2. Why
DOGE's collected 1-minute history has many holes: per the candle extent of 2026-11-22 about 6,400 missing minutes against BTC 318, ETH 459, SOL 1,329. NEAR is more liquid (owner figures: 45-day mean traded value about 29 billion KRW per day against about 15 billion for DOGE). A market with holes fails the 90 percent coverage bar and would silently leave the studies.

## 3. It is made before any result, and no candle value chose it
- At the time of this amendment `crossmarket_study` had `daysCollected` 1 and `signal_screen_study` had `daysCollected` 0 (both `WAITING_DATA`); the history mining had never run on real data.
- No candle value of KRW-NEAR (or of any span the studies reserve) was read for this choice. The selection used Upbit public daily trade value and listing age only. The candle extent probe prints counts and close times only.

## 4. Fingerprints, market sets and data clocks (read from the scripts)
- **Cross-market study:** the market set is part of the statistic's identity. `datasetFingerprint` hashes each eligible market's code and its closes, absences and books (`scripts/run-crossmarket-study.js`, `runStudy`, the loop starting `hash.update(market)`), so swapping DOGE for NEAR changes the fingerprint the run will print. It is computed only at run time (after 2026-12-10T00:30Z); no run and no result exists, so nothing is invalidated. `eligibleMarkets` and `shareByMarket` name markets and will name NEAR.
- **Signal screen V2:** same: `datasetFingerprint` hashes the market code plus closes, volumes and absences of the eligible markets (`scripts/run-signal-screen.js`, `runScreen`). Computed only at run time (from 2027-01-17T00:30Z); no result exists.
- **History mining:** `GRID_FINGERPRINT` binds the grid (signals, sides, quantiles, holds, costs, seeds, purge, cut) and **not** the market list, so it is unchanged and no test pin moved. The market list is therefore not bound by a freeze record: a freeze written before this amendment would be applied to the new blind markets. None exists (never run on real data), and this amendment records the list instead.
- **Data clocks.** `daysCollected` in both studies is calendar arithmetic from the study start (cross-market 2026-11-21, screen 2026-12-11), not a per-market count, so it does not restart. What counts data per market is `coverageMinutes` (cross-market, closes after 2026-11-20T00:00Z) and `<mkt>Minutes` (screen, closes after 2026-12-10T23:00Z), and the eligibility tests (cross-market: at least 90 percent of the 168 training decision hours from 2026-11-21 with a complete bar and a usable book; screen: at least 152 complete hourly bars from 2026-12-11).
  - The scripts read the candle table and do not distinguish live from backfilled rows. NEAR's backfill (`NUSA_RESEARCH_BACKFILL_DAYS=45` at the restart of the release) writes public history, including minutes after 2026-11-20T00:00Z up to the restart, and the cross-market study would read those rows at run time. Backfilled values are public exchange data that nobody read before the run, so the blindness convention (no value read from 2026-11-20 on before the run) is not touched by writing them. For the history mining, backfilled data before the reserved cut is what it is meant to explore; it reads nothing at or after the cut (the `CUT` bound in `loadHourly`). The cut stays 2026-11-20T00:00Z for every study; no reserved span is opened to the mining.
  - **Open risk, stated plainly (NEAR may be silently ineligible):** cross-market eligibility needs a usable order-book sample and a complete bar in at least 90 percent of the 168 training decision hours from 2026-11-21 (`isStudyEligible`, `scripts/run-crossmarket-study.js`). NEAR's candles exist only from the backfill at the restart of the 2026-11-23 release, and its books exist only if the all-markets book collector already covers NEAR; the design document says books of about 300 markets are collected, but this was **not verified for NEAR**. If more than about 16 of those hours lack a book or a bar, NEAR is dropped by the existing rule and the study runs on four markets (BTC, ETH, SOL, XRP; the minimum is three), which would not give the owner the market the swap was meant to add. The first diagnosis after the release must be read for `coverageMinutes` of NEAR next to the others, and the owner told if NEAR is behind.

## 5. Original texts
The pre-registration texts (`docs/RESEARCH_PREREG_2026-11-19_CROSSMARKET_MOMENTUM_60M.md`, `docs/RESEARCH_PREREG_2026-11-20_SIGNAL_SCREEN_60M.md`, `docs/RESEARCH_PREREG_2026-11-20_SIGNAL_SCREEN_60M_V2.md`, `docs/RESEARCH_HISTORY_MINING_DESIGN_2026-11-20.md`) are **unchanged** except for one appended dated pointer line. Where they say DOGE, read NEAR from 2026-11-22. Analysis plans, thresholds and decision rules are identical.

## 6. Release
Ships with the host release of 2026-11-23, before the 2026-11-24T06:00Z freeze. NEAR is backfilled by the existing `NUSA_RESEARCH_BACKFILL_DAYS=45` at the restart. DOGE rows already stored stay in the store and are simply no longer read by these scripts.
