# History mining H2: the one look at the hold-back (result, 2026-11-24)

Recorded unedited in `docs/research-data/history-mining-h2-look-result-2026-11-23.json` (History Look Freeze run 45295343044, PAPER host, source `9c4dd3267`, freeze record fingerprint `dc65065c...fdaa5`, fetch manifest `16274426...0a82` reproduced). The look is spent; it is not repeated and no rule was changed afterwards.

## Result
**LOOK_FAIL** (`testable: true`, pass rule `NET_STRESS_EXCESS_V2`, alpha per candidate 0.01). None of the five frozen rules passes. The hold-back is BTC, ETH, SOL and NEAR, 2023-07-05 .. 2024-10-31 (about 16 months); entry at the next hourly close, 24 hour hold, round-trip cost as frozen.

| rule | trades | mean net | excess over baseline | p (net) | p (excess) | pass |
|---|---|---|---|---|---|---|
| `CLOSE_VS_MA24_HIGH_Q90_H24` | 476 | 0.61% | 0.34% | 0.0047 | 0.0710 | no |
| `RET48_HIGH_Q90_H24` | 340 | 0.92% | 0.64% | 0.0030 | 0.0265 | no |
| `RET12_HIGH_Q90_H24` | 558 | 0.57% | 0.31% | 0.0078 | 0.0876 | no |
| `RUNUP24_HIGH_Q80_H24` | 643 | 0.63% | 0.36% | 0.0025 | 0.0561 | no |
| `RET48_HIGH_Q80_H24` | 683 | 0.61% | 0.36% | 0.0008 | 0.0337 | no |

The unconditional baseline (entering at every usable hour with the same 24 hour hold) earned a mean net of 0.20 percent per trade in this span: the hold-back was a rising market.

## Plain reading
- All five rules earned a positive mean net and stayed positive under the stress cost, and the net test (p between 0.0008 and 0.0078) is below the 0.01 bar. Alone, that would look like a pass.
- The frozen rule also demands an **excess over the always-in baseline** at the same bar. The excess is positive for all five (0.31 to 0.64 percent), but its p-values (0.027 to 0.088) are above 0.01. The best, `RET48_HIGH_Q90_H24`, is about 0.027: suggestive, not a pass. At a looser 0.05 level two rules would have crossed; the pre-registered bar is 0.01 and it is not reinterpreted.
- Consistency (descriptive, from the sign tables): `RET48_HIGH_Q90_H24` is positive in all four markets and five of six quarters (2024Q4 negative with only 14 trades); `CLOSE_VS_MA24_HIGH_Q90_H24` has a negative excess in NEAR and two negative-net quarters.
- Break-even cost is 0.71 to 1.02 percent round trip against the assumed cost; entry-rate drift is near 1 (0.96 to 1.11), so the thresholds carried over from discovery.

## Limits
One rising regime; NEAR survivorship (listed 2021-12); old-period costs are probably optimistic; five rules from 128 trials; the discovery span (2021-12 .. 2023-06) was mostly falling, so a momentum rule that survives both is interesting but also is the only thing this look says. 2024Q4 has few trades.

## What follows
- **No promotion**: nothing goes to PAPER; Stage B is untouched; no gate, threshold, limit or capital changes.
- **No re-look, no tuning, no re-run** of this window with these or neighbouring rules; the hold-back is spent.
- The only way to confirm `RET48_HIGH_Q90_H24` (and its Q80 sibling) is a **fresh pre-registration on a future span**: freeze the rule and thresholds now, then test on data that did not exist when they were frozen (the host store collects it daily; the earliest honest span starts after the pre-registration commit). Whether to do that is the owner's decision.
