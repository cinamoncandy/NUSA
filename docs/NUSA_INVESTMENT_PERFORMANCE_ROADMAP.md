# NUSA Investment Performance Engine Roadmap

## Mission

NUSA's investment objective is to maximize long-run risk-adjusted capital growth while preserving survivability, auditability, and explicit human control over any LIVE/real-money transition.

This roadmap does not authorize LIVE trading. Existing safety boundaries remain authoritative: `liveAuthority=NONE`, `productionMutationAllowed=false`, `AI authority=ZERO_AUTHORITY`.

## Repository truth observed at registration

Base: `d2a6c613c2d3542ef3d8f3512868ba431a79ede7`.

The repository already contains substantial foundations: deterministic research/backtest infrastructure, walk-forward experiments, champion/challenger validation, strategy-stage promotion gates, real-market research ingestion, PAPER runtime evidence, safety/architecture gates, and provider-independent investment knowledge governance.

The current real-market research runner is intentionally narrow: `KRW-BTC`, 200 daily candles, a small SMA crossover parameter neighborhood, and a small number of walk-forward windows. This is useful as an integrity smoke test but is not sufficient evidence for a globally competitive autonomous trading system.

## Development priority

Product/UI work remains useful, but investment capability development must be driven by evidence quality first. The canonical development sequence is:

1. **Evaluation truth before strategy complexity**
2. **Broader data before broader models**
3. **Robust out-of-sample selection before PAPER promotion**
4. **Portfolio/risk allocation before LIVE consideration**
5. **Automation of research loops before automation of capital authority**

## Phase 1 — Investment benchmark backbone

Build a deterministic benchmark harness that can compare candidate strategies across:

- multiple KRW markets with minimum liquidity/data-quality gates;
- multiple timeframes;
- rolling and anchored walk-forward windows;
- explicit fees, spread, slippage, turnover and latency assumptions;
- buy-and-hold and cash baselines;
- regime slices such as trend/range and high/low volatility;
- parameter-neighborhood stability;
- bootstrap/confidence diagnostics where statistically appropriate.

Required scorecard metrics include at minimum:

- net return;
- maximum drawdown;
- downside deviation / Sortino-style risk measure;
- volatility-adjusted return / Sharpe-style measure with assumptions recorded;
- profit factor;
- trade count and exposure;
- turnover and trading costs;
- profitable-window ratio;
- benchmark-outperformance ratio;
- cross-market consistency;
- parameter-selection churn;
- tail-loss diagnostics.

No candidate is promoted solely on total return.

## Phase 2 — Strategy laboratory

Introduce governed strategy families behind the same evaluation contract. Priority families:

- trend/momentum;
- mean reversion;
- breakout/volatility expansion;
- volatility targeting;
- regime-gated ensembles;
- cross-sectional ranking where supported by data quality.

Every family must expose immutable parameters, deterministic replay identity, transaction-cost assumptions, and fail-closed behavior for missing/invalid data.

AI may propose candidates and explain evidence, but AI output is not proof and does not directly mutate trading authority.

## Phase 3 — Champion/challenger selection

Extend the existing champion/challenger and stage-promotion mechanisms so promotion requires evidence across independent windows, markets and regimes.

Reject candidates that exhibit:

- single-window dominance;
- unstable parameter selection;
- excessive turnover sensitivity;
- cost fragility;
- insufficient trade count;
- benchmark underperformance across material slices;
- drawdown or tail-risk policy breaches.

Selection policy must prefer robustness and survivability over peak backtest return.

## Phase 4 — Portfolio and capital allocation research

Once multiple independently validated strategies exist, add PAPER-only portfolio construction research:

- per-strategy risk budgets;
- volatility targeting;
- correlation/concentration limits;
- dynamic but bounded capital allocation;
- drawdown de-risking;
- strategy kill/quarantine rules;
- portfolio-level stress testing.

The portfolio allocator must remain independent from any LIVE authority gate.

## Phase 5 — Continuous autonomous research loop

Create a bounded autonomous loop that periodically:

1. snapshots point-in-time market data;
2. generates or enumerates challenger candidates;
3. runs deterministic benchmark suites;
4. rejects invalid/fragile candidates;
5. records reproducible evidence;
6. updates PAPER-only challenger rankings;
7. promotes only through repository-defined evidence gates;
8. reports material regressions and regime drift.

The loop may improve research artifacts automatically, but cannot activate LIVE trading, expand risk envelopes, mutate credentials, or authorize real-money orders.

## Phase 6 — PAPER forward validation

Backtest success is necessary but insufficient. Candidate champions must survive forward PAPER validation with:

- real public-market data;
- real runtime timing;
- realistic execution-cost modeling;
- restart/recovery and idempotency checks;
- comparison between predicted and realized simulated fills;
- drift monitoring between research and runtime behavior.

## Phase 7 — LIVE-readiness evidence only

Only after durable OOS and PAPER evidence exists should NUSA assemble a human-review LIVE-readiness packet. Repository automation must not convert that packet into LIVE authority.

WO-0051 and equivalent human/environment gates remain controlling.

## Near-term execution queue

### P0: Benchmark integrity

- Generalize `scripts/research-real-market-run.js` beyond one market and one fixed 200-day sample.
- Add a canonical machine-readable benchmark result schema.
- Add deterministic benchmark comparison tests.
- Add data-quality and minimum-sample gates.
- Add benchmark baselines and risk-adjusted metrics.

### P1: Robust strategy selection

- Expand strategy-family interface only after P0 metrics are reliable.
- Add regime-sliced and cross-market evidence.
- Bind stage promotion to robustness, not raw return.

### P1: Autonomous research operations

- Add scheduled/offline research orchestration with bounded resource budgets.
- Persist challenger lineage and evaluation evidence.
- Detect performance/regime drift without changing trading authority.

### P2: Product surfaces

- Present champion/challenger evidence, drawdown, robustness, and PAPER forward-validation status in Desktop/Mobile without implying profit guarantees.

## Definition of success

NUSA should be judged by reproducible risk-adjusted evidence, not by marketing claims or isolated backtest peaks. A strategy qualifies as stronger only when it demonstrates superior net-of-cost, out-of-sample, cross-window/cross-regime performance under bounded drawdown and survives forward PAPER validation.

No roadmap phase guarantees profit or economic freedom. The engineering objective is to systematically improve the probability and quality of long-run capital growth while controlling ruin risk.
