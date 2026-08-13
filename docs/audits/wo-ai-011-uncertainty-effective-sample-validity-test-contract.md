# WO-AI-011 Uncertainty & Effective-Sample Validity Test Contract

Status: planning/audit only. This artifact does not authorize runtime implementation, model/provider mutation, strategy promotion, risk changes, broker mutation, or LIVE execution.

## Objective

Define fail-closed uncertainty and effective-sample semantics for longitudinal held-out evaluation so correlated, weighted, clustered, sparse, or repeatedly inspected observations cannot manufacture false certainty.

## Immutable evaluation identity

Before confirmatory outcome inspection, freeze and version:

- evaluation family, cohort, horizon, regime and metric identity;
- raw observation count policy;
- dependence-group construction and clustering keys;
- effective-sample estimator and assumptions;
- weighting scheme and weight caps/floors when applicable;
- variance/uncertainty estimator;
- confidence/credible interval level and sidedness;
- bootstrap/block-bootstrap/resampling method when applicable;
- minimum raw count and minimum effective-sample thresholds;
- repeated-look/multiple-comparison policy;
- missingness/censoring/coverage treatment;
- deterministic seed or deterministic resampling identity when randomness is required.

Post-outcome edits create a new versioned evaluation and cannot overwrite prior confirmatory evidence.

## Effective-sample rules

Raw row count is never presumed to equal independent information count.

Material dependence must account for, where applicable:

- overlapping prediction/outcome horizons;
- shared timestamps, assets, issuers, sectors, venues or macro events;
- repeated predictions on substantially identical evidence;
- provider/model/prompt/calibration lineage correlation;
- duplicate, retry, replay or replicated records;
- clustered rare events and crisis episodes;
- portfolio cross-sectional dependence;
- weighting concentration and unequal observation weights;
- rolling-window reuse of the same underlying outcomes.

Duplicate/retry/replay observations contribute at most the information allowed by the frozen dependence policy and must never inflate effective sample size merely by replication.

If material dependence exists but cannot be bounded or estimated under the frozen policy, the confirmatory result is `INSUFFICIENT_EVIDENCE`.

## Weighting and concentration

When observations are weighted, report at minimum:

- raw count;
- non-zero weighted count;
- effective sample size under the frozen estimator;
- maximum normalized weight;
- concentration diagnostic sufficient to reveal whether a small number of observations dominate the estimate.

A large raw count with severely concentrated weights cannot satisfy the minimum-evidence gate when effective sample size remains below threshold.

Unstable or unidentified weighting assumptions, material positivity/overlap failure, or post-hoc weight tuning fail closed.

## Uncertainty estimation

Point estimates are insufficient for confirmatory claims when uncertainty is material.

The frozen estimator must be compatible with the declared dependence structure. IID standard errors or IID bootstrap may not be used when the frozen evidence shows material serial, cluster, overlap, or cross-sectional dependence unless equivalence is proven by the contract.

Where applicable, allowed methods may include cluster-robust, block, stationary/bootstrap, hierarchical, or other dependence-aware estimators, but the exact method and assumptions must be frozen and versioned before confirmatory outcome inspection.

Unknown material estimator assumptions produce `INSUFFICIENT_EVIDENCE`, not a favorable interval.

## Small-sample and sparse-cohort behavior

For each confirmatory cohort/regime/tail class:

- both minimum raw count and minimum effective sample size must be satisfied;
- sparse/new cohorts remain `INSUFFICIENT_EVIDENCE`;
- asymptotic approximations cannot silently replace an invalid small-sample method;
- zero-event or near-zero-event cohorts must expose the uncertainty implied by sparse evidence;
- favorable point estimates cannot pass while their frozen uncertainty interval remains materially inconclusive under the acceptance rule.

## Repeated looks and optional stopping

Uncertainty intervals and significance/error guarantees are valid only within the frozen sequential-look/multiple-comparison contract.

Repeated monitoring, early stopping, threshold searching, subgroup searching, breakpoint searching, or repeated recomputation cannot reuse nominal single-look uncertainty as if no selection occurred.

If actual inspection history exceeds the frozen policy, the result becomes `EXPLORATORY` or `INSUFFICIENT_EVIDENCE` according to the immutable policy.

## Determinism and replay

For identical immutable evidence and evaluation identity:

- effective-sample output must be deterministic;
- uncertainty output must be deterministic, including seeded/resampling methods;
- duplicate ingestion must be idempotent;
- replay cannot increase information count;
- ordering changes that should be semantically irrelevant must not change results;
- ordering changes that affect path/dependence semantics must be detected rather than silently normalized away.

## Required outputs

A confirmatory evaluation should expose, where applicable:

- raw sample count;
- effective sample size;
- dependence policy/version;
- weighting policy/version and concentration diagnostics;
- point estimate;
- uncertainty interval/error estimate;
- minimum-evidence thresholds;
- repeated-look/multiple-comparison identity;
- coverage/censoring status;
- result classification: confirmatory, exploratory, or `INSUFFICIENT_EVIDENCE`;
- immutable evidence/provenance references.

## Fail-closed acceptance cases

The evaluator must reject or downgrade confirmatory evidence when any of the following is material:

- raw count is high but effective sample size is below threshold;
- dependence is unknown or inconsistent with the uncertainty estimator;
- duplicate/retry/replay rows inflate information count;
- one or a few weights dominate without satisfying the frozen validity policy;
- minimum raw/effective counts are not met;
- IID uncertainty is applied to materially dependent observations;
- post-hoc estimator, cluster, weight, confidence level, threshold, or stopping-rule selection occurs;
- repeated looks exceed the frozen sequential policy;
- deterministic replay changes effective sample or uncertainty without an identity change;
- required provenance or assumption evidence is missing, stale, contradictory, or corrupt.

## Required tests

1. raw-count versus effective-sample divergence test;
2. duplicate/retry/replay non-inflation test;
3. overlapping-horizon dependence test;
4. shared-event/asset/timestamp cluster dependence test;
5. provider/model/prompt correlated-observation test;
6. concentrated-weight effective-sample test;
7. positivity/overlap and unstable-weight fail-closed test;
8. IID-versus-dependence-aware uncertainty incompatibility test;
9. cluster/block resampling deterministic replay test;
10. minimum raw-count gate test;
11. minimum effective-sample gate test;
12. sparse/new-regime `INSUFFICIENT_EVIDENCE` test;
13. repeated-look/optional-stopping uncertainty invalidation test;
14. post-hoc uncertainty-estimator substitution rejection test;
15. confidence-level/sidedness identity immutability test;
16. deterministic seeded-resampling identity test;
17. missing/corrupt dependence provenance fail-closed test;
18. zero-authority/no-mutation regression test.

## Safety invariants

- PAPER/read-only semantics remain unchanged.
- `liveAuthority=NONE`.
- `productionMutationAllowed=false`.
- AI authority remains `ZERO_AUTHORITY`.
- This evidence cannot satisfy WO-0051, Issue #349, or PR #371 human/environment requirements.
- No result from this contract can change provider/model/prompt/strategy/risk/LIVE authority by itself.
