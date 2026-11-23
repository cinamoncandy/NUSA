# History fetch: reproduction and timestamp-convention check (2026-11-23)

Records the two checks of design `docs/RESEARCH_HISTORY_MINING_OFFLINE_HISTORY_DESIGN_2026-11-23.md` section 4 that need no candle analysis. Counts and hashes only; no price was read or printed.

## 1. Reproduction of the frozen hashes
- First fetch: History Fetch Freeze run 45194702415 (2026-11-23 14:29Z, source `1e64235b7`, script sha256 `9e5ab2ee...`); manifest `docs/research-data/history-mining-upbit-60m-manifest-2026-11-23.json` (#3254).
- Second fetch: run 45274461685 (2026-11-23 21:55Z, same inputs, workflow file at main `550a085cd`).
- Result: all nine file hashes, row counts, first/last candle starts and missing hours are identical; manifest SHA-256 `16274426370e8a713c7e20d67c0ce27426a43aedb12eae70af5bb8e8e73e0a82` in both runs. Closed bars are immutable as expected; the fetch is reproducible.

## 2. Timestamp convention on already-read days only
Compared the committed 1-minute close file `docs/research-data/2026-10-08-upbit-1m-closes.json` (2026-10-05 .. 2026-10-08) with the committed hourly close file `docs/research-data/2026-10-12-upbit-60m-closes.json` at the timestamps that occur in both. Only these two committed files were used; no host data from 2026-10-07 onward that later claims rely on.
- Hours present in both at the identical timestamp: KRW-BTC 72, KRW-ETH 72, KRW-XRP 72, KRW-SOL 73 (KRW-DOGE 79, no longer used). Agreeing closes: all of them; disagreeing: 0.
- No agreement at any other offset tested (minus 1 minute, plus 59 minutes, plus 1 hour): 0 matches each.
- Reading: the hourly row stamped T carries the close of the 1-minute bar that ends at T, the same convention as the host store (`close_time_ms = start + 60,000`), and so the mapping "a 60m candle starting at s becomes the hourly close row at s + 1 h" of `scripts/fetch-upbit-60m-history.js` is consistent with it. The check says nothing about the 2021-2024 data.

## Not checked
The convention for the 2021-2024 files themselves (only the already-read recent days were used); fetch behaviour under an Upbit rate limit (no HTTP error occurred in either run).
