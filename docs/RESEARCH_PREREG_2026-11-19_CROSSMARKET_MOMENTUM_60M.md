# Pre-registration (DRAFT for independent review): cross-market relative momentum on five KRW markets, 1h and 4h holding (PAPER research)

Status: **DRAFT, written 2026-11-19 (KST), before any candle VALUE of the four new markets or of the span below was examined.** It becomes a pre-registration only when this
file is merged on main after an independent non-author review; from then on nothing here may change, and any change starts a new pre-registration with a new date.
Work order: `WO-LEARNING-20261119-CROSSMARKET-PREREG`. Study id: `RULE_CROSSMARKET_MOM_60M_20261119`.
Design it belongs to: `docs/RESEARCH_MARKET_EXPANSION_DESIGN_2026-11-19.md` (step B). Learning loop level: L1 candidate supply (`docs/LEARNING_LOOP_LEVELS_20261112.md`).

Scope: PAPER research only. No order, no account, no runtime wiring, no limit change. A PASS makes the rule eligible for a forward SHADOW test; it is **not** promotion evidence.

## 1. Why, and the prior (stated before any result)
- The close-based single-market rule families (SMA, RSI, Donchian) on KRW-XRP are exhausted by the policy (211 failed experiment records, 0 candidates on 2026-11-19). A family that **ranks markets against each other** is a different hypothesis, and it was untestable because candles existed for one market only. Since the release of the research-market widening (target 2026-11-19), candles are collected for KRW-XRP, KRW-BTC, KRW-ETH, KRW-SOL, KRW-DOGE.
- Honest prior: **low.** Cross-sectional momentum at hour scale on five liquid markets must beat 0.05 percent per side fees plus spread; trade flow failed once at this horizon (2026-10-13) and order-book/ML families have not passed. Five markets are few, so the ranking is noisy. The study is registered because a clean negative is also a result, and because it is the only untried family that needs no new data source.
- No candle value of KRW-BTC, ETH, SOL or DOGE was ever read before this draft. KRW-XRP values were examined by earlier research, but its values of the span below lie in the future, so nothing about the span is known.

## 2. Universe and eligibility
- Markets: KRW-XRP, KRW-BTC, KRW-ETH, KRW-SOL, KRW-DOGE (fixed; not extended during this study).
- Bars: 60-minute bars built from stored 1-minute candles, decision times at every full UTC hour. A bar counts only if all of its 60 one-minute closes are present or proven exchange-absent (the existing absence proof); an incomplete bar is missing.
- A market is eligible for the study if, in the training part, at least 90 percent of decision hours have a complete bar **and** a usable order book at the decision hour (same book rule as the trade-flow study), and its median training spread is at most 20 bp. At least 3 markets must be eligible, otherwise the study ends `INSUFFICIENT_DATA` (no re-run).
- A decision hour in which fewer than 3 eligible markets have a complete bar and a book is skipped.

## 3. Rule (the hypothesis; no other rule is tested)
- At decision hour t, for each eligible market i compute the trailing return `r_i(L) = close_i(t) / close_i(t - L) - 1`, L in {6 h, 24 h}.
- Rank the eligible markets by `r_i(L)`; **go long the single top-ranked market** (spot only, long only, one position, no short, no leverage).
- Execution: buy at the best ask at t, sell at the best bid at t + H, H in {1 h, 4 h}. A trade with no book at t or at t + H is dropped.
- Decisions are on a **non-overlapping grid**: for H = 1 h every hour, for H = 4 h every 4th hour from the start of the part (so trades are not overlapping and are treated as independent).
- Grid = 2 lookbacks x 2 holdings = **4 cells**.
- Benchmark: at the same decision times, buy all eligible markets with equal weight and sell at t + H, with the same execution and costs.
- Costs: fee 0.05 percent per side. Stress: 2 x fee plus 5 bp per side.

## 4. Span (fixed now, in the future)
| Part | From (UTC) | To (UTC) |
|---|---|---|
| Train | 2026-11-21T00:00Z | 2026-11-28T00:00Z |
| Validation | 2026-11-28T00:00Z | 2026-11-30T00:00Z |
| Holdout | 2026-11-30T00:00Z | 2026-12-10T00:00Z |
- Training is 7 days (168 decision hours; the 90 percent bar is 152). The holdout is 10 days so that the 4 h cell has about 60 non-overlapping trades (the 1 h cell about 240).
- Decision rows whose exit would cross into the next part are dropped.
- **Nobody may read candle or book values from 2026-11-21T00:00Z on before the run**; the run may not start before 2026-12-10T00:30Z. Counting hours that hold data is allowed (no value is shown).
- If the service is down, the gap is not repaired or filled; it counts against the 90 percent bars.
- Selection: the cell with the highest mean net per trade on the validation part is the only cell evaluated on the holdout. Nothing is tuned on the holdout; the holdout is opened once.

## 5. Multiple comparisons and the PASS rule
- Hypothesis count **K = 4** (the four cells; this is a separate family with a separate dataset, registered like the trade-flow and order-book studies, not part of the runtime experiment ledger or its cumulative holdout bar). PASS needs p < 0.05 / 4 = 0.0125.
- PASS only if all hold on the holdout for the selected cell: at least 50 trades; mean net per trade > 0; one-sided test (z-test on the trade means, non-overlapping trades) p < 0.0125; mean net under stress costs > 0; the **paired** difference to the equal-weight benchmark at the same times is > 0 with one-sided p < 0.0125.
- `INSUFFICIENT_DATA` if fewer than 3 markets are eligible or the holdout has fewer than 50 trades for the selected cell. The rules are not changed and the span is not re-run.
- A PASS is recorded as eligible for a SHADOW forward test only (a later, separately pre-registered span); it is never promotion evidence and changes no gate, limit or authority.

## 6. Preconditions for running it
- The five-market candle collection must be running (release of the research-market widening, target 2026-11-19) and its coverage of the training part is reported as counts only.
- A study script (`scripts/run-crossmarket-study.js`) and its test are written **after** this document is merged, reviewed independently, and released before 2026-11-30 if possible (a release costs about one hour of collection; one release inside the span is tolerable, none during the holdout unless the coverage bars still hold). Nothing in the script may depend on the holdout values.
- The first release of the widening must have passed its before/after read (stall, gap-fill, disk, experiment tick delay) without a rollback; if it was rolled back, this study is re-registered with a later span.

## 7. Recording
- A result line `CROSSMARKET_STUDY {...}` (fixed status code, numbers and booleans, dataset identity) is read by the host diagnosis and recorded in the work order and in `docs/research-ledger/experiments.json`.

## 8. What this document does not do
It does not change any experiment, gate, threshold, limit, capital, order switch or authority, does not start any run, writes no study code, and does not widen the experiment markets (`experimentMarkets` stays KRW-XRP).
