# Alpha Lab F2b synthetic e-value power result

**Status:** one frozen, offline synthetic measurement. It adopts no test, strategy, rebalance interval, threshold, or promotion decision.

## Run record

- Work Order: `WO-RESEARCH-20261128-ALPHA-LAB-F2B-EVALUE-POWER`
- Base: `5846d6b58b4fa7f5aff7ea7b746a8fc8f3222e92`
- Analysis commit: `403e4641db0bde7ed9d9fc1410ef97b5545f08e2`
- Analysis script SHA-256: `5439dcee3c9c25e3fce81512770eb66fd31cc778fc4069a3361384e8273dd1be`
- Configuration SHA-256: `baa0ce0a3ac95a8003f30f410aca98d89773d806637237f545951674b12a7343`
- Primary artifact SHA-256: `1901d4dac5b03323b9aa3f800c7fbf4d7d4b8f0561ad128f3fe273894ee6e562`
- Seed `20261128`; 1,000 replications per scenario; 15 scenarios; 56 markets; 365 days; 20-day burn-in.
- Synthetic one-factor t4 market return and standardized idiosyncratic innovations. No market data or trading/runtime path was read or used.

For each hold length `H ∈ {1, 5, 20}`, the simulated score correlation with the normalized block return is `dailyIC × sqrt(H)`. This keeps the configured `dailyIC` model parameter equal across horizons; it does not measure or guarantee equal realized cross-sectional per-day Pearson or Spearman IC in the finite simulated samples. Alternatives use the frozen F2 turnover cost convention (0.0015 × daily one-way weight turnover); zero-IC null diagnostics are cost-free to measure the centered null rather than a cost-induced negative-mean null. The proposed alpha `0.0125` is included only for comparison and remains unadopted.

The four measured variants are the F2 fixed lambda mixture `[0.02, 0.05, 0.1, 0.2, 0.35, 0.5]` at 4-sd clipping; a wider fixed mixture at 4-sd; a predictable past-only adaptive wager capped at `0.99` at 4-sd; and the F2 mixture at 8-sd. Rates below are the fraction of 1,000 paths crossing by day 365. The JSON contains day 90/180/365 results and Wilson 95% intervals for day 365.

## Observed null crossings by day 365

| Hold | Symmetric t4: F2 / wider / adaptive / 8-sd | Right-skewed zero-raw-mean: F2 / wider / adaptive / 8-sd | Right-skewed mean clipped normalized excess |
|---:|---:|---:|---:|
| 1 | 0.0% / 0.6% / 0.2% / 0.0% | 0.0% / 0.0% / 0.1% / 0.0% | -0.0016 |
| 5 | 0.0% / 0.4% / 0.3% / 0.0% | 0.0% / 0.5% / 0.3% / 0.0% | -0.0009 |
| 20 | 0.0% / 0.2% / 0.5% / 0.0% | 0.0% / 0.0% / 0.2% / 0.0% | -0.0024 |

These are finite-simulation estimates, not proof of false-pass control. The skewed rows have zero raw expected excess by construction; the e-process null concerns the conditional mean after predictable scaling and clipping, which is a different condition. Their clipped-mean values are reported to make that distinction visible.

## Alternative crossing rates by day 365

| Configured model `dailyIC` | Hold | F2 mixture | Wider mixture | Adaptive | F2 mixture, 8-sd |
|---:|---:|---:|---:|---:|---:|
| 0.02 | 1 | 0.0% | 0.0% | 0.0% | 0.0% |
| 0.02 | 5 | 0.8% | 2.9% | 2.4% | 0.0% |
| 0.02 | 20 | 4.8% | 12.5% | 12.3% | 0.0% |
| 0.04 | 1 | 0.0% | 0.1% | 0.1% | 0.0% |
| 0.04 | 5 | 31.6% | 48.7% | 46.6% | 0.5% |
| 0.04 | 20 | 64.2% | 78.1% | 77.1% | 4.4% |
| 0.08 | 1 | 24.3% | 40.1% | 38.5% | 0.5% |
| 0.08 | 5 | 100.0% | 100.0% | 100.0% | 94.0% |
| 0.08 | 20 | 100.0% | 100.0% | 100.0% | 99.0% |

In these simulated alternatives, the wider mixture and adaptive wager cross more often than the F2 mixture in several rows; the 8-sd variant crosses much less often at moderate IC. The rates combine the test behavior with the specified turnover costs, which differ by hold. They do not isolate a real-world test advantage or establish that any hold or variant is preferable.

## Limits

- Scores are generated with a chosen correlation to future synthetic returns; this is a power experiment under its own data-generating model, not evidence that a real signal has that IC.
- The model does not represent real cross-market dependence, market regimes, liquidity, fills, fees beyond the stated turnover convention, slippage, or execution.
- Each estimate uses 1,000 paths. A displayed 0.0% means no crossings were observed in this run, not that the probability is zero; consult the artifact's Wilson intervals.
- The script derives a separate pseudorandom seed for each hold length. Wilson intervals are marginal for each scenario cell and are not intervals for differences between holds; differences include Monte Carlo variability. The realized Pearson and Spearman rank ICs were not measured, and these results do not establish that one hold is better than another.
- A zero-raw-mean distribution need not satisfy the clipped conditional-mean null. The skewed-null rows are diagnostics, not a validity certification.
- No result changes a registered hypothesis, production e-process, strategy, program alpha, risk limit, PAPER/live authority, or promotion gate. No method or trading recommendation is made.

## Reproduction

The frozen analysis source records the script and canonical configuration hashes in the artifact. The primary configuration was run once after the script hash was frozen. It was not rerun to select or tune a result.
