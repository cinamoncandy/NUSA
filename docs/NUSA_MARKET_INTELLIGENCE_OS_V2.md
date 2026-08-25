# NUSA Market Intelligence OS v2

## Mission

NUSA is not a single trading strategy and not a paper-trading app. It is a governed market-intelligence operating system whose purpose is to discover, falsify, combine, size, and monitor investment policies that can compound capital while avoiding catastrophic loss.

Success is defined by durable out-of-sample and forward evidence, not by one backtest, one model, one regime, or one headline return.

## Design principles

1. Prediction is not decision quality.
2. A profitable backtest is not evidence until search bias, leakage, costs, regime dependence, and data provenance are audited.
3. The system must be allowed to abstain. HOLD/CASH is a first-class action.
4. Per-prediction confidence is not the same as strategy health. Forecast uncertainty and concept-shift detection are separate layers.
5. Strategy diversity is an asset. The system maintains a population of complementary experts and adversarial exploiters rather than converging prematurely to one policy.
6. Execution is a modelled problem, not an afterthought. Market impact, spread, slippage, queue position, stale data, and latency can destroy apparent alpha.
7. Counterfactual learning matters. NUSA records what it chose and what credible alternatives would have done.
8. Research search itself is state. Every strategy/model/parameter trial is registered in an immutable trial ledger so multiple-testing corrections can use the true search count.
9. AI may propose, critique, summarize, and allocate research attention, but execution authority remains outside model sovereignty.
10. Risk controls are independent of strategy intelligence.

## Core architecture

### 1. Market State Fabric

Purpose: construct a point-in-time world state with strict temporal provenance.

Inputs may include:
- OHLCV and trades
- order-book and order-flow imbalance
- spread, depth, microprice, adverse-selection proxies
- derivatives state: basis, funding, open interest, liquidations when legally/technically available
- cross-asset context
- volatility and correlation structure
- macro/event/news features with observed-at timestamps
- data latency, staleness, source health, and missingness

Output: `MarketStateFrame` with source timestamps, observation timestamps, feature freshness, lineage, and quality flags.

No downstream model receives timeless or provenance-free features.

### 2. Regime & Shift Observatory

Separate two questions:
- What regime is the market in?
- Is the model/strategy still valid in this regime?

Components:
- regime probability model
- online change-point detector
- feature-distribution drift monitor
- strategy-performance drift monitor
- stale-evidence detector
- concept-shift alarm based on realized errors, not forecast confidence alone

Output: `RegimeBelief` and `StrategyHealthState`.

### 3. Forecast Guild

A heterogeneous set of specialists produces probabilistic forecasts rather than BUY/SELL commands.

Examples:
- trend/momentum specialist
- mean-reversion specialist
- volatility specialist
- microstructure specialist
- cross-asset specialist
- event/text specialist
- structural/rule-based baseline
- calibrated ML specialist
- optional RL specialist in research-only environments

Every specialist emits:
- target/horizon
- predictive distribution or calibrated probability
- uncertainty decomposition where available
- feature/data lineage
- expected holding period
- known failure regimes

### 4. NUSA League

Inspired by population/league training rather than a single champion.

Agent roles:
- Main agents: maximize robust economic utility across broad conditions.
- Specialist agents: optimize for narrow regimes or horizons.
- Exploiter agents: search specifically for conditions that break main agents.
- Baseline agents: simple rules that challengers must beat after costs.
- Frozen historical champions: prevent forgetting and cyclic rediscovery.

The league does not promote the highest-return member. Promotion uses multi-slice risk-adjusted evidence, diversity, stability, search-adjusted significance, and exploitability.

### 5. Counterfactual Branch Engine

At each eligible decision point, NUSA records a small bounded set of alternative actions/policies:
- abstain/cash
- current champion
- challenger
- reduced-size action
- opposite or neutral control where economically meaningful

The engine evaluates realized regret and opportunity cost without pretending that impossible fills were available.

Output: `DecisionRegretRecord`.

This creates a learning signal based on decision quality rather than raw PnL alone.

### 6. Uncertainty & Abstention Gate

Trading is optional.

The gate combines:
- forecast calibration
- epistemic/aleatoric uncertainty where available
- regime compatibility
- stale-data state
- model-health state
- expected edge after costs
- trial-adjusted evidence strength

Possible outcomes:
- `ACT`
- `ACT_REDUCED`
- `ABSTAIN`
- `QUARANTINE_STRATEGY`

A strategy can remain directionally positive yet be rejected when uncertainty or evidence quality is inadequate.

### 7. Research Integrity Kernel

This is the scientific-method core.

Required capabilities:
- immutable trial ledger
- point-in-time feature audit
- leakage tests
- walk-forward evaluation
- combinatorial/purged validation where appropriate
- Probability of Backtest Overfitting estimation
- Deflated Sharpe Ratio / search-adjusted inference
- bootstrap/Monte-Carlo stability
- placebo and hostile baselines
- regime slices
- parameter-neighborhood stability
- cost sensitivity
- capacity sensitivity
- reproducible dataset hashes

No model is promoted because one split looks good.

### 8. Execution Digital Twin

Replaces simplistic paper fills as the primary execution-validation layer.

Modes:
- `GHOST`: observe the live market, send no order, estimate whether/where the hypothetical order could have filled.
- `REPLAY`: deterministic historical tick/order-book replay.
- `SYNTHETIC`: calibrated limit-order-book stress simulation.
- `PAPER`: broker-style accounting simulator for operational integration.

Execution models track:
- spread
- slippage
- queue/depth assumptions
- latency/staleness
- impact/capacity
- partial fills
- maker/taker behavior

PAPER remains useful for operational plumbing but is not the sole proof of strategy quality.

### 9. Capital Market / Portfolio Allocator

Strategies do not directly own capital. They submit evidence-backed allocation requests.

Each request includes:
- expected return distribution
- downside/tail distribution
- confidence/calibration state
- expected cost
- regime compatibility
- correlation/diversification contribution
- requested capital/risk budget

Allocator responsibilities:
- robust portfolio construction under parameter uncertainty
- fractional-Kelly-style aggressiveness caps where justified
- volatility/risk targeting
- concentration limits
- correlation-aware diversification
- drawdown de-risking
- strategy quarantine
- cash as a valid allocation

The allocator optimizes robust long-run growth, not raw expected return.

### 10. Risk Constitution

Independent, non-learned hard constraints remain outside the strategy/AI layers.

Examples:
- maximum capital at risk
- maximum daily/rolling loss
- maximum leverage
- asset/concentration caps
- kill switch
- stale-data fail closed
- exchange/source health fail closed
- execution anomaly stop

A model cannot vote these limits away.

### 11. Evidence Memory

Every experiment, decision, failure, regime, counterfactual, and forward observation is versioned and attributable.

Stored objects include:
- dataset identity/hash
- strategy/model identity
- trial number
- code/source SHA
- parameter set
- evaluation protocol
- OOS metrics
- uncertainty/calibration metrics
- execution assumptions
- regime slices
- failure cases
- promotion/rejection reason

This is NUSA's durable investment memory, independent of any LLM provider.

## Objective hierarchy

Primary: maximize durable risk-adjusted capital growth under catastrophic-loss constraints.

Secondary:
- maximize calibration and abstention quality
- minimize search overfitting and regime fragility
- minimize execution-cost surprise
- maximize strategy diversity where it improves robustness
- minimize hidden operational dependencies

Not objectives:
- maximizing trade frequency
- maximizing backtest CAGR
- maximizing one-period win rate
- forcing a trade every cycle
- allowing an LLM's confidence statement to determine position size directly

## Research inspirations incorporated

This design intentionally combines ideas from financial ML evaluation, uncertainty-aware deployment, market microstructure, portfolio robustness, and open-ended multi-agent learning rather than copying a single trading-bot architecture.

Key external ideas used as design inputs:
- Probability of Backtest Overfitting / CSCV and search-adjusted validation
- Deflated Sharpe Ratio and explicit accounting for research trials
- purged/combinatorial validation for dependent financial data
- uncertainty-aware abstention and selective deployment
- conformal-style calibration/risk control under drift
- market microstructure and limit-order-book execution simulation
- population/league training with exploiters and frozen historical opponents
- distributionally robust portfolio allocation under parameter uncertainty
- hard pre-trade risk controls independent of model intelligence

## Safety boundary

This architecture is research and system design. It does not authorize real-money execution.

Current invariants remain:
- `liveAuthority = NONE`
- `productionMutationAllowed = false`
- `AI authority = ZERO_AUTHORITY`

WO-0051 remains the controlling human/environment gate for LIVE and real-money transition.