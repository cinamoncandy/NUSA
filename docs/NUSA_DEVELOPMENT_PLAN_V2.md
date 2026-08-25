# NUSA Development Plan v2

## Strategy reset

The previous linear plan of `backtest -> PAPER -> LIVE` is no longer the organizing architecture.

New development path:

`POINT-IN-TIME WORLD MODEL -> SEARCH-INTEGRITY -> STRATEGY LEAGUE -> COUNTERFACTUAL LEARNING -> UNCERTAINTY/ABSTENTION -> EXECUTION DIGITAL TWIN -> ROBUST CAPITAL ALLOCATION -> FORWARD EVIDENCE -> HUMAN-GATED LIVE READINESS`

PAPER remains an operational integration mode, not the center of intelligence validation.

## Phase 0: Preserve current truth

Keep current runtime, mobile, PAPER, AIPOS, safety, and evidence flows working.

Required invariants:
- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- `AI authority=ZERO_AUTHORITY`
- WO-0051 remains controlling for LIVE transition

No big-bang rewrite.

## Phase 1: Research Integrity Kernel

Priority: highest.

Build:
1. immutable `TrialLedger`
2. search-count-aware benchmark scorecard
3. DSR/search-adjusted inference
4. Probability of Backtest Overfitting support
5. purged/combinatorial validation adapter
6. placebo/hostile baseline suite
7. cost and parameter perturbation battery
8. regime-sliced validation
9. dataset/source SHA binding

Acceptance:
- strategy trials are registered before result inspection
- a candidate cannot be promoted from one favorable split
- failed/ineligible candidates remain visible
- multiple-testing context cannot be silently discarded

Existing PR #794 benchmark scorecard is compatible with this phase and should be evolved, not thrown away.

## Phase 2: Market State Fabric

Build point-in-time `MarketStateFrame` and temporal integrity contracts.

Initial crypto scope:
- KRW-BTC plus additional high-liquidity markets
- multiple horizons
- OHLCV/trades
- spread/depth/order-flow features when source support exists
- source latency/staleness
- cross-asset and volatility context

Later optional sources:
- derivatives funding/basis/open interest/liquidation context
- event/news state with observed-at timestamps

Acceptance:
- no feature without provenance and observation time
- stale evidence is explicit
- missing data fails closed for models that require it

## Phase 3: Regime & Strategy Health Observatory

Implement separate layers for market regime and strategy validity.

Build:
- regime probabilities
- change-point detection
- feature drift
- realized forecast-error drift
- strategy health score
- stale-information health

Acceptance:
- regime uncertainty is represented, not forced into one label
- per-prediction confidence cannot substitute for concept-shift detection
- unhealthy strategies can be quarantined before portfolio allocation

## Phase 4: Forecast Guild

Standardize specialist probabilistic forecast contracts.

First specialists:
- transparent trend baseline
- transparent mean-reversion baseline
- volatility forecast
- cross-asset momentum/ranking
- microstructure specialist if execution-grade data is available

Then:
- calibrated tree/boosting models
- sequence models where justified by benchmark evidence
- event/text specialist with strict event-time provenance

Acceptance:
- all forecasts have horizons and calibration evidence
- model complexity must beat transparent baselines net of costs
- forecast accuracy alone is insufficient for promotion

## Phase 5: NUSA League

Create a population of heterogeneous strategies.

Roles:
- main
- specialist
- exploiter
- baseline
- frozen champion

Build:
- league registry
- matchmaker across regimes/slices
- exploitability tests
- diversity score
- frozen-champion replay
- promotion contract

Acceptance:
- new champions must survive exploiters and old champions
- diversity is rewarded only when it improves portfolio robustness
- cyclic forgetting is detected

## Phase 6: Counterfactual Branch Engine

At each research/ghost decision, evaluate a bounded alternative set.

Build:
- action branches
- feasible fill assumptions
- realized regret
- opportunity cost
- decision-quality calibration

Acceptance:
- counterfactuals do not assume impossible fills
- every evaluated branch is reproducible
- learning can distinguish lucky PnL from superior decisions

## Phase 7: Uncertainty & Abstention Gate

Make `ABSTAIN` a first-class outcome.

Inputs:
- calibrated forecast
- uncertainty
- regime compatibility
- strategy health
- stale-data state
- expected execution cost
- search-adjusted evidence strength

Outputs:
- ACT
- ACT_REDUCED
- ABSTAIN
- QUARANTINE

Acceptance:
- low-evidence periods produce fewer trades, not fabricated confidence
- abstention quality is benchmarked against matched-random and simple rules
- high-confidence failures are explicitly measured

## Phase 8: Execution Digital Twin

Develop alongside PAPER, not after it.

Modes:
- GHOST
- REPLAY
- SYNTHETIC LOB
- PAPER

Build:
- latency/staleness model
- spread/slippage model
- partial fills
- depth/queue assumptions
- maker/taker variants
- impact/capacity estimation
- calibration from observed public market behavior

Acceptance:
- research result changes under harsher costs are quantified
- execution assumptions are versioned
- OHLC ambiguity is not silently resolved in favor of the strategy

## Phase 9: Robust Capital Allocator

Strategies request capital; they do not own it.

Build:
- allocation request contract
- risk-adjusted capital auction
- robust optimizer under parameter uncertainty
- risk budgets
- correlation/concentration guard
- drawdown de-risking
- optional fractional Kelly cap after calibration
- cash allocator

Acceptance:
- portfolio objective is long-run robust growth, not summed strategy returns
- capital can move to cash
- uncertainty reduces aggressiveness
- one strategy cannot dominate capital without durable evidence

## Phase 10: Bounded Autonomous Research Loop

AI automation is useful here because the output is research, not authority.

Loop:
1. propose hypothesis
2. register trial before results
3. select data/protocol
4. run evaluation
5. red-team candidate
6. compare against baselines
7. store evidence
8. promote/reject/quarantine
9. generate next bounded challenger

Controls:
- trial budget
- compute budget
- search-count ledger
- immutable evidence
- no autonomous LIVE authority

Acceptance:
- autonomous research cannot erase failed experiments
- repeated search increases statistical hurdle rather than hiding it
- AI-generated strategies receive the same hostile audit as human strategies

## Phase 11: Forward Evidence

Forward validation no longer means only PAPER PnL.

Evidence stack:
- live market prediction calibration
- strategy abstention quality
- Ghost execution
- decision regret
- portfolio shadow allocation
- PAPER operational correctness
- strategy/model-health drift

Acceptance horizon should be evidence-driven, not a fixed arbitrary number of days.

## Phase 12: LIVE readiness

Only after prior evidence demonstrates:
- robust OOS performance
- search-adjusted significance
- stable calibration
- acceptable drawdowns/tails
- execution realism
- forward evidence
- operational reliability
- independent risk controls

LIVE remains HUMAN_ENVIRONMENT_ONLY under WO-0051 until separately authorized.

## Immediate implementation queue

P0-A: finish/evolve benchmark scorecard (#794) into Research Integrity Kernel contract.

P0-B: add `TrialLedger` before expanding strategy search.

P0-C: add search-adjusted metrics and PBO/DSR evidence fields.

P0-D: introduce multi-market/multi-horizon MarketStateFrame with temporal provenance.

P1-A: build regime/strategy-health observer.

P1-B: add abstention gate using transparent baselines first.

P1-C: implement Ghost execution recorder.

P1-D: implement Counterfactual Branch Engine.

P2-A: create league registry + exploiter framework.

P2-B: broaden specialist library only after integrity gates exist.

P2-C: robust capital allocator and capital auction.

P3: bounded autonomous research orchestration.

## What is deliberately postponed

- end-to-end RL controlling real money
- LLM BUY/SELL sovereignty
- high-frequency execution without execution-grade data
- complex deep models before simple baselines are beaten
- automatic LIVE promotion

## Definition of progress

NUSA improves when it becomes harder to fool and better at allocating risk to real, repeatable edge.

Primary program metrics:
- search-adjusted OOS performance
- cross-regime stability
- calibration error
- abstention value
- PBO / DSR evidence
- drawdown and tail loss
- cost sensitivity
- decision regret
- strategy-health recovery
- portfolio diversification benefit
- Ghost-to-realistic-fill calibration

Raw backtest return is a diagnostic, not the north-star metric.