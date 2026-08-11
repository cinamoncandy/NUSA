# WO-AI-011 Economic Usefulness Test Contract

Status: PLANNING-ONLY

This contract defines fail-closed economic evaluation semantics for WO-AI-011 without implementing runtime behavior or granting any execution authority.

## Principle

Predictive quality and economic usefulness are separate outputs. A model may be statistically accurate while economically useless after realistic implementation costs. Neither output authorizes strategy promotion, position sizing, order placement, broker mutation, LIVE activation, or production mutation.

## Required frozen identities

Every economic evaluation slice must bind to immutable identities for:

- prediction cohort and temporal holdout/walk-forward partition
- realized outcome window
- instrument/universe membership as known at prediction time
- benchmark and opportunity-cost baseline
- fee schedule
- spread model
- slippage model
- market-impact or capacity assumption when material
- turnover calculation policy
- financing/borrow/funding/carry assumptions when material
- tax treatment only when explicitly modeled; otherwise marked OUT_OF_SCOPE
- drawdown and path-dependent risk measurement policy
- currency/base-currency and FX conversion policy
- cost-model version and effective time

Missing, ambiguous, retroactively substituted, or future-informed identities must fail closed as `INSUFFICIENT_EVIDENCE` or `INVALID_EVALUATION`, never be silently imputed.

## Net-benefit decomposition

When sufficient realized evidence exists, report components separately before any aggregate net-benefit figure:

1. gross realized benefit versus the frozen baseline
2. explicit fees and commissions
3. bid/ask spread cost
4. slippage and implementation shortfall
5. turnover-dependent cost
6. financing, borrow, funding, carry, and FX cost when applicable
7. capacity/market-impact adjustment when evidence supports it
8. opportunity cost versus the frozen benchmark or cash/risk-free baseline
9. realized drawdown and path-risk metrics
10. resulting net benefit

Do not combine missing cost terms into zero. Unknown material costs invalidate a net-benefit claim.

## Baseline discipline

Economic usefulness must be compared against at least one declared frozen baseline appropriate to the prediction target. Baselines cannot be selected after observing outcomes. Benchmark switching, cherry-picking, or best-of-many post-hoc baseline selection is prohibited.

Where multiple predeclared baselines exist, results must be reported separately and the selection rule must be frozen before the evaluation window closes.

## Turnover and path dependence

Return-like metrics must preserve order and timestamps needed to measure turnover, implementation timing, drawdown, and exposure path. Shuffling observations may be valid for some predictive statistics but cannot satisfy path-dependent economic evidence.

Repeated replay or duplicate prediction records must not increase sample count, reduce apparent turnover, or double-count PnL/benefit.

## Cost-model temporal integrity

A cost model may use only parameters that were available or deliberately frozen for the evaluated period. Later fee schedules, revised spread estimates, ex-post liquidity classifications, or hindsight-selected slippage parameters cannot replace the bound model without creating a new versioned evaluation.

Sensitivity analysis is allowed only as separately labeled advisory evidence. It cannot overwrite the primary frozen-cost result.

## Evidence sufficiency

Economic usefulness must be `INSUFFICIENT_EVIDENCE` when any material condition is unresolved, including:

- too few realized observations
- observation window too short for declared horizon or regime claim
- unresolved prediction-to-outcome lineage
- synthetic/replay/hypothetical outcomes presented as realized evidence
- missing benchmark or cost-model identity
- unknown material fee/spread/slippage/turnover/financing assumptions
- missing timestamps required for path-dependent metrics
- survivorship or point-in-time universe ambiguity
- cost or baseline data that became available only after prediction/evaluation cutoff

## Required metrics

When evidence permits, report at minimum:

- gross benefit versus baseline
- net benefit versus baseline
- average and total fees/costs by component
- turnover
- implementation shortfall/slippage
- maximum drawdown or declared path-risk metric
- hit/accuracy metrics separately from economic metrics
- sample count and realized observation span
- version/cohort/regime identity
- abstention/insufficient-evidence rate

No single economic metric may stand in for predictive quality, calibration, faithfulness, or safety.

## Adversarial test cases

The implementation phase, when serialization permits it, must reject or flag at least these cases:

- zero-filled unknown slippage or spread
- fee schedule replaced with a later cheaper schedule
- ex-post selection of the best benchmark
- future liquidity bucket used for historical cost estimation
- duplicate replay counted twice in PnL or sample count
- shuffled observations used to claim drawdown or turnover
- synthetic outcomes mixed with realized PnL
- prediction correct in direction but net-negative after costs
- gross-positive strategy made net-positive only by omitting opportunity cost
- cost-model version changed without a new evaluation identity
- insufficient realized history labeled economically useful

## Authority boundary

All outputs are immutable/read-only advisory evidence.

- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- AI authority remains `ZERO_AUTHORITY`
- no strategy promotion, sizing/risk mutation, broker order/cancel, withdrawal/transfer, kill-switch release, or LIVE activation
- WO-0051 remains `HUMAN_ENVIRONMENT_ONLY`
- Issue #349 / PR #371 physical Android acceptance cannot be satisfied by this contract, CI, or chat
