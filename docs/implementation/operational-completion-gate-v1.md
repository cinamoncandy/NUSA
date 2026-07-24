# Operational Completion Gate v1

## Purpose

The completion gate prevents DOKKAEBI from being declared complete because individual modules or CI checks pass in isolation. It combines four independent evidence families:

1. complete and healthy AI CIO source coverage;
2. real elapsed Paper validation evidence;
3. all supported recovery scenarios;
4. the release-readiness audit.

## Decisions

- `BLOCKED`: a technical, source-coverage, recovery, or non-Paper release requirement failed.
- `WAITING_FOR_EVIDENCE`: technical gates pass, but the required Paper observation period has not elapsed.
- `READY_FOR_OWNER_REVIEW`: all deterministic gates pass. This is not automatic approval.

The result always sets:

- `ownerReviewRequired=true`
- `automaticCompletionAllowed=false`
- `liveTradingAllowed=false`

## Recovery coverage

The gate requires one READY plan for each scenario:

- SQLite corruption
- snapshot corruption
- runtime crash
- event-log gap

Duplicate, missing, blocked, or non-resumable plans fail closed.

## Evidence honesty

Calendar duration is accepted only from `PaperValidationEvidence`. Tests may exercise synthetic fixtures, but production status must never manufacture elapsed days or performance. A green CI run cannot replace Paper evidence.

## Safety boundary

This module is read-only deterministic policy. It cannot start trading, promote a strategy, release a Kill Switch, mutate persistence, merge a PR, or enable LIVE execution.


## Validation profiles

The default `CALENDAR_30_DAY` profile preserves the original duration policy. An owner may explicitly select `SCENARIO_BASED` instead. The scenario profile does not accept elapsed days as a substitute and requires all of the following:

- 20 observed Paper sessions;
- 50 completed Paper orders;
- 3 represented market regimes;
- 3 successful restart-recovery checks;
- 10 duplicate-order checks;
- persistence failure, WebSocket disconnect, partial-write, duplicate-signal, and Kill Switch scenarios;
- passing Walk-Forward, cost-stress, and integrity checks.

Only the Paper-duration requirement is replaced. CI, typecheck, build, security, runtime, recovery, source coverage, and owner-review requirements remain mandatory. Scenario evidence does not enable LIVE trading.


## Scenario evidence provenance

Scenario counters are derived from immutable session observations rather than accepted as standalone claims. The canonical bundle sorts records by observation time and record ID, derives order/regime/recovery/duplicate/fault counts, links Walk-Forward, cost-stress, and integrity evidence IDs, and records a SHA-256 identity.

The completion gate requires a schema-v1 bundle with a valid full SHA-256 identity. A raw passing counter object is not accepted as completion evidence. The checksum provides deterministic identity and tamper detection; it does not independently prove that an operator or external source reported truthful observations.


Before evaluation, the gate reconstructs the canonical bundle from its observations and research references. It rejects checksum mismatch, altered derived counters, altered validation output, unsupported schema, and malformed SHA-256 values. Merely attaching any 64-character hash is insufficient.
