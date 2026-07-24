# Evidence Rehearsal

The evidence rehearsal is an explicit, temporary, PAPER-only validation run. It is not an operational evidence collector.

## Safety contract

- It creates a temporary SQLite database under the operating system temp directory.
- It never opens or mutates the production Paper evidence database.
- Synthetic rows and reports carry `REHEARSAL_ONLY` / `REHEARSAL` provenance.
- Rehearsal output is ineligible for release readiness, owner approval, research promotion, and operational counters.
- A report is immutable and includes a canonical checksum, validation checks, status mismatches, and cleanup status.
- No scenario PASS evidence is appended by the rehearsal runner.

## Run

```text
pnpm evidence:rehearse
pnpm evidence:rehearse --output C:\absolute\path\rehearsal-report.json
```

The output option requires an absolute path and uses exclusive creation. Use of a preserved temporary database is an explicit programmatic option for diagnostics; the default always removes the temporary database.

## Scope

The fixture validates event replay, synthetic session/order/regime/recovery/duplicate counters, evidence bundle construction, checksum generation, and the expected blocked release status. It also includes negative validation targets for short counters, missing research, and checksum mismatch in the report metadata. A green rehearsal is only evidence that the rehearsal harness is internally consistent; real Paper observation and owner review remain required.
