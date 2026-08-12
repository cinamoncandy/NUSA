# WO-AI-011 Censoring / Selection Validity Test Contract

Status: PLANNING-ONLY
Authority: READ-ONLY / PAPER
AI authority: ZERO_AUTHORITY
Runtime implementation: NOT STARTED / SERIALIZED

## Problem

Longitudinal evaluation can look artificially strong when difficult, unresolved, delisted, stale, unavailable, abstained, or otherwise inconvenient predictions disappear from the evaluated denominator. Missing outcomes are not automatically benign. The evaluation must preserve the prediction-time eligible cohort and distinguish observed, unresolved, censored, excluded, invalid, and abstained records without allowing post-outcome denominator edits.

## Frozen identities

Before confirmatory outcome inspection, bind an immutable identity for:

- prediction-time eligible cohort and inclusion/exclusion rules;
- outcome-resolution window and censoring deadline;
- required outcome source(s), fallback order, and availability semantics;
- abstention, invalidation, delisting, merger, bankruptcy, symbol-change, stale-data, missing-provider, and unavailable-market handling;
- missingness categories and reason codes;
- denominator policy for every reported metric;
- effective-sample and coverage thresholds;
- any censoring-aware estimator, weighting rule, or sensitivity analysis.

Changing any of these after outcomes are known creates a separately versioned exploratory evaluation and cannot overwrite the frozen confirmatory result.

## Fail-closed rules

1. Every prediction-time eligible record remains represented in cohort accounting even when its realized outcome is missing or unresolved.
2. Records may not be silently dropped because they are hard to resolve, economically adverse, delisted, bankrupt, stale, extreme, abstained, or provider-incomplete.
3. Missingness is classified with immutable reason codes and timestamped provenance. Unknown material missingness is not treated as random.
4. Outcome availability that depends on future performance, survival, liquidity, provider coverage, or model behavior is treated as potentially informative censoring.
5. Complete-case metrics may be reported only as explicitly labeled diagnostics and cannot substitute for full-cohort confirmatory evidence when missingness is material.
6. Coverage, unresolved rate, censoring rate, abstention rate, and exclusion rate are first-class outputs beside predictive metrics.
7. A favorable metric with deteriorating coverage or increased unresolved/censored share cannot be promoted as model improvement without sufficient evidence that denominator shift is immaterial.
8. Post-outcome reclassification from unresolved/censored to excluded is prohibited unless the frozen policy required that classification from prediction-time facts.
9. Duplicate, retry, replay, or re-resolution events cannot create additional effective samples or erase prior unresolved/censored history.
10. If a censoring-aware estimator or weighting scheme is used, its model, variables, version, assumptions, positivity/overlap requirements, and diagnostics are frozen and separately reported. Failure of those assumptions produces INSUFFICIENT_EVIDENCE.
11. Sensitivity analyses for plausible missing-not-at-random mechanisms remain separately labeled and cannot overwrite the primary frozen result.
12. Synthetic, replay, scenario, imputed, or hypothetical outcomes cannot satisfy realized-outcome coverage requirements.

## Required metrics / evidence

At minimum, preserve and report by provider/model/prompt/calibration/version/regime/horizon where applicable:

- eligible cohort count;
- observed resolved count;
- unresolved count;
- censored count;
- excluded-invalid count with immutable reasons;
- abstained count;
- realized coverage ratio;
- outcome-resolution latency distribution;
- missingness/censoring reason distribution;
- effective sample count after dependence handling;
- predictive metrics on observed outcomes, clearly labeled with denominator;
- full-cohort status: SUFFICIENT_EVIDENCE or INSUFFICIENT_EVIDENCE.

## Required tests

- prediction-time eligible cohort immutability;
- silent hard-case drop rejection;
- delisting/bankruptcy/merger/symbol-change denominator preservation;
- unresolved-to-excluded post-hoc reclassification rejection;
- outcome-window expiry and censoring reason integrity;
- missingness reason provenance and unknown-reason fail-closed behavior;
- complete-case favorable-metric / falling-coverage rejection;
- informative-censoring detection and INSUFFICIENT_EVIDENCE behavior;
- censoring-aware estimator identity/assumption/version tests when used;
- weighting positivity/overlap failure tests when used;
- MNAR sensitivity analysis non-overwrite tests;
- duplicate/retry/replay non-inflation tests;
- imputed/synthetic/hypothetical outcome non-substitution tests;
- deterministic replay and immutable cohort-accounting tests;
- zero-authority and no-mutation regressions.

## Authority boundary

This contract only governs read-only evaluation evidence. No censoring, coverage, or selection-validity result can mutate provider/model/prompt, promote a strategy, change position sizing or risk, authorize broker order/cancel/transfer/withdrawal, release HALT/kill-switch state, grant LIVE authority, or satisfy WO-0051 / Issue #349 / PR #371 human-environment evidence.
