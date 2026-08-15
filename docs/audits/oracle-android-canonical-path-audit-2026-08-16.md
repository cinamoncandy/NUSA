# Oracle Cloud → Android Canonical Path Audit — 2026-08-16

## Result

- Start main SHA: `dd951890458eef43b77cd943a89e9e52d84d2500`
- Root cause confirmed: **YES** — the Android PAPER path is not connected to a canonical cloud origin; it still requires a manually configured endpoint and bearer token.
- Oracle runtime state: **ORACLE_RUNTIME_STATE_UNKNOWN**
- Stable HTTPS ingress: **NOT PROVEN**
- Canonical Android origin: **MISSING**
- Manual endpoint requirement: **YES**
- Current PC dependency: **YES** for PAPER
- Android-only PAPER E2E: **NOT RUN / NOT PROVEN**
- Production code changes: **NONE**
- PR: none
- Merge: HOLD

This is a repository and read-only network audit. No Oracle host, DNS, reverse proxy, tunnel, service, database, or credential was modified.

## What #237/#254 actually delivered

Issue #237 and merged PR #254 (`807460b86f62a200ab838355bd412609e1894cf9`) added an Oracle operations foundation:

- `deploy/oracle/nusa.service`
- loopback-only cloud binding validation
- `scripts/oracle-validate.js`
- `scripts/oracle-readiness-check.js`
- `scripts/atomic-deploy.js`
- `scripts/sqlite-backup.js`
- `scripts/generate-dashboard-token.js`
- authenticated `/ready`
- persistent SQLite/recovery checks
- structured secret-redacted operational logging
- current-main Cloud PAPER runtime integration

These are deployable repository artifacts, not evidence that an Oracle instance is currently deployed or reachable.

## Oracle runtime state

The repository contains no Oracle host address, Oracle instance identifier, canonical hostname, deployment workflow, OCI credential binding, or external readiness result. GitHub repository secret names contain Firebase values only; no Oracle deployment secret or environment is exposed.

`nusa-api.duckdns.org` appears only as the default authenticated Upbit read-only bridge URL in `apps/mobile/src/upbitLiveClient.ts`; it is not declared as the Oracle Cloud PAPER origin. Read-only network checks at audit time found:

- DNS A record: `158.247.212.15`
- `GET https://nusa-api.duckdns.org/health`: HTTP `502`
- `GET https://nusa-api.duckdns.org/ready`: HTTP `502`

That result proves neither Oracle ownership nor a NUSA runtime. It is therefore not safe to promote this hostname into the Android PAPER path.

## Android connection gap

### Current path

`App.tsx` loads PAPER only after `getConfiguredPaperEndpoint()` and verified session state are present. `personalPaperOperationsClient.ts` rejects an empty/unverified endpoint. `personalPaperOrderClient.ts` uses the same configured endpoint and process-memory credential. `settingsView.tsx` exposes:

- Cloud endpoint input
- session bearer token input
- save/verify connection action
- operator token and user-management controls

`settings.ts` defaults `paperEndpoint` to an empty string. The existing `EXPO_PUBLIC_NUSA_API_BASE_URL` parser is not wired into the normal PAPER runtime path, and `apps/mobile/src/apiClient.ts` still has a loopback fallback but is not used by the current App path.

### Authentication gap

The cloud server currently authenticates a shared bearer token and server-side user-access state. There is no mobile login, session bootstrap, refresh, or device enrollment endpoint in the inspected Cloud/mobile path. Replacing the manual token field with a build-time fixed bearer would expose a server credential in the APK and is prohibited.

Result: **P0 AUTH BOOTSTRAP MISSING**. A canonical public origin alone cannot safely complete the Android production path.

## Required target, not yet implemented

```text
Android
  -> build-configured stable HTTPS origin
  -> persistent reverse proxy / TLS ingress
  -> Oracle localhost-only NUSA runtime
  -> PAPER state / approved PAPER simulation / read-only services
```

The production path must not contain:

- Android endpoint editing
- Android bearer copying
- PC runtime
- local cloudflared process
- Quick Tunnel URL
- broker secret or JWT signing secret in Android

## Capability status

- Public Markets/ticker/candles: **IMPLEMENTED**, direct Upbit public HTTPS GET path; independent of PAPER endpoint.
- Chart: **IMPLEMENTED** from public candle state.
- Oracle PAPER runtime: **SOURCE-IMPLEMENTED**, deployment state unknown.
- Android PAPER readiness/state/portfolio/history: **BLOCKED** by endpoint and auth bootstrap.
- PAPER action: **SOURCE-IMPLEMENTED**, remains PAPER-only and must not be confused with LIVE mutation.
- Authenticated Upbit read-only: **SOURCE-IMPLEMENTED**, server-side credential design; deployment unknown.
- LIVE order/cancel/withdraw/transfer: **ABSENT in inspected production paths**.
- AI: **ZERO_AUTHORITY/read-only** contracts remain present.

## Release identity gap

`.github/workflows/android-persistent-release.yml` runs the release build but does not provide `NUSA_BUILD_SHA` or `NUSA_BUILD_NUMBER`. `apps/mobile/android/app/build.gradle` therefore permits the development fallback `1.0.0-dev` and version code `1`. The release build also references the debug signing configuration.

The workflow has no canonical API origin injection and no source/hash/bundle verification gate. This must be fixed together with the endpoint connection, but no release changes were made in this blocked run.

## Safety result

Unchanged and preserved:

- `PAPER ONLY`
- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- AI `ZERO_AUTHORITY`
- no LIVE order/cancel/withdraw/transfer
- no Upbit credentials, JWT signing secret, or bearer secret added to Android
- no cleartext exception added

## Repository verification

- `git diff --check`: PASS
- `pnpm run aipos:drift`: PASS
- `pnpm run aipos:conformance`: PASS; fingerprint `8556d936c4341b50f95f70d00d8e9bada0f9dd124237eca4d596e173f2efbd40`
- Oracle/cloud/mobile focused contracts: **21/21 PASS**
- Exact-head CI and Android device acceptance: not run for this blocked audit; no implementation PR was created

## Exact blockers

1. Oracle host/runtime access or an inspectable deployment attestation is required.
2. Stable hostname and persistent HTTPS reverse-proxy/TLS ownership are required.
3. A safe mobile authentication/bootstrap design is required; the current shared bearer cannot be embedded in an APK.
4. Release configuration authority is required for canonical public origin, source/build identity, and production signing.
5. Physical Android environment is required for PC-off PAPER E2E and recovery proof.

## Decision

**BLOCKED — EXISTING CLOUD INFRASTRUCTURE ACCESS REQUIRED**

Do not use a local PC bridge or Quick Tunnel as a workaround. Do not choose a new provider. Do not modify #535 or merge any visual work. The next permitted action is to obtain the Oracle host/ingress/auth deployment authority and then run the existing readiness checks against that actual infrastructure.
