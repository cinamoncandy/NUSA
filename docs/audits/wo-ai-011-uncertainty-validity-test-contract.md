# WO-AI-011 Uncertainty Validity Test Contract

Status: PLANNING-ONLY
Runtime implementation: NOT STARTED / SERIALIZED
Authority: READ-ONLY / ZERO_AUTHORITY

## Objective

Prevent longitudinal held-out evaluation from presenting unstable point estimates as reliable evidence. Every confirmatory predictive, calibration, degradation, tail-risk, portfolio, coverage, and economic-usefulness claim must carry uncertainty semantics that respect temporal dependence, clustering, censoring, finite realized sample size, and the frozen evaluation identity.

## Immutable evaluation identity

Before confirmatory outcomes are inspected, freeze and version:

- metric family and estimand;
- confidence/credible interval method and nominal level;
- one-sided versus two-sided semantics;
- dependence groups and cluster/block identity;
- effective-sample-size method;
- block length, bootstrap scheme, resampling seed policy, or analytic variance method where applicable;
- minimum realized observations and minimum effective sample size;
- censoring/missingness treatment and weighting identity;
- repeated-look and multiple-comparison policy;
- subgroup/regime/tail/portfolio aggregation identity;
- decision labels including PASS, FAIL, EXPLORATORY, and INSUFFICIENT_EVIDENCE.

Changing any material item after outcome inspection creates a new separately versioned evaluation. It must never overwrite prior evidence.

## Dependence-aware uncertainty

Raw observation count is not sufficient evidence of precision.

- overlapping horizons, shared timestamps, shared assets, common events, correlated portfolios, repeated provider/model outputs, duplicate/retry/replay records, and clustered stress episodes must not be treated as independent observations;
- effective sample size must never exceed the frozen eligible realized sample count;
- material unknown dependence fails closed as `INSUFFICIENT_EVIDENCE` rather than assuming independence;
- IID standard errors or IID bootstrap are prohibited when the frozen dependence policy says dependence is material;
- cluster/block/bootstrap identities are immutable and replayable.

## Interval validity

For every confirmatory metric that supports an improvement, degradation, tail-risk, or economic claim:

- report the point estimate and its uncertainty interval together;
- disclose realized sample count and effective sample size;
- distinguish interval width from model calibration confidence;
- prohibit favorable claim labels when the frozen acceptance boundary is not separated from the uncertainty interval as required by policy;
- prohibit zero-width or degenerate intervals caused by duplicated/replayed samples;
- deterministic replay with identical immutable evidence must reproduce the same interval result.

When finite-sample validity is not supportable, the output must be `INSUFFICIENT_EVIDENCE` or explicitly `EXPLORATORY`.

## Calibration uncertainty

Calibration curves and summary calibration errors must not hide sparse bins or adaptive binning bias.

- binning or smoothing identity is frozen before confirmatory inspection;
- sparse bins expose counts/effective counts and uncertainty;
- post-hoc bin merging/splitting cannot improve a confirmatory result;
- ECE-style scalar summaries cannot replace bin-level uncertainty diagnostics when material;
- unresolved/censored outcomes remain governed by the frozen cohort and denominator policy.

## Degradation and recovery uncertainty

- degradation is not established by point-estimate crossing alone when the frozen monitoring policy requires uncertainty-aware evidence;
- recovery requires new subsequent realized evidence and cannot merely result from a wider/narrower post-hoc window;
- repeated monitoring obeys the frozen sequential-look/multiple-comparison policy;
- uncertainty method changes cannot erase prior degradation evidence.

## Tail-risk uncertainty

Rare-event metrics require stricter evidence handling.

- clustered crash/stress observations use dependence-adjusted effective counts;
- worst-k, conditional tail loss, downside calibration, abstention, and stress coverage report realized event count and effective event count;
- synthetic/replay/scenario stress events cannot increase realized effective sample size;
- sparse tail evidence remains `INSUFFICIENT_EVIDENCE` regardless of favorable ordinary-regime averages.

## Portfolio and concentration uncertainty

- correlated positions/factors/assets cannot be counted as independent evidence;
- uncertainty must preserve common-factor, concentration, and shared-event dependence defined by the frozen portfolio evaluation identity;
- diversification claims require evidence that survives dependence-aware uncertainty;
- portfolio aggregation cannot silently narrow uncertainty through duplicated or highly correlated components.

## Economic usefulness uncertainty

Predictive quality and economic usefulness remain separate.

- net-benefit uncertainty must preserve the frozen benchmark and cost model;
- uncertainty in material costs such as spread, slippage, market impact, financing/borrow/funding/carry, FX, and opportunity cost must not silently collapse to zero;
- path-dependent turnover/drawdown/PnL uncertainty requires ordered timestamped realized evidence;
- sensitivity/scenario analysis is separately labeled and cannot replace the primary frozen realized evaluation;
- a positive point estimate with insufficient uncertainty separation cannot become a favorable confirmatory economic claim.

## Censoring and missingness

- censoring-aware uncertainty uses the same immutable cohort/denominator policy as the primary evaluation;
- weighting/estimator uncertainty must reflect material positivity/overlap limitations where applicable;
- unknown materially informative missingness fails closed;
- complete-case uncertainty cannot substitute for full-cohort confirmatory evidence when coverage loss is material.

## Required tests before runtime implementation may be considered complete

1. IID-vs-clustered dependence rejection tests.
2. Overlapping-horizon effective-sample non-inflation tests.
3. Duplicate/retry/replay interval-width non-inflation tests.
4. Frozen confidence-level and interval-method identity tests.
5. Post-outcome interval-method substitution rejection tests.
6. Small effective-sample `INSUFFICIENT_EVIDENCE` tests.
7. Calibration sparse-bin and post-hoc rebinning rejection tests.
8. Degradation/recovery uncertainty and repeated-look tests.
9. Tail-event clustered effective-count tests.
10. Portfolio common-factor/concentration uncertainty tests.
11. Economic net-benefit uncertainty with material cost uncertainty tests.
12. Censoring/weighting uncertainty and positivity/overlap failure tests.
13. Deterministic replay/idempotency tests.
14. Zero-authority/no-mutation regression tests.

## Fail-closed outcomes

Return `INSUFFICIENT_EVIDENCE` when any material condition is unresolved, including:

- effective sample size below the frozen minimum;
- unknown material dependence;
- unsupported interval assumptions;
- ambiguous cohort/denominator identity;
- materially informative unresolved censoring/missingness;
- insufficient realized tail events;
- materially uncertain economic cost components without a frozen valid treatment;
- lineage/version mismatch or corrupted immutable evidence.

## Authority boundary

This contract is evaluation governance only. No uncertainty, confidence, degradation, recovery, tail-risk, portfolio, or economic-usefulness result may automatically:

- change provider/model/prompt;
- promote a strategy;
- alter sizing or risk limits;
- release HALT or kill-switch state;
- authorize broker order/cancel/withdraw/transfer;
- authorize LIVE execution;
- satisfy WO-0051 human/environment evidence;
- satisfy Issue #349 / PR #371 physical Android acceptance.

Required invariant boundaries remain:

- PAPER/read-only only;
- `liveAuthority=NONE`;
- `productionMutationAllowed=false`;
- AI `ZERO_AUTHORITY`;
- WO-0051 `HUMAN_ENVIRONMENT_ONLY`.
