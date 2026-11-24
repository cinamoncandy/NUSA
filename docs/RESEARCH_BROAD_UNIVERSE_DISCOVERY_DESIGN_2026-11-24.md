# Broad-universe discovery and fast forward confirmation (design, 2026-11-24)

Status: design proposal for the owner's order of 2026-11-24 ("제안 순서 다 해"). Docs only. Nothing is fetched, read or run by this document; every step below is its own reviewed PR. No gate, threshold, limit, capital or authority changes; a result only ever makes a rule a candidate for a SHADOW test.

## 1. Why, and what this cannot do
- A strategy cannot be "verified" by analysing all past charts: the data used to choose a rule cannot confirm it. Past data finds **candidates**; confirmation needs data that played no part in the choice.
- The 2023-2024 look on BTC, ETH, SOL and NEAR was spent (LOOK_FAIL). Waiting for those four markets alone takes about 15 months (`docs/RESEARCH_PREREG_2026-11-24_FORWARD_CONFIRMATION_RET48_H24.md`).
- **Breadth is the speed-up.** The primary rule fired about 5 times per market and month. Over about 150 Upbit KRW markets that is hundreds of trades a month, so a pre-registered forward test can reach its trade count in weeks, with data fetched from Upbit's public candle API on the decision date (no host collection needed).
- Honest limits: after the 0.10 percent fee and a realistic spread few long-only spot rules survive; small markets cannot be traded at the assumed cost; delisted markets are missing from today's market list (survivorship favours old winners); all markets move together, so the effective number of independent observations is far below the trade count. "No candidate" is a likely and acceptable outcome.

## 2. What counts as unseen (stated before any fetch)
| data | status |
|---|---|
| 60m closes of BTC, ETH, SOL, NEAR, XRP, 2021-12-20 .. 2024-10-31 | seen: used for the H2 discovery and the spent look |
| daily 2021-2026 and 60m 2025-01-16 .. 2026-10-12 of BTC, ETH, XRP, SOL, DOGE | seen by earlier studies |
| 60m closes of all **other** KRW markets, any period | values never read by anyone |
| anything after the pre-registration commit of the forward test | does not exist yet |
The ideas (momentum rules over 12 to 48 hours with a 24 hour hold) are **not** blind after the H2 look, because its outcome shaped which rules are worth another test. Therefore the historical part below is **discovery only** and the verdict comes from the forward test (section 7). The 2023-07 .. 2024-10 span of the other markets may be used as a **secondary, descriptive hold-back** (values unseen, regime known): it can veto a candidate, never confirm one.

## 3. Universe (frozen by a list, not by looking at returns)
- Source: Upbit `GET /v1/market/all` KRW markets at the time of the run, with the exact list and its SHA-256 committed first. Stable coins and markets listed less than 180 days before the window start are excluded.
- Listed-age rule: a market enters the discovery pool only for windows after its first 60m candle plus 30 days.
- **Liquidity and cost proxy without order-book history:** the Upbit tick size is public per price tier. A market is *tradable* only if tick / price is at most 10 bp at the window's median close (so the minimum spread is at most 10 bp), and its median daily traded value over the window is at least 1 billion KRW (candle volume times close; volume is already in the fetched files). Both numbers are fixed here, before any look.
- Cost model for every market: round trip fee 0.10 percent (as frozen) **plus** one tick-over-price round trip as a spread floor; stress = fee 0.30 percent plus twice that spread floor. Markets with a wider true spread will do worse than the model says; the forward test with live book samples can add a spread-adjusted descriptive view.
- Survivorship is **declared, not fixed**: delisted markets cannot be listed from today's endpoint. Every historical result carries "survivor-biased upward"; the forward test has no such bias (section 7).

## 4. Discovery (historical, descriptive)
- Grid: the **unchanged** 128-rule grid of `scripts/run-history-mining.js` (no new rules, no new holds), entry at the next hourly close, 24 hour and shorter holds as in the grid.
- Window: 2021-12-20 .. 2023-06-30 (discovery), pooled over the tradable markets; XRP, BTC, ETH, SOL, NEAR stay in the pool (their discovery values were already seen, which is declared).
- Selection and multiple testing: the same shortlist logic (at most 5 rules, trade overlap limit, at least 100 trades), with the Bonferroni alpha of the later test divided by the shortlist size, plus a **cross-market sign table** (a rule must be positive in at least 60 percent of tradable markets, and in both halves of the window) as a descriptive veto.
- Output: shortlist, signal thresholds from discovery quantiles (pooled across markets), counts and per-market usable hours; no price printed; a freeze record committed before anything else.
- Secondary hold-back (descriptive veto only): 2023-07-05 .. 2024-10-31 over the markets that are **not** BTC, ETH, SOL, NEAR or XRP; run once, after the freeze record, with the spent-once guard of the look workflow. A rule with a negative excess there is dropped from the forward pre-registration.

## 5. Tooling (separate reviewed PRs, none reads a value)
1. A fetch script that takes the committed market list (instead of the five fixed markets), applies the hole policy of the existing fetch script, writes frozen files outside the repository and a hash manifest, with synthetic tests only; its dispatch-only host workflow splits the run by market groups (the host runner has a 45-minute limit and a 150 ms request spacing: about 200 markets need several runs) and deletes everything on exit.
2. A generalisation of the mining script's market sets (a market-list input bound into `GRID_FINGERPRINT`, per-market tradability and cost), keeping every constant and the pass rules of the H2 look untouched; synthetic tests.
3. The discover workflow (like `history-discover-freeze.yml`) for the broad pool, then the committed freeze record, then the descriptive secondary hold-back run.

## 6. Order and approvals
(1) this design and its independent review; (2) the market-list commit; (3) tooling PRs with reviews; (4) fetch runs with manifests, reproduced once; (5) discover and freeze record; (6) the secondary hold-back run; (7) the forward pre-registration (section 7) committed **before** its span starts. Steps (4) to (6) run on the PAPER host read-only (no restart, no release); none touches the service, so they may run during the 2026-11-24 .. 2026-11-28 freeze, but they are scheduled so that the host is never under load during the cross-market training week (idle priority, off-peak hours).

## 7. Forward confirmation (to be pre-registered after step 6)
- Rules: the survivors of section 4, thresholds frozen from discovery; Bonferroni over the shortlist; gatekeeping order frozen.
- Markets: the tradable list as of the pre-registration date; **delisted or halted markets stay in the test**: positions are closed at the last available close and counted (no dropping, so no survivorship in the forward span).
- Data: Upbit public 60m candles fetched on the decision date and hash-checked as in the existing fetch workflow (closed bars are immutable); no value read before the decision date.
- Decision: one decision date at least 8 weeks after the span start and at least 1,000 resolved trades pooled; INCONCLUSIVE below that; one-sided excess test over the always-in baseline with the time-block bootstrap (blocks of whole hours across all markets, which respects that markets move together); effective-sample caveat stated in the result.
- A pass only makes the rules candidates for the existing SHADOW gate; no PAPER order, Stage B or limit is touched.

## 8. Expected outcomes, stated honestly
- Most likely: no rule survives the cost model and the cross-market veto, so the answer is "no candidate", reached in weeks instead of 15 months.
- Possible: one or two rules survive discovery, the descriptive hold-back does not veto them, and the forward test (also fast) says PASS, FAIL or INCONCLUSIVE.
- Not possible by this route: a "verified strategy" from past data alone.
