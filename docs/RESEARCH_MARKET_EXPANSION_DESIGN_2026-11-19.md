# L1 candidate supply: widen the research markets (design, 2026-11-19)

Status: DESIGN FOR REVIEW. Owner answer 2026-11-19: "add 4 markets (recommended)" with the condition that only research widens and orders, limits and authority stay as they are. No code, host or release change here. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, orders OFF.

## 1. Why (from the repository and the host)

- All research runs on one market. `deploy/oracle/paper-markets.json` holds `["KRW-XRP"]` (owner decision 2026-10-03, "XRP first"). One 1-minute candle series exists on the host (`dataIntegrity.candleSeries 1`, 81206 candles). Order-book and trade samples are already collected for about 300 markets, so the data the cross-market ideas need on the quote side is there; candles are not.
- The meta-learning policy marks `CLOSE + INTRADAY/DAILY + RULE + FIVE (at most five markets)` as EXHAUSTED. Adding markets to the same three rule families (SMA, RSI, Donchian) will not produce candidates: the policy already says they are exhausted. Widening the markets only pays off together with a **new hypothesis family** that needs several markets (cross-market relative momentum, item 3 of `docs/RESEARCH_HYPOTHESIS_DIVERSITY_PLAN_20261112.md`).

So this is two steps, and only the second can create a candidate.

## 2. Step A: data (this design)

1. **Separate research markets from the PAPER feed markets.** Today one file sets both `NUSA_CLOUD_UPBIT_MARKETS` (the PAPER trading feed) and `NUSA_RESEARCH_MARKETS` (`scripts/start-cloud-runtime.js`, lines about 170-178). Putting four more markets in that file would also widen the PAPER trading feed, which the owner did not ask for. Proposal: an optional `researchMarkets` field in the owner file, applied only to `NUSA_RESEARCH_MARKETS`; absent means the old behaviour (the `markets` list for both). The same limits stay: 1-5 distinct KRW markets, fail closed on a malformed file. A test pins that `NUSA_CLOUD_UPBIT_MARKETS` stays `KRW-XRP`.
2. **Markets:** `KRW-XRP` (existing series stays, nothing is rebuilt), `KRW-BTC`, `KRW-ETH`, `KRW-SOL`, `KRW-DOGE` (five, the launcher's maximum). Liquid KRW markets with long histories; the list is the owner's to change.
3. **Backfill, not waiting:** the existing gap-fill fills candle history from the exchange's public candle endpoint with a bounded rate (`research-gap-fill ... pages=8` per pass on 2026-11-19). Four more markets need about 56 days of 1-minute candles each (about 80,000 rows each, 400 pages of 200). The time this takes at the current bounded rate is NOT measured; the first release must watch it and may not raise the rate.

## 3. Load and disk: what is known and what is not

- Known: a manifest build for one market took about 8 s per interval (1m, 15m, 60m) on 2026-11-19, now in bounded steps that hand the thread back (collector max stall 1.2 s). Five markets means about five times the builds per experiment tick.
- Known: 1-minute candles are small (one market is about 81,000 rows of a 2.3 GB database dominated by 5.2 million order-book rows). Four more markets add on the order of 320,000 candle rows.
- NOT known: the CPU and wall-clock effect on the host, the disk headroom after the release backup (the root disk was 90 percent full on 2026-11-18; the diagnose of 2026-11-19 showed 2.3 GB runner, 578 MB logs, 188 MB releases), and the gap-fill duration. The first release after approval is therefore staged with a recorded before/after read (`eventLoopMaxStallMs`, `researchGapFill` timings, disk) and the owner can switch the field back in a reviewed release.

## 4. Statistical accounting (must be fixed before any result)

More markets with the same rule grids add configurations. The cumulative holdout bar is `0.05 / (all configurations so far + the next experiment's)` (meta-learning rule 5), so every added configuration makes the bar stricter. Therefore:
- Step A alone adds **no new hypothesis**; the experiment runner for the exhausted families is not asked to run on the new markets (the policy deprioritizes them). It only collects candles and keeps the data ready.
- Step B must be pre-registered before its code is written: the signal (cross-market relative momentum rank over the five markets), horizon, grid, training/validation/holdout periods, cost model, the exact K, the pass rule, and whether the five markets are tested as one pooled hypothesis (one test, K counts once) or five separate ones (K counts five). Recommendation: one pooled cross-sectional hypothesis per grid cell; the pre-registration, not this document, decides. No gate, threshold or holdout rule is relaxed, and the holdout is opened once.

## 5. Order of work

1. This design: independent non-author review.
2. Launcher change (`researchMarkets`, test) and `deploy/oracle/paper-markets.json` change in **separate** draft PRs; independent review; they only take effect through a release.
3. A release by the controller path (never in the holdout window 2026-11-24T06:00Z..2026-11-28T06:00Z, never when the owner is unavailable), with the before/after read of section 3. Release stays a decision of the delegated process; Stage B is not touched.
4. Step B pre-registration (signal, K, periods, pass rule) with its own independent review, then code, then the run.

## 6. Not in this step

No code, host, release, limit, threshold, capital, order switch or authority change. No experiment on the new markets. The PAPER trading feed stays `KRW-XRP`.
