# History mining on years of public Upbit history (design proposal, 2026-11-23; authority_impact: none)

Owner question (2026-11-23): "과거 차트로 하면 안되나" (why not use the past charts, instead of the 45 days the host collected). Answer: yes, and it is better for power. This document fixes **which history may be used for what** before any value is fetched or read. It extends `docs/RESEARCH_HISTORY_MINING_DESIGN_2026-11-20.md` (sections 3 and 4); it changes no gate, threshold, limit, capital, order switch or authority.

## 1. Why
The windows of PR #3246 give about 18 days of discovery and 22 days of hold-back on four correlated markets: a pass is weak evidence and a fail does not exclude small edges (design 9.2, point 4). Upbit's public candle API serves years of 60-minute candles for every listed market, so the sample can be 10 to 30 times larger and cover rising, falling and sideways regimes. No host release is needed to fetch it.

## 2. What history has already been read (not blind)
From the headers and notes of the frozen offline screens (`scripts/offline-*.js`, `docs/RESEARCH_NOTE_2026-10-13_OHLCV_CATALOG.md`, `docs/research-data/`):

| Data | Span | Markets | Already used for |
|---|---|---|---|
| Daily closes / OHLCV | 2021-10-15 .. 2026-10-12 | BTC, ETH, XRP, SOL, DOGE | daily-bar families, catalog screens; daily hold-out 2025-10-13 .. 2026-10-12 was evaluated |
| 60-minute closes / OHLCV | 2025-01-16 .. 2026-10-12 | BTC, ETH, XRP, SOL, DOGE | 135 configurations screened (97 close-only + 38 OHLCV), 0 passed the hold-back; 60m hold-out 2026-06-14 .. 2026-10-12 was evaluated |
| Forward test REGIME_BREAKOUT N=50 | from 2026-10-14 | BTC, ETH, XRP, SOL, DOGE | verdict due 2026-12-13; nobody reads its rows before then |
| 1-minute candles on the host | 2026-10-07 .. | XRP read by earlier experiments; BTC, ETH, SOL, NEAR read by nobody | candle_extent counts only |

**Not read by any study:** hourly (60m) candles of any market before 2025-01-16 (the daily closes of 2021-2024 were read, hourly values were not); and **every candle of KRW-NEAR and of any market outside the five**. The reserved cut stays: no value at or after 2026-11-20T00:00Z (cross-market study, signal screen).

## 3. Proposed split (the owner decides; recommendation H2)
- **H2 (recommended): time split in unseen hourly history.** Discovery on 60m candles of BTC, ETH, SOL, XRP and NEAR from the first available bar (about 2021-10, per market) to 2023-06-30; purge 96 hours; hold-back 2023-07-05 .. 2024-12-31 (before the earliest screened hourly bar of 2025-01-16, with a further 96-hour purge). The one look is on the hold-back of BTC, ETH, SOL and NEAR (XRP is discovery-only as before). Both windows are hourly-unseen; the sample is about 1.5 years of hold-back instead of 22 days.
- **H1 (alternative): unseen markets.** Discovery as in H2 on the five known markets; hold-back on liquid markets nobody has read (NEAR, ADA, SUI, ONDO, AVAX, LINK, selected by a formula fixed before fetching, e.g. 45-day mean traded value rank above a stated bar and at least 400 days of listing). Independent of time and regime, but the new markets move with BTC.
- **Forward confirmation (both):** the 45 days the host collects (and the PR #3246 windows) stay as the later forward check of any survivor, as in design section 4 step 5. A candidate that passes only the historical look is a hypothesis for the forward test, never evidence of profit and never an order permit.

## 4. Data integrity (before any value is read)
1. Commit this design and the fetch script **before** fetching (the earlier screens did the same).
2. A `--fetch` step downloads public candles only (no key, no account) into frozen files with a manifest of SHA-256 hashes; a later fetch must reproduce the hashes (as `scripts/fetch-futures-history.js` does). Any gap, duplicate, unordered or unclosed bar aborts the run.
3. Timestamp convention check on the overlap days before use: the mining tool reads the 1-minute close at each full hour (`close_time_ms % 3_600_000 == 0`); an Upbit 60m candle starts at `candle_date_time_utc` and closes one hour later. A check on counts and times (never values) must show that the hourly close of the 60m file and the 1-minute close at the same hour agree on at least a sample of hours, or the loader must be corrected, before the windows are frozen.
4. The mining script runs unchanged on a temporary SQLite file built from the frozen 60m closes (rows at the full-hour close times); the cut at 2026-11-20T00:00Z and the 96-hour purge stay enforced by `checkWindows`.

## 5. Protocol (unchanged from design section 4)
Discover (aggregates only) → freeze record committed BEFORE the look → one look on the hold-back by the owner's word → descriptive result. The five open points of design section 9.2 (buy-and-hold baseline, same-close entry, per-market coverage, power, and the market list) are resolved or accepted by the owner **before the freeze record**. The windows are never edited after the first discover output.

## 6. Limits stated on purpose
- Hourly history before 2025 was never read, but the daily closes of those years were; general knowledge of the price path is not erasable. A pass is still a hypothesis.
- Listing dates differ: NEAR and some alternatives have shorter histories; markets enter a window only from their first bar.
- Past regimes (2021-2024) differ from now; a rule that works there may not work in 2026. That is exactly what the forward confirmation tests.
- Costs: the fee and the 10 bp / 30 bp cost reading of design section 9 apply; old spreads were wider, which makes old results conservative at best.
- No order, order book or trade tick history exists on the public API; this route covers candle-based rules only.

## 7. Decisions needed (owner)
1. H2 or H1 for the one look (recommendation H2).
2. Whether to spend the single look on historical data first (recommendation: yes, because the host data cannot give a decisive answer, and the forward confirmation stays available).
No fetch, no code run and no value read happens until this design is reviewed and merged.
