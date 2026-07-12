# Paper Validation Evidence v1

## Purpose

This module converts long-running PAPER/DRY_RUN operation into explicit release evidence. Elapsed calendar time alone is not sufficient: availability, failed runs, snapshot failures, incidents, and integrity checks are evaluated together.

## Inputs

Each observed day records:

- planned and actual runtime
- successful, blocked, and failed runs
- incidents and critical incidents
- snapshot failures
- integrity-check result

## Output

The report contains calendar duration, observed days, availability, failure ratios, incident counts, qualifying days, and a fail-closed `releaseReadinessPaperValidationDays` value.

Only a `PASS` report contributes qualifying days to Release Readiness. `WARNING` or `FAIL` contributes zero.

## Safety boundaries

- PAPER/DRY_RUN evidence only
- no order execution
- no strategy promotion
- no automatic release
- no synthetic missing days
- duplicate dates, future timestamps, invalid counters, and integrity failures fail closed
