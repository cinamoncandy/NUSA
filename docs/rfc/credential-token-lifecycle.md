# Credential & Token Lifecycle Hardening (design proposal, not implemented)

Status: PROPOSAL — requires owner approval. No code in this document changes
any runtime behavior.

## Observed gaps (verified)

1. `UpbitExecutionRestClient` (`apps/desktop/src/exchange/upbitExecutionRestClient.ts:57-65`)
   holds the raw `secretKey` in memory for the client's lifetime. It arrives via
   `process.env`, is frozen into the instance, and is never wiped. Exposure
   surface: crash dumps and process-memory inspection. There is no rotation
   story: rotation today means restart with new env.
2. `NUSA_CLOUD_DASHBOARD_TOKEN` (see `apps/cloud/src/cloudRuntimeConfig.ts`)
   is a bearer with no expiry. Compromise response is manual rotate + restart.
   Rotation is not observable: no issuance timestamp, no version, no
   last-used tracking.

## Proposal A — secret minimization (Upbit execution client)

- Introduce an explicit `dispose()` on `UpbitExecutionRestClient` that
  zero-fills the held secret (`secretKey` buffer overwrite, drop reference).
- Call sites (`liveTradingAdapter`, restricted-live flows) call `dispose()` when
  the adapter is replaced or the runtime shuts down.
- Explicitly NOT proposed: per-request re-derivation from `safeStorage`
  (adds a hot-path dependency on OS keychain availability for a client that is
  dormant by default), or env scrubbing (the process environment is owned by
  the launcher, not the app).
- Acceptance: existing `upbit-live-execution-core-v2` + `upbit-execution-rest-branches`
  suites pass; a new test asserts the secret buffer is zeroed after dispose.

## Proposal B — dashboard token lifecycle

- Add `issuedAt` + `tokenVersion` to the dashboard token record; reject tokens
  older than a configured TTL (default 90 days) with a distinct
  `TOKEN_EXPIRED` (not `UNAUTHORIZED`) so rotation is distinguishable from
  attack in logs.
- Add `rotate-dashboard-token` to the cloud runtime CLI: generates, stores
  owner-only, prints the new pairing endpoint. Old token stays valid for a
  24h grace window recorded in the state database.
- Acceptance: `cloud-runtime-config` + mobile session suites extended;
  `cloudRuntimeConfig.ts` fail-closed defaults unchanged.

## Why not implemented here

Both change runtime security behavior and persistence shape. Per `AGENTS.md`
they need an accepted AIPOS work order and owner approval first. The fail-closed
posture is unchanged in the meantime: execution paths still throw without
explicit LIVE authority, and the dashboard still binds localhost by default.
