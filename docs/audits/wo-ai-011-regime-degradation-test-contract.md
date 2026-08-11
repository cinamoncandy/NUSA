# WO-AI-011 Regime Degradation / Non-Stationarity Test Contract

Status: PLANNING-ONLY
Authority: ZERO_AUTHORITY
Runtime implementation: NOT STARTED / SERIALIZED

## Purpose

Define fail-closed longitudinal degradation semantics for resolved AI trading predictions without granting any execution, strategy-promotion, provider/model/prompt mutation, sizing, risk, kill-switch, or LIVE authority.

## Frozen monitoring identity

Every confirmatory degradation claim MUST bind an immutable monitoring identity before observing the evaluation outcomes. The identity includes:

- provider, model, prompt, schema, calibration, and prediction-version identities;
- target/outcome horizon and point-in-time data-vintage identity;
- regime-label definition and effective-time version;
- metric set and directionality;
- reference/baseline cohort;
- rolling or expanding window definition;
- minimum realized sample requirement;
- monitoring cadence and permitted looks;
- degradation threshold and recovery threshold;
- dependence/multiple-look correction policy;
- missingness and coverage policy.

Changing any of these after observing outcomes creates a NEW exploratory evaluation. It MUST NOT overwrite the original result.

## Distinguish degradation causes

A model-quality degradation claim MUST NOT silently absorb other causes. Evaluation evidence MUST separately attribute or explicitly mark unresolved:

1. predictive accuracy / Brier / calibration / faithfulness degradation;
2. covariate or feature-distribution shift;
3. target/label or realized-outcome shift;
4. data-availability, missingness, latency, or coverage shift;
5. universe-composition or survivorship change;
6. provider/model/prompt/schema/calibration version change;
7. economic-cost or benchmark regime change.

If material attribution cannot be resolved, the result is `INSUFFICIENT_EVIDENCE`, not confirmed model degradation.

## Point-in-time regime identity

Regime labels MUST use only information available under the frozen causal-availability clocks. Hindsight regime relabeling, future realized volatility labels, revised macro classifications, or post-outcome clustering cannot support a confirmatory degradation claim unless separately versioned and explicitly exploratory.

Sparse or newly emerging regimes that do not satisfy the frozen minimum realized sample and observation-window requirements MUST remain `INSUFFICIENT_EVIDENCE`.

## Repeated monitoring and change-point controls

Rolling dashboards, repeated degradation checks, sequential looks, and change-point searches are part of the same immutable evaluation family when they inspect the same hypothesis surface. They MUST obey the frozen repeated-look / multiple-comparison policy from the WO-AI-011 statistical-validity contract.

A degradation alert MUST NOT be made confirmatory merely by trying multiple windows, thresholds, break dates, metrics, regimes, or subgroups and selecting the strongest result after the fact.

## Coverage and missingness shift

Evaluation MUST record expected vs observed prediction coverage, outcome-resolution coverage, abstention rate, unresolved outcome rate, and missing causal evidence by version/regime/window.

A performance improvement caused by silently dropping hard cases is invalid. Material changes in coverage or missingness require either like-for-like cohort comparison or `INSUFFICIENT_EVIDENCE`.

## Degradation and recovery semantics

- `DEGRADATION_SIGNAL`: frozen threshold crossed with sufficient realized evidence under the declared statistical policy.
- `INSUFFICIENT_EVIDENCE`: minimum sample/window, dependence, coverage, causal attribution, or lineage requirements are not satisfied.
- `NO_CONFIRMED_DEGRADATION`: evidence is sufficient and the frozen threshold is not crossed.
- `RECOVERY_SIGNAL`: a separately frozen recovery criterion is satisfied with sufficient subsequent realized evidence.

Recovery MUST NOT erase prior degradation evidence. Both remain immutable longitudinal records.

## Zero-authority boundary

No degradation or recovery status can automatically:

- replace or promote a provider/model/prompt;
- tune calibration;
- promote/demote a strategy;
- alter position sizing, exposure, leverage, or risk limits;
- release HALT or kill-switch state;
- place/cancel broker orders or transfer funds;
- authorize LIVE or production mutation.

Outputs are PAPER/read-only advisory evidence only. `liveAuthority=NONE`, `productionMutationAllowed=false`, and AI `ZERO_AUTHORITY` remain unchanged.

## Required tests for later implementation

- frozen monitoring-window/cadence identity tests;
- post-hoc window/threshold/break-date selection rejection tests;
- repeated-look/change-point multiple-testing tests;
- point-in-time regime-label future-leakage tests;
- sparse/new-regime `INSUFFICIENT_EVIDENCE` tests;
- coverage/missingness shift and hard-case-drop rejection tests;
- covariate/label/data-quality/model-version attribution-separation tests;
- duplicate/retry/replay effective-sample non-inflation tests;
- immutable degradation/recovery history tests;
- zero-authority and no-mutation regression tests.

## Human/environment serialization

This planning artifact does not satisfy or bypass Issue #349 / PR #371 physical Android acceptance, actual external read-only preflight, human activation ceremony, constitutional LIVE decision, or any other `HUMAN_ENVIRONMENT_ONLY` evidence requirement.