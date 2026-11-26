# Research desk, batch 1: twelve new rules screened on history (2026-11-26)

Work order `WO-RESEARCH-20261126-DESK-BATCH1`. Offline, read-only, PAPER_ONLY, `authority_impact: none`. No order-book value and no S2-S4 holdout value was read; prices only, from the files fetched earlier (56 daily KRW markets, five markets of 5-minute candles to 2026-11-04). No network access, no order path.

Korean summary (한 줄): 새 규칙 12가지(일봉 종목 비교 6, 5분봉 시간대 6)를 두 분석가가 병렬로 시험했고, 1차를 통과한 것이 1개, 2차까지 통과한 것은 0개다. 앞으로 검증할 후보는 없다.

## How the desk worked (the idea taken from the owner's reference video of a "one-person hedge fund")
- **PM (this session):** wrote the hypotheses with their economic reasons and the pass bars (same bars as the earlier screens, not loosened).
- **Two analysts (subagents, one per data set):** each wrote its full rule text and bars to a `PREREG.md` and, by its own report, recorded its SHA-256 **before** writing or running its script; neither reports changing a rule or a bar after seeing a result (the file hashes match; the timing rests on the analysts' reports, not on anything in the repository). The two prereg files are committed unchanged: `docs/research-data/desk-batch1-prereg-a-2026-11-26.md` (sha256 `7ccc192b5cade041f6d4016e5130975ea67b763fd0134b9f7bb48846ab5b0a95`) and `...-b-2026-11-26.md` (sha256 `5414d88600b81b9c0a507f1724b5ef681de68416c72ab28f84ba19950def5bf9`).
- **Committee (this session):** re-ran both scripts once and confirmed the printed tables are identical to the analysts' reports. Nothing in this batch can place an order: it reads price files only.
- Scripts: `scripts/offline-desk-a-screen.js <dir>`, `scripts/offline-desk-b-screen.js <dir>`; the data directories are fetched by `scripts/offline-crosssection-screen.js fetch` and `scripts/offline-scalp-screen.js fetch` (public Upbit GETs, outside the repository).

## Result A: six cross-sectional daily families (56 markets, K=6, second-filter p bar 8.33e-3)
| Family | Cohorts | +windows | UP excess | DOWN excess | Discovery | Last-365d cohorts | Mean excess/cohort | p | Second |
|---|---|---|---|---|---|---|---|---|---|
| SIZE_REV (illiquid markets that fell most) | 243 | 4/6 | +0.42% | +0.40% | **PASS** | 51 | +0.13% | 0.356 | fail |
| LISTING_AGE (markets 90 to 240 days old) | 90 | 2/6 | +1.03% | -0.78% | fail | 0 | n/a | 1.00 | fail |
| WEEKDAY_XS (Friday momentum) | 244 | 1/6 | -0.32% | -1.21% | fail | 52 | -0.34% | 0.729 | fail |
| BTC_BETA_ROT (high-beta markets when BTC rises) | 128 | 2/6 | -1.09% | +0.01% | fail | 22 | +1.70% | 0.119 | fail |
| VOL_COMPRESS_BREAK | 53 | 2/6 | +0.08% | -0.83% | fail | 12 | +1.82% | 0.204 | fail |
| DOWNVOL_LOW | 121 | 2/6 | +0.36% | -0.34% | fail | 25 | +0.41% | 0.361 | fail |

SIZE_REV passed discovery but its window excess was 1.25, 0.05, -0.27, 0.82, 1.11, -0.50 percent (not stable) and its last year, +0.13% per cohort, has p = 0.36 against the bar 0.0083.

## Result B: six UTC time-of-day rules (5-minute candles, 5 markets, K=6)
Window market returns were -15.5%, -19.7%, -8.2%, +8.5%, -19.9%, -9.0%: only one up-window.
| Rule | Trades part 1 | Gross/trade | Net/trade | +windows | Part 1 | Trades part 2 | Net/trade part 2 | p | Part 2 |
|---|---|---|---|---|---|---|---|---|---|
| HOUR_00_03 | 1375 | -0.032% | -0.232% | 0/6 | fail | 450 | -0.211% | 1.00 | fail |
| HOUR_08_11 | 1371 | -0.050% | -0.250% | 0/6 | fail | 450 | -0.153% | 1.00 | fail |
| HOUR_13_16 (Korean evening) | 1368 | -0.014% | -0.214% | 0/6 | fail | 449 | -0.124% | 0.971 | fail |
| KST_OPEN_REV | 156 | -0.060% | -0.260% | 3/6 | fail | 41 | -0.101% | 0.740 | fail |
| SUN_NIGHT | 182 | +0.027% | -0.173% | 3/6 | fail | 59 | -0.777% | 1.00 | fail |
| FIRST_BAR_BREAK | 61 | -0.656% | -0.855% | 1/6 | fail | 10 | -0.717% | 0.896 | fail |

## Reading
- Nothing in B has a gross edge above the 0.20 percent taker round trip; the best raw number (SUN_NIGHT, +0.027% gross) is a fraction of the cost and does not hold in part 2. Three rules also fail the trade-count minimums.
- In A, the one discovery pass is consistent with chance: 6 families, a 6-window rule, one pass; the last year does not confirm it.
- With the earlier screens (97 + 12 + 6 + 6 + 8 = 129) the history screens now cover **141 rules (129 + 12), none eligible** for a forward pre-registration.

## Disclosures
- Survivorship (current markets only, worst for LISTING_AGE and SIZE_REV); fills at the signal close (optimistic); flat costs; the last year was partly read by earlier screens; the p values use a normal approximation. LISTING_AGE had no cohort in the last 365 days, so its second filter could not be tested. **LISTING_AGE is not a valid test of new listings:** a market's age is measured from its first candle in the file, and 48 of the 56 markets have their first candle on 2021-12-22 (a fetch cap, not a listing date), so early cohorts mix old markets into the 90 to 240 day band; the family would need to be restricted to markets whose first candle is later than the fetch start.
- B pools five highly correlated markets and the z-test treats the trades as independent, so its p-values are too optimistic; every rule failed, so no conclusion changes. B's markets are aligned by array index (104,712 to 104,880 bars), up to 14 hours apart at the end: negligible.
- Analysts made small choices not in the brief and fixed them in their prereg before running (benchmark definition, skipped cohorts in BTC_BETA_ROT, the percentile rule in VOL_COMPRESS_BREAK, the exit bar of the B windows); all are in the committed prereg files.
- Multiple testing: six families per analyst; no family-wise correction across the batches is claimed.

## What this changes
Nothing in code, rules, thresholds, limits, capital or authority. No forward pre-registration follows. The method (PM sets hypotheses with reasons; analysts fix rules and bars in a hashed file before running; a committee re-runs and a non-author reviewer checks) works and is cheap; it did not produce a candidate. Next sources of evidence remain the registered forward studies (trade-flow v2 on 2026-11-29, S2-S4 2026-12-05, order-book third run 2026-12-10, S5 2026-12-20, RET48, weekly trend, breadth filter).
