# Strategy Research Decision (WO-0031)

**Status: INSUFFICIENT_EVIDENCE**

**Strategy under evaluation:** SMA crossover, `shortWindow: 5`, `longWindow: 20`, 1-minute
timeframe, fingerprint `sma5x20-1m-samecandle-v1`.

This document records what the WO-0031 promotion gate
(`docs/research/strategy-research-promotion-gate-contract.md`) says about this repository
**as it actually is today**, not about a hypothetical complete evidence set. The
corresponding request is
`tests/fixtures/strategy-promotion-gate/current-repository-state.json`, and the numbers
below are the gate's real output for it.

## Decision

| Field | Value |
| --- | --- |
| `executionStatus` | `PASS` — the scorecard itself computed cleanly |
| `researchDecision` | `INSUFFICIENT_EVIDENCE` |
| Reason | missing evidence: `COST_STRESS` |
| `ownerReview.status` | `PENDING` |

`executionStatus: PASS` means only that the gate ran. It is not a statement about the
strategy. The strategy verdict is `INSUFFICIENT_EVIDENCE`.

## Dimension table

| ID | Dimension | Status | Trust | Confidence |
| --- | --- | --- | --- | --- |
| D-001 | Data Integrity | `INCONCLUSIVE` | `VERIFIED_SYNTHETIC` | LOW |
| D-002 | Backtest Integrity | `STRONG` | `VERIFIED_SYNTHETIC` | LOW |
| D-003 | Cost Resilience | `NOT_RUN` | `MISSING` | LOW |
| D-004 | Out-of-Sample Performance | `INCONCLUSIVE` | `VERIFIED_SYNTHETIC` | LOW |
| D-005 | Parameter Robustness | `INCONCLUSIVE` | `VERIFIED_SYNTHETIC` | LOW |
| D-006 | Regime Robustness | `INCONCLUSIVE` | `VERIFIED_SYNTHETIC` | LOW |
| D-007 | Cross-Market Generalization | `INCONCLUSIVE` | `VERIFIED_SYNTHETIC` | LOW |
| D-008 | Sample Sufficiency | `ACCEPTABLE` | `VERIFIED_SYNTHETIC` | LOW |
| D-009 | Benchmark Competitiveness | `INCONCLUSIVE` | `VERIFIED_SYNTHETIC` | LOW |
| D-010 | Operational Paper Safety | `INCONCLUSIVE` | `VERIFIED_SYNTHETIC` | LOW |

D-002 is `STRONG` and that is a real, meaningful result: backtest integrity —
closed-candles-only, deterministic repeat, benchmark parity, shared `PaperBroker`
accounting — is a property of the code, and synthetic candles establish it perfectly well.
It says the machinery is correct. It says nothing about whether the strategy makes money.

Every dimension that *would* say something about markets is `INCONCLUSIVE`, because every
research result in this repository was produced from synthetic fixtures.

## Blockers

| Kind | Detail |
| --- | --- |
| `EVIDENCE` | `COST_STRESS` evidence is missing |
| `TECHNICAL` | D-003: `COST_STRESS` evidence is missing |
| `OPERATIONAL` | operational Paper safety is not established |
| `EVIDENCE` | at least one evidence source is synthetic; synthetic evidence cannot support promotion |

## Sample thresholds

Every declared minimum is met — but on synthetic data, which is why meeting them changes
nothing about the verdict.

| Check | Value | Minimum |
| --- | --- | --- |
| marketCount | 4 | 3 |
| periodCount | 3 | 3 |
| validCellCount | 12 | 9 |
| oosWindowCount | 8 | 6 |
| completedTradeCount | 60 | 30 |
| regimeSegmentCount | 12 | 6 |

## What this means in plain terms

The research *infrastructure* for WO-0025..WO-0030 exists, is tested, is deterministic, and
independently verifies. The research *evidence* does not exist: no real historical Upbit
dataset has been run through any of it. There is no basis whatsoever for a claim that the
SMA 5/20 strategy is profitable, and this document makes no such claim.

Two things stand between the current state and a promotable scorecard, and neither can be
produced by writing more code:

1. **Real market data.** Every analysis must be re-run on real historical candles with
   `dataProvenance: REAL_MARKET_DATA`. Until then the provenance gate keeps every
   market-performance dimension at `INCONCLUSIVE` by construction, exactly as intended.
2. **Operational Paper safety evidence.** D-010 requires an independent risk gateway
   (WO-0032, not yet built) and real Paper acceptance evidence from actual observed
   sessions on Windows. Neither exists.

`COST_STRESS` evidence is additionally missing outright, which is what produces the
headline `INSUFFICIENT_EVIDENCE` reason.

## Permitted next actions

- Produce the missing research evidence (`COST_STRESS`).
- Re-run every analysis against real historical market data.
- Meet the declared minimum sample thresholds on that real data.
- Implement WO-0032 (independent risk gateway).

## Prohibited, unconditionally and regardless of any future result

Enable Live Trading; place real orders; use the Upbit private API; store credentials;
change the production strategy parameters or symbol automatically; start automatic Paper
trading automatically; transition PR #1 to Ready automatically; merge automatically.

## Owner review

`PENDING`. The scorecard does not approve anything by itself, and this document is not an
approval. No promotion, no Paper trial expansion, and no external claim of any kind
follows from it.
