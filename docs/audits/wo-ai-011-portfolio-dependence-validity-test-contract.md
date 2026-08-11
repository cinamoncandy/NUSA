# WO-AI-011 Portfolio Dependence / Concentration Validity Contract

Status: PLANNING / AUDIT ONLY

Authority: READ-ONLY / PAPER ONLY / AI ZERO_AUTHORITY

This contract defines fail-closed portfolio-level evaluation semantics for WO-AI-011. It does not implement runtime evaluation, change strategy/risk settings, connect execution transport, or satisfy any human/environment gate.

## Why this gate exists

A collection of individually useful predictions can produce a misleading portfolio result when observations or exposures share assets, timestamps, sectors, factors, evidence, regimes, providers, liquidity conditions, or market events. Per-signal accuracy or standalone economic usefulness must not be promoted into a portfolio-quality claim without dependence-aware aggregation.

## Frozen identity

Before confirmatory outcome inspection, a portfolio evaluation must bind an immutable identity containing at least:

- evaluation family and version;
- portfolio/universe membership and effective-time rules;
- prediction and realized-outcome lineage;
- position/exposure mapping used only for evaluation semantics;
- netting and aggregation rules;
- asset, sector, industry, geography, currency, venue and declared factor taxonomy where material;
- dependence/correlation grouping and estimation policy;
- concentration metrics and thresholds;
- liquidity/capacity bucket identity;
- benchmark and opportunity-cost baseline;
- cost-model version;
- rebalance/observation cadence and horizon;
- minimum effective sample requirements;
- missingness/coverage and abstention policy.

Post-hoc edits create a new evaluation identity and cannot overwrite the original result.

## Required separation

The evaluator must report separately:

1. standalone predictive quality;
2. standalone net economic usefulness;
3. portfolio incremental usefulness after existing exposure/netting;
4. concentration and common-factor exposure;
5. dependence-adjusted uncertainty/effective sample size;
6. portfolio turnover, path risk and drawdown evidence;
7. liquidity/capacity sensitivity where material.

A favorable standalone result cannot substitute for a favorable portfolio result.

## Dependence and diversification

- Correlated predictions or positions cannot be counted as independent diversification.
- Shared timestamps, assets, sectors, factors, events, evidence, providers, regimes, or liquidity shocks must be represented by declared dependence groups where material.
- Unknown material dependence fails closed as `INSUFFICIENT_EVIDENCE` rather than assuming independence.
- A correlation estimate derived from future data, revised data, or a hindsight-selected window is invalid for confirmatory evaluation.
- Diversification claims require point-in-time membership and dependence evidence from the permitted evaluation window.

## Concentration and hidden exposure

The evaluation must detect and separately report material concentration caused by:

- duplicate or near-duplicate assets/signals;
- sector/industry/geography/currency concentration;
- shared beta or declared common-factor exposure;
- directionally aligned positions whose nominal asset count hides common risk;
- concentrated liquidity or venue exposure;
- correlated tail-event exposure.

Missing material exposure mapping yields `INSUFFICIENT_EVIDENCE`; it must not be silently treated as zero exposure.

## Netting and incremental value

Portfolio usefulness must use a frozen netting policy. Opposing or redundant signals must not both receive gross standalone credit when their portfolio contribution nets out or duplicates an existing exposure.

Incremental-value claims must distinguish:

- value versus cash/no-action;
- value versus the frozen benchmark;
- value versus the existing portfolio exposure before the evaluated signal;
- gross contribution versus marginal transaction/carry/impact costs.

## Path and capacity evidence

Any claim involving portfolio turnover, drawdown, exposure path, capacity or market impact requires ordered timestamped evidence. Shuffled, duplicated, replay-only, synthetic, scenario or hypothetical observations cannot satisfy realized portfolio acceptance criteria.

Capacity/liquidity assumptions must be versioned and point-in-time. Unknown material capacity or impact terms fail closed rather than defaulting to unlimited capacity or zero impact.

## Tail-risk interaction

Ordinary-period diversification cannot mask dependence collapse during realized stress. Tail-event dependence, correlation spikes, concentration, coverage loss and stress abstention must remain separately visible under the existing tail-risk contract.

Synthetic stress may supplement analysis but cannot substitute for realized portfolio tail evidence.

## Acceptance semantics

A confirmatory portfolio-quality claim is valid only when:

- frozen portfolio/dependence/concentration identities are complete;
- point-in-time membership and exposure provenance are intact;
- dependence-adjusted effective samples satisfy frozen minimums;
- material concentration and common-factor exposures are measured or explicitly unavailable;
- incremental value remains distinguishable from standalone value;
- realized path/cost/capacity evidence is sufficient for the claimed metric;
- missing material inputs do not improve the result through omission;
- statistical, regime, economic-usefulness and tail-risk contracts remain satisfied.

Otherwise the status is `INSUFFICIENT_EVIDENCE`, `EXPLORATORY`, or `INVALID` as appropriate.

## Required regression tests for a future implementation

- correlated-signal diversification non-inflation;
- duplicate/near-duplicate signal exposure detection;
- shared-factor/sector concentration aggregation;
- unknown-dependence fail-closed behavior;
- point-in-time correlation-window future-leakage rejection;
- frozen portfolio membership and post-hoc membership-edit rejection;
- existing-exposure netting and incremental-value separation;
- opposing-signal gross-credit rejection;
- missing exposure mapping cannot default to zero;
- dependence-adjusted effective-sample tests;
- timestamp-ordered portfolio turnover/drawdown evidence tests;
- capacity/liquidity unknown-term fail-closed tests;
- ordinary-diversification masking of realized tail correlation-spike rejection;
- synthetic/replay portfolio evidence non-substitution;
- deterministic replay and duplicate idempotency;
- zero-authority / no-mutation regression tests.

## Authority boundary

No result produced under this contract may automatically change or authorize provider/model/prompt selection, strategy promotion, position sizing, portfolio weights, risk limits, kill-switch state, broker orders, transfers, credentials, production mutation, or LIVE execution.

`liveAuthority=NONE`

`productionMutationAllowed=false`

AI authority remains `ZERO_AUTHORITY`.

WO-0051 remains `HUMAN_ENVIRONMENT_ONLY`; physical Android and human/environment evidence cannot be satisfied by this artifact, CI, synthetic tests, or chat.