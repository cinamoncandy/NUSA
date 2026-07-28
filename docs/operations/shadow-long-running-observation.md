# A4K Long-running Shadow Observation

This procedure validates runtime stability without enabling orders, private APIs, credentials,
or automatic restart. It is an operator check, not a CI job: CI uses the fake-timer tests only.

## Start

From the repository root:

```powershell
pnpm run build
pnpm desktop
```

In Control Room, run the existing read-only A4 safety check. Start Shadow only when the screen
reports `READY_FOR_OBSERVATION`, then keep the session open for at least 30 minutes. The profile
remains KRW-BTC, verified closed 1-minute candles, and the existing hard safety ceiling applies.

## During the observation

The Shadow panel's **Long-running diagnostics** section is read-only. Check it periodically:

- session id and state remain unchanged;
- elapsed time advances;
- memory health is `CHECK_REQUIRED` until three samples exist, then `STABLE` unless heap usage
  is strictly increasing in every sample;
- active interval count remains one while running and listeners/subscriptions remain one;
- Evidence and signal counts advance without duplicate subscriptions;
- actual orders, fills, cash/position mutations, broker calls, and private API calls remain zero.

The sampler captures one immediate snapshot and then one every minute. Its memory heuristic is a
conservative diagnostic signal, not proof of a leak: sustained monotonic heap growth is
`UNSTABLE`; ordinary GC variation is `STABLE`. The complete per-session snapshots remain
read-only diagnostics and do not alter the immutable Evidence archive.

## Stop and inspect

Use the existing owner **Stop Shadow session** action. Do not kill the process. Confirm the final
state is `COMPLETED`, the sampler reports zero active intervals/timeouts, and the safety counters
remain zero. Verify the existing Evidence archive with the normal A4 verifier and inspect the
diagnostic snapshots through the Shadow status/read-only UI. A writer, flush, sequence, private
API, credential, or mutation failure is a HALT and must remain visible for recovery review.

If the session is not `COMPLETED`, preserve the archive and collect the Electron main-process
logs, the final read-only diagnostics response, and the Evidence `verification.json`. Never
delete an incomplete archive or reset a safety blocker to continue.
