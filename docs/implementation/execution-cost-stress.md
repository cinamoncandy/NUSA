# Execution-Cost Stress Grid

## Purpose

The Execution-Cost Stress Grid reruns the same Walk-Forward research plan under deterministic fee, spread, and slippage scenarios. It measures sensitivity to modeled execution costs; it does not guarantee profitability or live-readiness.

## Scenario Discipline

Every scenario uses the same ordered points, candidate set, Walk-Forward windows, and dataset identity. Scenarios are canonically ordered by fee rate, spread, slippage, then ID. Invalid, duplicate, missing-baseline, non-finite, or impossible sell-price scenarios fail closed.

Unfavorable scenarios are retained in the result. They are never removed after observing OOS performance.

## Selection Modes

- **RESELECT_PER_SCENARIO** is the default. Each scenario reruns train-only candidate selection using that scenario's costs.
- **FIX_BASELINE_SELECTION** uses candidates selected by baseline training for every scenario and window.

The modes are recorded and are not mixed. Neither mode permits test data to choose a candidate.

## Outputs

Scenario results keep marked return/drawdown separate from closed-trade profit, expectancy, and profit factor. The grid reports costs, turnover, exposure, benchmark comparison, OOS ratios, degradation from baseline, worst outcomes, and warnings.

Break-even is an **ESTIMATED**, **NOT_EXACT**, **GRID_DEPENDENT** linear interpolation only between the last positive-expectancy scenario and the first non-positive scenario. If the grid has no crossing, it is reported as not found.

## Research Memory

Stress results generate a deterministic identity from source experiment identity, dataset checksum, canonical stress-grid checksum, selection mode, and engine version. The existing immutable Research Memory repository may append the result; identical records are idempotent and conflicting IDs fail closed.

## Limits

Latency is recorded but not modeled. Market impact, queue position, partial fills, and real exchange behavior are not included. Positive results under high modeled costs are not evidence of live readiness. OOS stability and separate Paper Trading evidence remain required.
