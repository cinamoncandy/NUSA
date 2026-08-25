# NUSA Investment Performance Engine Roadmap

## Objective

NUSA should optimize for durable, risk-adjusted evidence of investment capability rather than isolated backtest return, UI breadth, or model confidence. The system may research and rank strategies automatically, but research evidence is not trading authority.

## Repository truth at registration

Base main: `d2a6c613c2d3542ef3d8f3512868ba431a79ede7`.

The repository already contains deterministic backtesting, walk-forward experiments, execution-cost modeling, champion/challenger governance, stage-promotion gates, PAPER runtime evidence, AIPOS provenance, and independent safety/security gates. The current real-market runner is intentionally narrow: KRW-BTC, 200 daily Upbit candles, and a small SMA parameter neighborhood.

That means the highest-value next step is not to add strategy complexity first. It is to make the evaluation backbone broad enough to reject false positives.

## North-star research objective

Increase the probability of durable positive risk-adjusted returns after realistic costs while minimizing ruin, overfitting, regime fragility, and evidence leakage.

No metric is a profit guarantee. Promotion decisions must use multiple independent dimensions and out-of-sample/PAPER evidence.

## Phase 1 — Benchmark integrity

Build one deterministic benchmark contract capable of comparing research slices across markets, timeframes, and regimes.

Required outputs:

- product/data identity and exact dataset provenance
- market and timeframe coverage
- out-of-sample return
- maximum drawdown
- benchmark return and outperformance
- profitable-window ratio
- benchmark-outperformance-window ratio
- trade count and turnover
- fees, spread, slippage, and total trading cost
- parameter-selection churn and train/OOS stability
- explicit coverage/quality warnings

The scorecard must remain descriptive and research-only. It must not become an execution or LIVE gate by itself.

## Phase 2 — Strategy laboratory

Place multiple strategy families behind the same evaluation contract:

- trend/momentum
- mean reversion
- breakout
- volatility-targeted variants
- regime-conditioned ensembles
- later, cross-asset ranking/allocation

A strategy family is not promoted because one parameter set wins one period.

## Phase 3 — Robust champion/challenger promotion

Promotion should require evidence across independent slices and penalize:

- excessive drawdown
- excessive turnover/cost sensitivity
- parameter-selection churn
- train/OOS degradation
- concentrated performance in one market/regime
- insufficient closed trades or OOS observations

Champion status remains reversible.

## Phase 4 — PAPER-only portfolio research

Research portfolio-level allocation without expanding authority:

- risk budgets
- volatility targeting
- concentration/correlation limits
- drawdown de-risking
- strategy quarantine/kill rules

All capital mutation remains PAPER-only until the constitutional LIVE gate is independently satisfied.

## Phase 5 — Bounded autonomous research loop

Automate only research workflow:

1. ingest point-in-time market data
2. validate data quality/provenance
3. generate bounded challengers
4. run deterministic train/OOS experiments
5. reject ineligible candidates
6. persist evidence and diagnostics
7. update research ranking
8. detect regime/performance drift

AI may propose research hypotheses but has zero trading authority.

## Phase 6 — PAPER forward validation

Compare research expectations with actual PAPER observations over time. Track slippage/cost/model drift and quarantine candidates whose forward behavior diverges materially from research evidence.

## Phase 7 — Human-reviewed LIVE readiness

LIVE/real-money readiness remains controlled by WO-0051 and genuine external/human evidence. CI, backtests, PAPER profit, chat consent, or AI confidence cannot complete that gate.

## First implementation slice

Create a canonical research benchmark scorecard over existing `ResearchExperimentResult` outputs. It should provide deterministic eligibility, ranking inputs, multi-slice coverage diagnostics, benchmark comparison, cost burden, drawdown, and selection-stability diagnostics without changing strategy execution or authority.

## Safety invariants

- `liveAuthority = NONE`
- `productionMutationAllowed = false`
- `realOrderAuthority = false`
- `realTransferAuthority = false`
- AI authority = `ZERO_AUTHORITY`
- financial knowledge/research evidence is not execution authority
