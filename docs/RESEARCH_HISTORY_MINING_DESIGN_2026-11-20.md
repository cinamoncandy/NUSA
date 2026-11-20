# Design (not a pre-registration): using the already collected history to generate candidate strategies (PAPER research)

Status: **design for review, written 2026-11-20 (KST). Nothing here is built, run or binding.** Asked by the owner on 2026-11-20 ("지난 모든 거래 기록을 보고 전략을 만들 수는 없나"). Related: `docs/RESEARCH_SIGNAL_SCREEN_DESIGN_2026-11-20.md`, `docs/RESEARCH_PREREG_2026-11-19_CROSSMARKET_MOMENTUM_60M.md`, `docs/RESEARCH_PREREG_2026-11-20_SIGNAL_SCREEN_60M.md`.

## 1. What "all past records" means here
- **Our own trade records: almost none.** The service has run COLLECT_ONLY with orders OFF; the PAPER ledger holds 0 orders and 0 fills, and the permit inventory found 0 calibration and 0 outcome samples (design 2026-11-16, section 7). There is nothing of our own to learn from.
- **Market history we collected:** 1-minute candles (KRW-XRP for about 2 months; BTC, ETH, SOL, DOGE only since the backfill of 2026-11-19, about 12 days), order-book tops of about 300 markets for about 14 days (coverage 68 percent on the checked market), and trade ticks for about 13 days.
- **Already tried on it:** 811+ rule experiments (0 candidates) and a trade-flow machine-learning study (failed). Mining the same history again with the same kind of search has a low prior.

## 2. The main risk: a search over history always finds a winner
If many rules are tried on one history, the best one looks good by chance; the more rules, the better the best looks. A fitted strategy on 2 to 3 weeks of data is therefore **a hypothesis, never evidence**. The repository's answer is the pre-registered forward test; this design keeps that and uses the history only to **generate and rank candidates**.

## 3. Blindness: which history may be used
- Values reserved by the pre-registrations: from 2026-11-20T00:00Z nobody may read candle values of any of the five markets (cross-market study), and from 2026-12-11 the screening span of the signal screen. **This design must not read them.**
- Free to use for exploration: five-market candles **before 2026-11-20T00:00Z** (BTC, ETH, SOL, DOGE values were never read before; XRP values were read by earlier experiments and are not blind), book and tick data before the same cut for markets that no pre-registered study reserves. Exact usable spans are fixed in a later pre-registration from counts only.
- Because the usable window is about 12 days for four markets, the statistical power of any check inside it is small (section 5).

## 4. Protocol (proposal)
1. **Freeze the data windows from counts**, before any value is read: a discovery window (the older part, about 8 days) and one hold-back window (the newer part up to 2026-11-19, about 4 days).
2. **Exploration in the discovery window only.** Any rule family, any number of trials, with a **trial log**: every candidate tried is counted (the number K of trials is part of the result). No look at the hold-back window.
3. **Shortlist** at most 5 candidates by a rule written before exploration (for example, highest discovery-window mean net return after the fixed costs of the cross-market study: fee 0.05 percent per side, stress 2 x fee + 5 bp).
4. **One look at the hold-back window**, once, for the shortlist only; report the result with a Bonferroni-corrected threshold over the shortlist and over K. Passing this check is **not** a pass of anything; it only lets a candidate into step 5. Failing candidates are dropped and the window is spent.
5. **Forward confirmation:** each surviving candidate gets its own pre-registration with a future span (like the cross-market study and the signal screen), the costs and PASS rule of those studies, and the same SHADOW-only meaning of a pass. Nothing is promoted by steps 1 to 4.

## 5. What it can and cannot say (assumptions, not measured data)
- A 4-day hold-back window has about 96 decision hours and, for a one-hour strategy, about 96 trades; with a trade standard deviation near 0.8 percent the standard error of the mean is about 0.08 percent, so a corrected test can only see a net edge of about 0.3 percent per trade or more. **Smaller edges cannot be seen**, and a clean negative means little. The step is a **filter**, not a verdict.
- The value is speed: candidates for step 5 appear in days instead of weeks. The cost is that most of the 12 days are used up, so the same window cannot be used again.
- It cannot create evidence of profit. A candidate found this way is as unproven as any other until its forward span is done.

## 6. Overlap and limits
- The signal screen's six signals are frozen; candidates from this design would enter a **second** screen on a later span (after 2027-01-17) so that families stay separate.
- A candidate that duplicates a signal of the screen or the cross-market rule is dropped, not retested.
- No order-book or tick candidate is shortlisted unless its usable-hour share in the windows reaches 90 percent for the markets it uses.

## 7. Decision needed from the owner before any pre-registration
Whether to spend the pre-November-20 window on this exploration (it can be used only once). Recommended only if you accept that it produces candidates for later forward tests, not results.

## 8. What this document does not do
No code, run, experiment, gate, threshold, limit, capital, order switch or authority change. `experimentMarkets` stays KRW-XRP. No value of any reserved span is read.
