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
pnpm evidence:status --db C:\absolute\path\dokkaebi.db
```

Export is read-only and creates the output file exclusively. It requires the exact validation target:

```text
pnpm evidence:export --db C:\absolute\path\dokkaebi.db --output C:\absolute\path\bundle.json --code-version <git-sha> --strategy-id <id> --strategy-version <version> --dataset-id <id> --dataset-checksum <sha256>
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
