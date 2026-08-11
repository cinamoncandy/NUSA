# WO-AI-011 Statistical Validity Test Contract

Status: planning-only. This document defines read-only evaluation requirements and does not start runtime implementation.

## Purpose

Longitudinal held-out evaluation must not promote a result merely because one provider, model, prompt, calibration version, regime slice, threshold, horizon, benchmark, or metric looks favorable after repeated inspection. Statistical uncertainty and selection history are part of the evidence identity.

## Fail-closed requirements

1. Every reported comparison binds an immutable evaluation-family identity describing all candidate providers/models/prompts/calibration versions/regimes/horizons/thresholds/benchmarks/metrics inspected for that decision.
2. Post-hoc expansion, deletion, or relabeling of the comparison family cannot overwrite an existing result; it creates a new versioned evaluation.
3. Repeated looks at accumulating outcomes require a frozen sequential-analysis/stopping policy. Optional stopping without such a policy invalidates confirmatory claims.
4. Correlated observations cannot be counted as independent merely because they are separate predictions. Shared timestamps, assets, events, evidence digests, prompts, providers, regimes, or overlapping outcome windows must be represented in dependence-group identity.
5. Effective sample size or uncertainty estimation must reflect declared dependence structure. If dependence cannot be estimated or bounded for a material claim, status is INSUFFICIENT_EVIDENCE.
6. Confidence/uncertainty intervals and any significance/error-control claims must name the estimator, resampling/blocking method when used, confidence level, comparison family, and correction/sequential policy identity.
7. Multiple-comparison control must be frozen before outcome inspection for confirmatory claims. Exploratory results remain explicitly EXPLORATORY and cannot satisfy confirmatory acceptance gates.
8. Model/prompt/provider/regime selection performed on evaluation outcomes cannot be evaluated on the same observations as if selection had not occurred. Selection and final assessment require preserved separation or nested/walk-forward treatment.
9. Hyperparameter/threshold/horizon tuning counts as selection even when no model weights change.
10. Missing, duplicated, retried, replayed, or highly correlated samples cannot inflate sample counts or precision.
11. Regime-level and subgroup claims require predeclared identity or are labeled exploratory. Small subgroup wins cannot replace aggregate evidence.
12. Economic-usefulness significance/uncertainty must use the same frozen gross-to-net and benchmark identities as the primary economic result; post-hoc cost or benchmark changes create a new evaluation.
13. Statistical evidence remains advisory/read-only. It cannot mutate providers, prompts, strategy promotion, position sizing, risk limits, broker state, kill switches, or LIVE authority.

## Required focused tests

- comparison-family identity immutability
- post-hoc candidate deletion/addition creates new evaluation identity
- optional-stopping rejection without frozen sequential policy
- repeated-look/sequential-policy deterministic replay
- overlapping-horizon and shared-event dependence grouping
- duplicate/retry/replay non-inflation of effective sample count
- provider/model/prompt correlated-independence rejection
- predeclared confirmatory vs post-hoc exploratory labeling
- tuning/selection sample reuse rejection
- nested or walk-forward selection/final-assessment separation
- multiple-comparison correction identity and deterministic reproduction
- dependence-aware interval/uncertainty identity
- unknown material dependence -> INSUFFICIENT_EVIDENCE
- subgroup/regime cherry-picking rejection
- economic benchmark/cost identity consistency under uncertainty analysis
- zero-authority/no-mutation regression

## Safety boundary

WO-0051 remains HUMAN_ENVIRONMENT_ONLY. PAPER/read-only only. `liveAuthority=NONE`. `productionMutationAllowed=false`. AI remains `ZERO_AUTHORITY`. No CI, synthetic, replay, chat, or planning artifact satisfies physical Android or human/environment evidence.
