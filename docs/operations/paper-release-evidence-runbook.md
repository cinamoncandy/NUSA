# Paper Release Evidence Runbook

This runbook describes the minimum authoritative evidence path for the Upbit spot Paper runtime. It does not authorize live trading and does not convert CI, fixtures, rehearsal output, or code-path existence into operational evidence.

## Roles and boundaries

- Runtime automatically records real Paper evidence in its SQLite database.
- Operator reads the database through read-only commands and exports a bundle.
- The schema, sequence, event identity, provenance, replay counters, and checksums are verified before interpretation.
- The release evaluator computes a single BLOCKED / READY_FOR_OWNER_REVIEW / APPROVED result.
- The owner independently reviews the bundle and decides whether the GitHub PR may leave Draft.
- Tests and `pnpm evidence:rehearse` never increase operational counters.

## Start and observe

1. Start the desktop app in PAPER mode and verify that automatic trading is disabled after startup.
2. Confirm that no private API, credential, withdrawal, or live order path is configured.
3. Locate the actual Paper database from the running app's user-data directory. Pass the path explicitly to operator commands; do not guess or scan arbitrary files.
4. Keep a backup before review and record the database identity shown by the bundle, without publishing the local path.

## Operator commands

Status is safe with no database argument and reports `not evaluated` rather than inventing zeros:

```text
pnpm evidence:status
pnpm evidence:status --db C:\absolute\path\nusa.db
```

Export is read-only and creates the output file exclusively. It requires the exact validation target:

```text
pnpm evidence:export --db C:\absolute\path\nusa.db --output C:\absolute\path\bundle.json --code-version <git-sha> --strategy-id <id> --strategy-version <version> --dataset-id <id> --dataset-checksum <sha256>
```

Verify the exported bundle independently:

```text
pnpm evidence:verify --bundle C:\absolute\path\bundle.json
```

The commands return non-zero on invalid input, missing files, malformed SQLite, sequence corruption, duplicate event IDs, invalid JSON, checksum mismatch, or bundle replay mismatch. They print a generic error only and do not disclose raw paths, usernames, hostnames, environment values, secrets, or stack traces.

## Required real Paper evidence

The status output must be read as current/required counts, never as a completion claim:

- 20 real observed sessions
- 50 real completed Paper orders
- 3 represented market regimes
- 3 real restart recoveries
- 10 real duplicate checks
- each required fault scenario supported by a verified operator drill
- passing Walk-Forward, Cost Stress, and Integrity reports for the same target
- independently verified bundle
- owner review

Fault scenarios are PASS only when the dedicated drill proves rollback, fail-closed runtime state, strategy stop, auto-trade OFF, command blocking, and durable evidence rules. A natural persistence error is not an automatic PASS. If the evidence database is unavailable, record `not evaluated`; do not write a PASS event into the failed database.

## Review and release state

The authoritative release state is:

- `BLOCKED`: missing, stale, mismatched, unsafe, or unevaluated evidence
- `READY_FOR_OWNER_REVIEW`: automated hard gates complete; owner action remains
- `APPROVED`: only after a matching owner approval and exact target match

CI success, a rehearsal PASS, a dashboard toggle, or a local approval record cannot independently make the PR Ready or merge it. The PR remains Draft until real evidence and owner review are complete.

## Handoff evidence collection record

Use the following record for each real Paper observation or operator drill. Do not fill an unknown value with zero or PASS.

| Evidence | Current | Required | Status | Source | Last checked | Notes |
| --- | ---: | ---: | --- | --- | --- | --- |
| Observed sessions |  | 20 | NOT_EVALUATED | Runtime DB |  |  |
| Completed Paper orders |  | 50 | NOT_EVALUATED | Runtime DB |  |  |
| Market regimes |  | 3 | NOT_EVALUATED | Runtime DB |  | UP_TREND / RANGE / DOWN_TREND |
| Restart recoveries |  | 3 | NOT_EVALUATED | Runtime DB |  |  |
| Duplicate checks |  | 10 | NOT_EVALUATED | Runtime DB |  |  |
| WebSocket disconnect/reconnect |  | 1 | NOT_EVALUATED | Runtime DB |  | Initial connection is not a reconnect |
| Duplicate signal |  | 1 | NOT_EVALUATED | Runtime DB |  | Same signal key, one order maximum |
| Kill switch |  | 1 | NOT_EVALUATED | Runtime DB |  | Strategy stopped and auto trade OFF |
| Persistence failure drill |  | 1 | NOT_EVALUATED | Verified drill |  | Never write PASS into a failed DB |
| Partial write drill |  | 1 | NOT_EVALUATED | Verified drill |  | Must prove SQLite rollback |
| Walk-Forward |  | PASS | NOT_EVALUATED | Research report |  | Exact target required |
| Cost Stress |  | PASS | NOT_EVALUATED | Research report |  | Exact target required |
| Integrity |  | PASS | NOT_EVALUATED | Integrity report |  | Bundle and replay checks |
| Evidence bundle |  | VALID | NOT_EVALUATED | Export/verify |  | Exact target and code version |
| Owner review |  | COMPLETE | NOT_COMPLETED | Owner |  | Never inferred from code |

Each populated row must include the observation or drill timestamp, session ID or drill ID, application version, commit SHA, actual result, evidence event/report identifier, PASS/FAIL, and operator note.

## Operator actions that are available

- pnpm evidence:status
- pnpm evidence:status --db <absolute-db-path>
- pnpm evidence:export --db <absolute-db-path> --output <absolute-output> --code-version <sha> --strategy-id <id> --strategy-version <version> --dataset-id <id> --dataset-checksum <sha256>
- pnpm evidence:verify --bundle <absolute-bundle-path>
- pnpm evidence:rehearse

The persistence and partial-write fault drill implementation is not exposed as a production operator command in this PR. Record those rows as NOT_AVAILABLE until a verified operator drill is explicitly available. Do not inject failures manually into an operating production database.

## Fault scenario verification

### WebSocket disconnect

A disconnect counts only when an already established stream ends, a reconnect is attempted, the reconnect succeeds, and the corresponding evidence is present. Initial connection success is not a reconnect PASS.

### Duplicate signal

Process the same signal key twice in the real Paper runtime. Confirm that at most one order is created, duplicate-check evidence exists, the DUPLICATE_SIGNAL evidence is present, and the related events are atomically persisted.

### Kill switch

Run while the strategy is active. Count PASS only after strategy state is STOPPED, auto trade is OFF, and the control state confirms the safe condition.

### Persistence failure and partial write

Only a dedicated verified drill may produce PASS. It must prove rollback, strategy stop, auto trade OFF, control FAULTED, runtime unavailable, subsequent command blocking, no order/signal-key partial persistence, and no PASS event written into the failed database. If the drill command is unavailable, status is NOT_AVAILABLE.

## Research and bundle handoff

Walk-Forward, Cost Stress, and Integrity results must be persisted reports for the exact strategy, version, dataset, code version, and policy target. Missing commands or reports are NOT_AVAILABLE / NOT_EVALUATED. Export and independent verification must complete before owner review. A bundle mismatch, stale report, missing evidence, or unresolved blocker keeps release BLOCKED.

## Stop conditions

Stop Paper evidence collection immediately, preserve the database and logs, and keep automatic trading disabled after persistence failure, integrity failure, partial state, duplicate real order, failed kill switch, restart with auto trade ON, sequence/event/checksum mismatch, unknown migration, or unexpected private/live API access. Do not overwrite the failed database or fabricate a PASS.

## Owner handoff

The owner reviews the exact PR HEAD, CI run, database identity, evidence status record, research reports, bundle checksum, verifier output, blocking reasons, and rollback plan. The owner decision is independent of this runbook. Until every required real-evidence row is complete and independently reviewed:

- release status remains BLOCKED;
- PR remains Draft and unmerged;
- no approval review, Ready transition, auto-merge, or merge is performed.
