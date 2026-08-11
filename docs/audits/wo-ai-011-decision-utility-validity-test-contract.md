# WO-AI-011 Decision Utility / Asymmetric Loss Validity Test Contract

Status: PLANNING-ONLY
Runtime implementation: NOT STARTED / SERIALIZED
Authority: READ-ONLY / ZERO_AUTHORITY

## Objective

Prevent longitudinal held-out evaluation from treating predictive accuracy as equivalent to useful trading decisions when losses, abstention costs, and opportunity costs are asymmetric. Confirmatory decision-utility claims must be bound to a frozen point-in-time utility/loss identity and remain separate from predictive-quality and economic-usefulness claims.

## Immutable decision-utility identity

Before confirmatory outcomes are inspected, freeze and version:

- decision action set, including abstain/no-trade where applicable;
- target horizon and outcome label identity;
- utility/loss function and sign convention;
- false-positive, false-negative, missed-opportunity, abstention, and delayed-decision costs where material;
- decision threshold(s), tie-breaking, and threshold-selection policy;
- benchmark/no-action baseline and opportunity-cost baseline;
- cost/benefit units and normalization identity;
- minimum realized observations and effective sample requirement;
- dependence, censoring, uncertainty, multiple-comparison, and repeated-look policy;
- confirmatory versus exploratory semantics;
- decision labels including PASS, FAIL, EXPLORATORY, and INSUFFICIENT_EVIDENCE.

Changing any material item after outcome inspection creates a new separately versioned evaluation. Prior evidence must remain immutable.

## Separation of evidence classes

Predictive quality, decision utility, and economic usefulness are related but not interchangeable.

- high accuracy/Brier/calibration cannot by itself establish positive decision utility;
- positive decision utility cannot by itself establish positive net economic usefulness after trading costs and path risk;
- favorable economic outcomes cannot retroactively redefine the frozen predictive or utility target;
- all three evidence classes must retain separate identities and provenance.

## Asymmetric loss handling

- false-positive and false-negative losses must not be assumed equal unless the frozen policy explicitly establishes symmetry;
- downside loss, missed opportunity, and abstention/no-trade cost must be represented when material to the declared decision problem;
- unknown material loss terms fail closed rather than defaulting to zero;
- post-hoc reweighting of loss components to turn an unfavorable result favorable is prohibited;
- loss functions derived from future realized outcomes or hindsight-selected regimes are invalid for confirmatory evidence.

## Threshold validity

- decision thresholds must be frozen before confirmatory outcome inspection or selected exclusively inside a preserved training/tuning boundary;
- searching multiple thresholds on final holdout evidence is exploratory or invalid, not confirmatory;
- threshold families are part of the immutable evaluation family and obey multiple-comparison policy;
- threshold changes create a new version and cannot overwrite prior decision evidence;
- a threshold may improve hit rate while worsening utility; both must remain visible.

## Abstention / no-trade semantics

- abstention is a first-class action, not a silently removed sample;
- abstention rate, conditional utility, full-cohort utility, coverage, and unresolved outcomes remain separately reported;
- favorable utility among non-abstained cases cannot establish improvement when coverage materially collapses;
- unknown or post-hoc abstention cost produces `INSUFFICIENT_EVIDENCE` when material;
- abstention policies cannot be tuned on final holdout outcomes and then reported as confirmatory.

## Opportunity-cost validity

- the no-action / benchmark alternative is frozen before outcome inspection;
- missed-opportunity cost cannot use a hindsight-selected benchmark or best-after-the-fact alternative;
- benchmark substitution creates a new separately versioned evaluation;
- synthetic, replay, scenario, or hypothetical opportunity-cost results remain separately labeled and cannot satisfy realized confirmatory evidence.

## Dependence and uncertainty

- decision-utility uncertainty uses the same frozen dependence/effective-sample identity as the primary longitudinal evaluation;
- overlapping horizons, shared events, repeated revisions, correlated assets, portfolio concentration, duplicate/retry/replay records, and clustered stress episodes cannot inflate independent evidence;
- point-estimate utility is insufficient when the frozen uncertainty policy requires interval separation from the acceptance boundary;
- material unknown dependence or unsupported uncertainty assumptions produce `INSUFFICIENT_EVIDENCE`.

## Tail and regime integrity

- ordinary-regime utility cannot hide severe tail-regime downside;
- regime-specific utility requires point-in-time regime labels and frozen subgroup identity;
- hindsight regime selection or threshold retuning after observing losses is exploratory or invalid;
- sparse rare-event utility remains `INSUFFICIENT_EVIDENCE` regardless of favorable ordinary averages.

## Required tests before runtime implementation may be considered complete

1. Predictive-correct-but-negative-decision-utility separation tests.
2. Positive-decision-utility-but-net-economic-negative separation tests.
3. Asymmetric false-positive/false-negative loss identity tests.
4. Unknown material loss-term fail-closed tests.
5. Post-outcome loss reweighting rejection tests.
6. Frozen threshold identity and final-holdout threshold-search rejection tests.
7. Multiple-threshold family correction/labeling tests.
8. Abstention full-cohort accounting and coverage-collapse rejection tests.
9. Unknown/post-hoc abstention-cost `INSUFFICIENT_EVIDENCE` tests.
10. Frozen benchmark/no-action and opportunity-cost anti-cherry-picking tests.
11. Overlapping-horizon/shared-event/revision dependence effective-sample tests.
12. Utility uncertainty and acceptance-boundary tests.
13. Tail/regime utility masking and hindsight-regime rejection tests.
14. Synthetic/replay/hypothetical utility non-substitution tests.
15. Deterministic replay/idempotency tests.
16. Zero-authority/no-mutation regression tests.

## Fail-closed outcomes

Return `INSUFFICIENT_EVIDENCE` when any material condition is unresolved, including:

- unknown material decision loss/cost terms;
- ambiguous action, horizon, label, threshold, benchmark, or utility identity;
- threshold or utility function selected on final confirmatory outcomes without preserved tuning separation;
- effective sample below the frozen minimum;
- material unknown dependence;
- unsupported uncertainty assumptions;
- materially informative censoring/missingness;
- insufficient realized tail/regime observations;
- lineage/version mismatch or corrupted immutable evidence.

## Authority boundary

This contract is evaluation governance only. No decision-utility, threshold, abstention, loss, benchmark, or opportunity-cost result may automatically:

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
