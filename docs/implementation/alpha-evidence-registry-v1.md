# Alpha & Evidence Registry v1

## Purpose

Manage versioned Alpha definitions and the evidence that supports, rejects, or neutrally informs them.

## Properties

- immutable records
- append-only version lineage
- deterministic SHA-256 content hashes
- deterministic registry snapshot hash
- explicit Alpha-to-Evidence links
- missing dependency and dangling link rejection
- future timestamp rejection
- duplicate identity rejection
- no automatic lifecycle promotion
- no capital allocation or order submission

## Alpha lifecycle

`IDEA -> RESEARCH -> PAPER -> CHAMPION -> SUSPENDED -> RETIRED`

The registry stores lifecycle state only. Governance and human review remain responsible for transitions.

## Evidence relations

- `SUPPORTS`
- `REJECTS`
- `NEUTRAL`

Evidence retains dataset SHA-256, experiment identity, confidence, source, observation time, and summary.

## Safety boundary

This module is PAPER/DRY_RUN research infrastructure. It cannot trade, allocate capital, enable LIVE mode, or promote an Alpha automatically.
