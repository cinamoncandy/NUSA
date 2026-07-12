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
