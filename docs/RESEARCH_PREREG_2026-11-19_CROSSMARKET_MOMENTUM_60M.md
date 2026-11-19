# Pre-registration (DRAFT for independent review): cross-market relative momentum on five KRW markets, 1h holding, one primary cell (PAPER research)

Status: **DRAFT (revised after one independent review), written 2026-11-19 (KST), before any candle VALUE of the four new markets or of the span below was examined.** It becomes a pre-registration only when this
file is merged on main after an independent non-author review; from then on nothing here may change, and any change starts a new pre-registration with a new date.
Work order: `WO-LEARNING-20261119-CROSSMARKET-PREREG`. Study id: `RULE_CROSSMARKET_MOM_60M_20261119`.
Design it belongs to: `docs/RESEARCH_MARKET_EXPANSION_DESIGN_2026-11-19.md` (step B). Learning loop level: L1 candidate supply (`docs/LEARNING_LOOP_LEVELS_20261112.md`).

Scope: PAPER research only. No order, no account, no runtime wiring, no limit change. A PASS makes the rule eligible for a forward SHADOW test; it is **not** promotion evidence.

## 1. Why, and the prior (stated before any result)
- The close-based single-market rule families (SMA, RSI, Donchian) on KRW-XRP are exhausted by the policy (811 experiment records, 0 candidates on 2026-11-19). A family that **ranks markets against each other** is a different hypothesis, and it was untestable because candles existed for one market only. Since the release of the research-market widening (target 2026-11-19), candles are collected for KRW-XRP, KRW-BTC, KRW-ETH, KRW-SOL, KRW-DOGE.
- Honest prior: **low.** Cross-sectional momentum at hour scale on five liquid markets must beat 0.05 percent per side fees plus spread; trade flow failed once at this horizon (2026-10-13) and order-book/ML families have not passed. Five markets are few, so the ranking is noisy. The study is registered because a clean negative is also a result, and because it is an untried family that needs candles for several markets (order books for these markets are already collected).
- No candle value of KRW-BTC, ETH, SOL or DOGE was ever read before this draft. KRW-XRP values were examined by earlier research, but its values of the span below lie in the future, so nothing about the span is known.

## 2. Universe and eligibility
- Markets: KRW-XRP, KRW-BTC, KRW-ETH, KRW-SOL, KRW-DOGE (fixed; not extended during this study).
- Bars: 60-minute bars built from stored 1-minute candles, decision times at every full UTC hour. A bar counts only if all of its 60 one-minute closes are present or proven exchange-absent (the existing absence proof); an incomplete bar is missing.
- A market is eligible for the study if, in the training part, at least 90 percent of decision hours have a complete bar **and** a usable order book at the decision hour (same book rule as the trade-flow study), and its median training spread is at most 20 bp. At least 3 markets must be eligible, otherwise the study ends `INSUFFICIENT_DATA` (no re-run).
- A decision hour in which fewer than 3 eligible markets have a complete bar and a book is skipped.

## 3. Rule (the hypothesis; one primary cell, no selection)
- Timing (no look-ahead): decision times are full UTC hours t. `close_i(t)` is the close of the one-minute candle whose **close time** is t in the candle store (the candle covering the minute that ends at t), whatever start-time convention the exchange API uses. The order book used at t is the **last sample in (t - 2 min, t]**; nothing recorded after t is used for the decision, and the exit uses the last sample in (t + H - 2 min, t + H].
- At decision hour t, for each eligible market i compute `r_i(L) = close_i(t) / close_i(t - L) - 1`. A market with a missing `close_i(t - L)` or `close_i(t)` is not eligible at that hour.
- Rank by `r_i(L)`; ties are broken by market-code order (alphabetical), as in the trade-flow study. **Go long the single top-ranked market** (spot only, long only, one position, no short, no leverage).
- Execution: buy at the best ask at t, sell at the best bid at t + H. A trade with no book at t or at t + H is dropped; a trade whose exit would cross the end of its part is dropped.
- **Primary cell (the only PASS-eligible cell): L = 24 h, H = 1 h**, decisions every hour (non-overlapping because H = 1 h). Reason fixed now, before any value: the 1 h holding gives the most trades in a 10-day holdout (about 240), and the 24 h lookback is less noisy than 6 h. Nothing is selected on validation: with a 2-day validation part the 4 h cell would have about 12 trades, so a selection would be a coin flip and would only dilute power.
- **Descriptive cells (reported, never PASS-eligible):** (L 6 h, H 1 h), (L 6 h, H 4 h), (L 24 h, H 4 h). They are computed on the holdout with the same rules and listed with the primary cell so that the family is visible; their results can not make the study pass.
- Benchmarks at the same decision times, same execution and costs: (a) equal weight of the eligible markets; (b) KRW-BTC alone (a beta reference).
- Costs: fee 0.05 percent per side. Stress: 2 x fee plus 5 bp per side.
- Reported, not tested: the share of trades per market (concentration), the market-by-market mean net, the gross mean before costs.

## 4. Span (fixed now, in the future)
| Part | From (UTC) | To (UTC) |
|---|---|---|
| Train | 2026-11-21T00:00Z | 2026-11-28T00:00Z |
| Validation | 2026-11-28T00:00Z | 2026-11-30T00:00Z |
| Holdout | 2026-11-30T00:00Z | 2026-12-10T00:00Z |
- Training (7 days, 168 decision hours) is used only for the eligibility bars and the spread rule; the validation part is only reported (no selection). The 24 h lookback of the first training decision needs candles from 2026-11-20T00:00Z, so the coverage of 2026-11-20 is counted too.
- Decision rows whose exit would cross into the next part are dropped.
- Blindness is a **convention, and this document says so**: nobody may read candle or book values from 2026-11-20T00:00Z on before the run, and the run may not start before 2026-12-10T00:30Z. Counting hours that hold data is allowed (no value is shown). Disclosed facts: order books and trade ticks of these markets are collected anyway and the daily diagnosis shows counts only; KRW-XRP candle values of the span flow into the daily XRP experiments and their records, so they are not blind after the fact; the four new markets are not read by any experiment (`experimentMarkets` stays KRW-XRP).
- If the service is down, the gap is not repaired or filled; it counts against the 90 percent bars.

## 5. Power, multiple comparisons and the PASS rule
- **Power (the reviewer's assumptions, not measured):** a top-1 trade sd of about 0.8 percent per hour and a total cost near 0.15 percent per round trip including spread. For the primary cell with about 240 trades the standard error of the mean is about 0.05 percent, so the critical mean net is about 0.12 percent per trade, and 80 percent power needs a true net edge of about 0.16 percent per trade (about 0.3 percent gross per hour). A realistic edge of 0 to 0.05 percent net has **under 5 percent chance to PASS**. This study can detect a **large** edge only. A FAIL is a clean negative about large edges and says **nothing** about small ones; it is not a test of whether a small edge exists. The study is registered knowing this.
- **Stage 1, signal existence (gross, before costs):** on the holdout, the mean over decision hours of the cross-sectional rank correlation (Spearman) between `r_i(24 h)` and the next-hour return of the eligible markets, with a moving-block bootstrap (blocks of 6 hours, 10,000 resamples, fixed seed 20261119) one-sided p < 0.0125. This is far more powerful than a top-1 trade test and is **required for PASS**: no gross signal, no pass.
- **Stage 2, tradable edge (the primary cell, after costs):** all of the following on the holdout: at least 50 trades (the 1 h cell has about 240); mean net per trade > 0 under the fee costs and under the stress costs; one-sided Student t test on the trade net returns p < 0.0125 **and** the moving-block bootstrap of the same mean (blocks of 6 trades, 10,000 resamples, seed 20261119) p < 0.0125; the **paired** difference to the equal-weight benchmark is > 0 with a paired permutation (sign-flip, 10,000 draws, seed 20261119) p < 0.0125; the mean net exceeds the KRW-BTC reference mean (reported; a pick that is only high beta in an uptrend does not pass). Absolute and paired tests are an intersection, hence conservative.
- Hypothesis count: K = 4 is counted for the family (the primary and the three descriptive cells) and the threshold 0.05 / 4 = 0.0125 is used for every test above although only one cell is PASS-eligible. This is a separate family and dataset, registered like the trade-flow and order-book studies, not part of the runtime experiment ledger or its cumulative holdout bar.
- `INSUFFICIENT_DATA` if fewer than 3 markets are eligible or the primary cell has fewer than 50 trades. The rules are not changed and the span is not re-run.
- A PASS is recorded as eligible for a SHADOW forward test only (a later, separately pre-registered span); it is never promotion evidence and changes no gate, limit or authority.

## 6. Preconditions for running it
- The five-market candle collection must be running (release of the research-market widening, target 2026-11-19) and its coverage of the training part is reported as counts only.
- A study script (`scripts/run-crossmarket-study.js`) and its test are written **after** this document is merged, reviewed independently, and released before 2026-11-30 if possible (a release costs about one to two hours of collection; one release inside the span is tolerable, none during the holdout unless the coverage bars still hold). Nothing in the script may depend on the holdout values.
- Dataset identity is recorded in the result as sha256 over the ordered candle and book rows used, their row counts and the time range, as in the order-book study. The study script pins its own commit; the run must use exactly that commit (the script PR states the hash; this document does not run anything).
- The five-market collection must reach at least 90 percent complete hours for each market from 2026-11-20T00:00Z; if the widening release is late or rolled back so that this cannot hold, the study is re-registered with a later span.
- The first release of the widening must have passed its before/after read (stall, gap-fill, disk, experiment tick delay) without a rollback; if it was rolled back, this study is re-registered with a later span.

## 7. Recording
- A result line `CROSSMARKET_STUDY {...}` (fixed status code, numbers and booleans, dataset identity) is read by the host diagnosis and recorded in the work order and in `docs/research-ledger/experiments.json`.

## 8. What this document does not do
It does not change any experiment, gate, threshold, limit, capital, order switch or authority, does not start any run, writes no study code, and does not widen the experiment markets (`experimentMarkets` stays KRW-XRP).
