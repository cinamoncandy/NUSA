# ADR-0008: Durable Outcome Calibration Memory and Replay

- Status: Accepted
- Date: 2026-08-09
- Scope: PAPER/Research AI calibration durability only

## Context

WO-AI-004 made calibration mathematically truthful and tied model probability to verified outcomes, but the current `OutcomeCalibrationLedger` and pending-resolution set are process-memory only. A Cloud restart therefore erases verified calibration samples and unresolved prediction windows. That makes long-running calibration evidence operationally fragile even though each individual record is hash-bound and zero-authority.

## Decision

NUSA will add an application-owned durable calibration journal and deterministic recovery boundary below the zero-authority AI runtime.

1. Persist only canonical calibration metadata required for replay: hash-bound prediction records, hash-bound resolved outcome records, pending prediction identity/status, sequence metadata, and integrity hashes.
2. Never persist provider credentials, API keys, bearer tokens, raw prompt bodies, hidden reasoning, raw evidence payloads, or broker secrets in calibration storage.
3. Use SQLite through the existing storage/infrastructure direction. Cloud composes the storage adapter; storage must not import Cloud/application implementations.
4. Recovery must replay records deterministically through the same `OutcomeCalibrationLedger` verification rules used at runtime. Exact duplicate replay is idempotent; conflicting duplicate, broken hash, broken prediction→outcome linkage, unsupported outcome definition, or invalid chronology fails closed.
5. Pending predictions may survive restart only with their exact prediction content hash and audited outcome definition. On recovery they remain eligible solely for their original market/horizon/grace window. Already-stale pending records expire without producing calibration credit.
6. If durable calibration cannot be opened, verified, replayed, or appended, NUSA may keep zero-authority AI analysis readable, but trusted/calibrated confidence must be unavailable/zero until durable integrity is healthy again.
7. Persistence and replay must not change AI execution authority, PAPER orders/fills, strategy promotion, risk limits, P0/HALT/kill-switch state, production mutation, or LIVE authority.
8. The read-only projection may expose durability/recovery health and recovered sample counts, but may not expose secrets or mutation capability.

## Consequences

- Calibration evidence can accumulate across normal Cloud restarts instead of resetting to zero.
- Restart replay becomes auditable and deterministic rather than relying on prior chat/process memory.
- Corrupt or partially written calibration state degrades confidence rather than silently trusting bad history.
- Storage schema and migration/recovery tests become part of the AI safety surface.

## Non-goals

- No autonomous provider/model weighting.
- No Champion promotion from calibration alone.
- No strategy mutation/deployment.
- No LIVE execution or production transition.
- No credential persistence.
- No hidden chain-of-thought persistence.
- No attempt to satisfy WO-0051 human/environment gates.
