# Design (not a pre-registration): using the already collected history to generate candidate strategies (PAPER research)

Status: **design for review, written 2026-11-20 (KST). Nothing here is built, run or binding.** Asked by the owner on 2026-11-20 ("지난 모든 거래 기록을 보고 전략을 만들 수는 없나"). Related: `docs/RESEARCH_SIGNAL_SCREEN_DESIGN_2026-11-20.md`, `docs/RESEARCH_PREREG_2026-11-19_CROSSMARKET_MOMENTUM_60M.md`, `docs/RESEARCH_PREREG_2026-11-20_SIGNAL_SCREEN_60M.md`.

## 1. What "all past records" means here
- **Our own trade records: almost none.** The service has run COLLECT_ONLY with orders OFF; the PAPER ledger holds 0 orders and 0 fills, and the permit inventory found 0 calibration and 0 outcome samples (`docs/NUSA_PERMIT_PRODUCER_DESIGN_2026-11-16.md` section 7). There is nothing of our own to learn from.
- **Market history we collected** (extents are **not measured in this document** and must be fixed from counts before anything is read):
  - 1-minute candles: KRW-XRP for about two months (earlier experiments read them). For BTC, ETH, SOL and DOGE the history comes from the **public backfill of 2026-11-19 and later live collection**; the backfill targets up to about 56 days per market (`docs/RESEARCH_MARKET_EXPANSION_DESIGN_2026-11-19.md`, about 80,000 rows; store cap 100,000 rows per market), but its completion was **not measured** (the gap-fill health of 2026-11-20 still showed hundreds of missing minutes per market). The extent is therefore somewhere between about 12 days (what the manifests of 2026-11-20 showed, a window-limited count) and about 56 days.
  - Order-book tops: about 300 markets, **rolling 14-day retention** (configurable up to 90 days) and a per-market sample cap; **books before the cut will be pruned** (data of 2026-11-20 around 2026-12-04) unless retention is raised or a snapshot is taken. The 68 percent coverage figure is the watched market's last 192 hours.
  - Trade ticks: a **count cap per market** (2,000,000), not a time window; the time span is unverified.
- **Already tried on this history:** 811+ rule experiments (0 candidates, XRP) and a trade-flow machine-learning study (failed); the earlier order-book and trade-flow studies read book and tick data of several markets. Mining it again with the same kind of search has a low prior.

## 2. The main risk: a search over history always finds a winner
If many rules are tried on one history, the best one looks good by chance, and more rules make the best look better. A strategy fitted on a few weeks of data is **a hypothesis, never evidence**. The repository's answer is the pre-registered forward test; this design keeps that and uses the history only to **generate and rank candidates**.

## 3. Blindness: which history may be used
- Reserved by pre-registrations: from 2026-11-20T00:00Z candle values of all five markets (cross-market study: nobody reads them before its run), and the signal screen's span from 2026-12-11. **This design reads none of them.** The mining window must **end at 2026-11-20T00:00Z at the latest.**
- Usable for exploration: five-market candles before that cut. BTC, ETH, SOL and DOGE candle values were never read before (this design will read them; it is allowed because they lie outside every reserved span). **XRP is not blind** (earlier experiments), so XRP is **discovery-only** and is never part of a hold-back claim. Book and tick data before the cut are not blind for markets that earlier studies read.
- **No result for a pre-registered rule or signal** (the cross-market top-1 24 h momentum, RET6, RET24, RET72, VOL24, SURGE, RANGE) may be computed or reported from the mining window: a duplicate check is done **by formula, not by outcome**, so that the mining cannot preview the pre-registered hypotheses.

## 4. Protocol (proposal)
1. **Fix the windows from counts**, before any value is read: a discovery window (the older part) and one hold-back window (the newer part, ending at or before the cut). A purge of at least 72 hours (the longest lookback) is left between them and no rule may use data across the boundary; the hold-back is therefore not adjacent to the discovery data. The 72-hour purge and the window sizes are written into the freezing record.
2. **Exploration in the discovery window only**, any rule family, any number of trials, with a **trial log**; the number of trials is a **disclosure only** and does not enter the hold-back test.
3. **Shortlist** at most 5 candidates by a rule written before exploration: highest discovery-window mean net return after the fixed costs of the cross-market study (fee 0.05 percent per side; stress 2 x fee + 5 bp), **with at least 100 discovery trades** and **no two candidates whose trade sets overlap by more than 50 percent** (the lower-ranked one is dropped).
4. **Freeze, then one look.** The shortlist, the PASS threshold and the test are **committed before the look** (and the file records the time and the commit). The test is the one of the cross-market pre-registration section 5 (circular block bootstrap with block 24, B = 10,000, centred null, one-sided) with a Bonferroni correction **over the shortlist size only** (at most 5; selection from the trial log is already paid for by discarding the discovery results). The result is **descriptive**: a filter that lets a candidate into step 5, not a hypothesis test whose p-value is evidence. After a failed look the hold-back window is spent and **the discovery window is not reopened for the same candidates**.
5. **Forward confirmation:** each surviving candidate gets its own pre-registration with a future span; **each writes its own rule** with the same cost model as the cross-market study and the same SHADOW-only meaning of a pass. Nothing is promoted by steps 1 to 4.

## 5. What it can and cannot say (assumptions, not measured data)
- With a 4-day hold-back (about 96 decision hours; this assumes **one always-open position**, one trade per hour) and a trade standard deviation near 0.8 percent, the standard error is about 0.08 percent; with the correction over a shortlist of 5 (alpha about 0.01, z about 2.3) the critical mean net is about 0.19 percent and 80 percent power needs about 0.26 percent per trade. **Smaller edges are invisible.** A hold-back of 20 days (if the history reaches 56 days) would have a standard error of about 0.036 percent and see edges near 0.12 percent: **the extent of the history decides the power and must be measured first.**
- The two windows are within one regime; a rule fitted to that regime can pass the hold-back by regime luck. This is a limit that cannot be removed with the data we have.
- **Calendar:** candidates appear early, but the forward confirmation cannot start before the reserved spans end (the cross-market holdout to 2026-12-10, the signal screen to 2027-01-17); a second screen on a later span starts after that. Mining gains **no confirmation time**, only an earlier candidate list.
- It cannot create evidence of profit. A candidate is as unproven as any other until its forward span is done.

## 6. Overlap and limits
- The signal screen's six signals are frozen; candidates from this design enter a **second** screen on a later span (after 2027-01-17), a separate family.
- A candidate that duplicates a signal of the screen or the cross-market rule is dropped (by formula, section 3).
- No order-book or tick candidate is shortlisted unless its usable-hour share in the windows reaches 90 percent for the markets it uses; and the book and tick rows must exist at freeze time (retention above).

## 7. Decision for the owner (one question)
Which of these do you want?
1. **Wait**: do nothing now; first measure how far back the five-market candles really reach (counts only, no values). Nothing is spent. This is the recommended first step because the power depends on it.
2. **Mine the pre-2026-11-20 window** after the extent is known, as in section 4.
3. **Extend the backfill deeper** (the exchange's public history, months instead of weeks) so the window is not scarce and the hold-back is longer; this needs a reviewed change and a release.
Nothing is built or paid by any option until you choose.

**Owner answer 2026-11-20 (KST): "쓸게" (I will use it).** Read as option 2 (mine the pre-2026-11-20 window), with section 4 step 1 first: the extent of the history must be measured from counts before any window is fixed. A read-only extent probe (per market: row count, first and last close time, number of proven-absent minutes; no value) is the next step (work order `WO-LEARNING-20261120-CANDLE-EXTENT-PROBE`). No window is fixed and no value is read until the counts are known. Not chosen: option 3 (deeper backfill).

## 8. What this document does not do
No code, run, experiment, gate, threshold, limit, capital, order switch or authority change. `experimentMarkets` stays KRW-XRP. No value of any reserved span is read.
