# Shadow crash recovery verification

This procedure validates the desktop Shadow recovery path with public market data only. It is
for a test build and must never use an account, API key, private endpoint, or live order.

## Run the test build

From the repository root, use the repository's supported runtime (`Node >= 24` and `pnpm >= 11.7`):

```powershell
pnpm install --frozen-lockfile
pnpm run desktop
```

The app stores its durable state under Electron's `app.getPath("userData")`. The exact user
directory is intentionally not printed in diagnostics. The relevant files are:

- `crash-marker.json`: the current run marker, atomically replaced and hash sealed.
- `recovery-records.jsonl`: append-only records created when an earlier marker was not clean.
- `shadow-evidence/`: the existing hash-chained Shadow archives and completion markers.
- `nusa.db`: the existing Paper/recovery persistence store.

## Safe verification procedure

1. Start a test build and confirm the A4 diagnostics view reports Paper-only, private API
   disabled, credential storage disabled, and zero mutation counters.
2. Start a Shadow session only when the read-only precheck is ready.
3. For a controlled crash test, use an isolated test profile and terminate the test process
   through the operating-system process manager while the session is RUNNING, PAUSED, or
   RECONNECTING. Do not perform this against a production installation or a real account.
4. Start the app again. It must show `RECOVERY_REQUIRED`, preserve the previous run/session
   identifiers, and keep automatic observation and execution disabled.
5. Use the existing read-only `recovery:status` and `recovery:reconcile` paths. Owner review is
   allowed only after a fresh `MATCHED` comparison. Completion is allowed only after explicit
   owner approval and fingerprint validation.
6. Confirm that recovery is completed without deleting the recovery record or evidence archive.
   A new session may then be started explicitly; the interrupted session is never resumed.
7. For a normal shutdown, stop the Shadow session first, wait for Evidence flush/finalization,
   then close the app normally. The next launch must not require recovery.

## Success criteria

- `cleanShutdown` is true only after resource cleanup and Evidence finalization succeed.
- An interrupted `RUNNING`, `PAUSED`, or `RECONNECTING` session becomes `INTERRUPTED` recovery,
  not `RUNNING`.
- Completion/Evidence boundary interruptions require the corresponding review.
- Marker checksum tampering, partial Evidence, and orphan recovery records fail closed.
- Recovery comparison is `MATCHED`, owner approval is explicit, and the audit record remains.
- Orders, fills, cash mutations, position mutations, broker calls, private API calls, and
  credential writes remain zero.

## Evidence to collect on failure

Collect the non-secret test diagnostics, process logs, the marker checksum status, recovery
record status, Evidence verifier output, mutation counters, and the reconciliation mismatch
codes. Do not attach API keys, user home paths, database credentials, or raw private data.
