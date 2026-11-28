# Alpha Lab IC-decay measurement — 2026-11-28

Status: **descriptive measurement only**. No signal was registered, selected as a winner, or traded. This does not qualify a candidate or authorize PAPER/production behavior.

- History cutoff: daily candles dated through **2026-11-04 UTC**, inclusive. Dates 2026-11-05..2026-12-05 and all order-book values were excluded by the request boundary and row validation.
- Source: public Upbit daily candles; request started 2026-11-28T01:14:35.752Z and finished 2026-11-28T01:17:31.844Z (copied from the hashed JSON manifest).
- Universe: 56 markets from docs/research-data/broad-universe-filter-count-20bp-2026-11-24.json (SHA-256 8c145fed3cd2e0d88919418ff7c2c3af0fd1a62e02efa6c1a9c3872211ea330d); fixed membership from the existing 2026-11-24 discovery pool.
- Script SHA-256: d69a349cad545fd0fa3f5866f1e7ae5d2fa30253a52a16e78068a90c597d9059; frozen-spec SHA-256: d7476a8c3b26638fb81f94231348addb1e702d60764c3b37cbe077e6e39ae141; result-payload SHA-256: 02253a10fe48500c4803b13f9a81de5559fea7a9f01a990b88121a9be6d46302; manifest SHA-256: 6b696bba6647b3ed8eb16ef5b1485456df9d71235137fcb0d73b7fcfb148afb7; JSON file SHA-256: d0d0b87577ac61a066db466f716baf43275ce17a95147a1c9065491b74a6e8b5.
- Valid date range across reported rows: 2018-12-01 through 2026-11-03.

Each cell is mean daily cross-sectional Spearman rank IC with a two-sided 95% circular moving-block bootstrap percentile interval (20 calendar-day blocks, 5,000 replicates, seed 20261128). Forward return is close(t+h)/close(t)-1; signal values use only closes through day t. Dates with fewer than 20 usable markets are omitted, following the existing 20-market minimum in the weekly-trend design. The daily series, pair counts, and per-market OHLCV SHA-256 manifest are in the adjacent JSON artifact.

The work order points to section 7 of the V3 design, but the current cited file ends at section 6. The candidate families and sources here are therefore taken from its existing sections and the existing research-family collection; no hold decision is inferred.

| Signal | 1 day | 5 days | 10 days | 20 days |
| --- | ---: | ---: | ---: | ---: |
| momentum_28d | -0.0582 [-0.0687, -0.0475] | -0.0475 [-0.0666, -0.0278] | -0.0397 [-0.0629, -0.0156] | -0.0358 [-0.0634, -0.0080] |
| short_term_reversal_1d | 0.0283 [0.0199, 0.0367] | 0.0311 [0.0219, 0.0402] | 0.0179 [0.0087, 0.0270] | 0.0035 [-0.0055, 0.0126] |
| low_volatility_20d | 0.0775 [0.0691, 0.0853] | 0.0825 [0.0657, 0.0993] | 0.0857 [0.0641, 0.1082] | 0.0952 [0.0687, 0.1230] |

Limitations: this is historical descriptive research on an already-read history, not a blind test. The current filtered universe can introduce survivorship and membership bias; no fees, costs, portfolio returns, or execution are evaluated. The intervals do not correct for looking across multiple signals and horizons. No hold period or strategy is recommended from these numbers.

- The bootstrap intervals are conditional on the fixed 20-observation circular block length. No block-length sensitivity analysis was run; overlapping forward returns or dependence extending beyond 20 observations may make these intervals understate uncertainty. A 40/60-observation comparison is outside this one-run work order.
- The JSON manifest records per-market hashes of normalized OHLCV, not the raw candle rows. Those hashes can reveal that a later refetch differs, but they cannot reconstruct the exact input response used for this measurement. No immutable raw-data archive is included.
