# ADR-0007: Outcome-Linked AI Calibration

Status: Accepted for implementation

## Decision

NUSA will add a deterministic, outcome-linked calibration layer for zero-authority AI analysis. Model self-reported confidence is not trusted by default. A confidence value becomes eligible for calibrated read-only display only after it is bound to an immutable prediction identity, resolved against a verified outcome definition, and supported by sufficient observations for the exact provider/model/prompt/outcome cohort.

This calibration layer remains analytical only. It cannot authorize orders, transfers, production mutation, LIVE execution, risk changes, kill-switch release, strategy promotion, or model-weight changes.

## Fresh post-WO-AI-003 audit

The repository has grounded evidence, prompt/replay binding, a bounded asynchronous read-only runtime, an explicitly opt-in real provider challenger, and a product AI command center that now labels current model score as uncalibrated. The weakest safe dimension is calibration/outcome linkage:

- current read-only AI confidence is not outcome-verified;
- calibration status remains unknown/insufficient until real resolved observations exist;
- there is no immutable prediction-to-outcome ledger for actual AI challenger observations;
- there is no reliability-bucket, Brier-score, or cohort-level calibration projection in the AI runtime;
- UI truthfulness already distinguishes an uncalibrated model score from verified probability, so the next safe step is to build the evidence layer behind that distinction.

Therefore calibration/outcome linkage is selected before provider weighting, Champion promotion, strategy mutation, or any further provider-derived influence.

## Prediction identity

Every calibratable prediction must bind at minimum:

- prediction ID;
- orchestration run ID and decision/proposal identity;
- agent ID and role;
- provider ID and model version ID;
- prompt artifact ID/version/digest;
- outcome-definition ID and horizon;
- raw probability in `[0,1]`;
- prediction timestamp;
- immutable content hash.

A prediction may be recorded only from a schema-valid completed zero-authority AI run. Replays with the same identity must be idempotent; conflicting duplicates fail closed.

## Outcome identity

Every resolved outcome must bind to the exact prediction and outcome-definition ID. A resolution records:

- prediction ID;
- outcome-definition ID/version;
- boolean event result or explicitly defined binary scoring result;
- resolution timestamp after the prediction/horizon rules permit resolution;
- verified source/evidence references;
- immutable content hash.

Missing, stale, synthetic-as-real, mismatched, prematurely resolved, or conflicting outcomes are rejected. Test fixtures may exercise the engine but can never be represented as actual runtime calibration evidence.

## Calibration metrics

For each exact cohort the engine computes deterministic read-only metrics:

- sample count;
- fixed reliability buckets with predicted mean, observed rate, count, and absolute gap;
- true weighted Expected Calibration Error (ECE): sum of bucket absolute gap multiplied by bucket frequency;
- Brier score: mean squared probabilistic error;
- conservative status determined by sample sufficiency and configured error limits.

Cohorts are stratified by provider/model/prompt/outcome definition so one model or prompt version cannot borrow calibration from another.

## Conservative confidence policy

Raw model probability and calibrated confidence are distinct concepts.

- raw probability may be displayed as an untrusted model self-estimate;
- before the minimum verified sample threshold, status is `INSUFFICIENT_DATA` and trusted/calibrated confidence remains unavailable or zero;
- an unhealthy/degraded calibration cohort cannot increase confidence;
- no cohort can use another provider/model/prompt/outcome definition as a substitute;
- calibration never changes deterministic governance, risk limits, PAPER orders/fills, or LIVE authority.

## Read-only projection

The AI projection may expose non-sensitive calibration metadata such as raw probability, calibrated probability when eligible, sample count, ECE, Brier score, cohort identity/version, and status. Unknown/insufficient data must be explicit rather than converted into false certainty.

## Authority invariants

Unchanged hard invariants:

- `liveAuthority=NONE`
- `realOrderAuthority=false`
- `realTransferAuthority=false`
- `productionMutationAllowed=false`

Deterministic governance, Risk Governor, P0 state, HALT, kill switch, PAPER execution, and WO-0051 human/environment gates remain authoritative.

## Exclusions

WO-AI-004 does not authorize:

- automatic provider/model ranking changes;
- automatic model-weight changes;
- automatic Champion promotion;
- strategy deployment or mutation;
- risk-limit changes;
- LIVE execution or real-money use;
- synthetic outcomes presented as real evidence;
- use of hidden chain-of-thought as calibration evidence.

## Verification

The implementation must prove deterministic metric calculations and fail-closed behavior for invalid probability, hash tampering, wrong outcome identity, duplicate/conflicting resolution, premature resolution, insufficient samples, cohort mixing, and degraded calibration. It must also prove calibration cannot increase PAPER orders/fills, change risk state, bypass P0/HALT/kill switch, or create LIVE authority.