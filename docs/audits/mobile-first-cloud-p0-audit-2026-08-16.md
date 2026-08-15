# Mobile-first cloud P0 audit — 2026-08-16

## Audit basis

- Repository: `cinamoncandy/NUSA`
- Base: `main`
- Audited commit: `dd951890458eef43b77cd943a89e9e52d84d2500`
- Separate from PR #535, which remains Draft/HOLD.

## Root-cause finding

The repository does not currently contain an approved, deployed, always-on cloud backend that an Android release can use without a PC. The requested `PC dependency = 0` acceptance is therefore not met and cannot be implemented honestly by changing only the mobile client.

## Existing architecture

1. `apps/cloud` contains substantial PAPER/runtime, dashboard HTTP, persistence, market-data, and AI read-only source code, but `nusa.md` explicitly classifies it as source-only: it is not deployed or wired into a running process.
2. `apps/cloud/src/server.ts` and `cloudRuntimeConfig.ts` intentionally restrict the runtime to `127.0.0.1`/`localhost`.
3. `deploy/oracle/nusa.service` is an Oracle/systemd deployment recipe and `scripts/oracle-validate.js` validates a hypothetical host filesystem. No deployed host, domain, health result, or deployment authority is present in repository evidence.
4. `deploy/cloudflare-tunnel/config.example.yml` and `docs/TRUSTED_HTTPS_BRIDGE.md` describe a named tunnel from a locally managed `cloudflared` process to the loopback runtime. This is a PC-managed bridge, not an always-on canonical mobile backend.
5. Firebase is readiness-only. `firebase.json` contains Firestore rules/indexes and emulators; `docs/deployment/firebase-readiness.md` explicitly says Functions/Hosting are omitted until a real project and deployment need exist. No Firebase project, Auth/Hosting/Functions deployment, or cutover evidence exists.
6. `services/upbit-readonly` is a separate loopback-bound server source with server-side Upbit JWT construction, but it is not a deployed mobile backend and its `.env.example` is not a credential store.

## Current mobile dependency

- `apps/mobile/src/settings.ts` persists an empty-by-default `paperEndpoint` and requires an explicit endpoint.
- `apps/mobile/src/settingsView.tsx` exposes endpoint and credential setup to the user.
- `apps/mobile/src/personalPaperOperationsClient.ts` refuses normal PAPER reads until the user-configured endpoint is verified.
- `apps/mobile/src/apiClient.ts` retains a development loopback default (`http://127.0.0.1:41731`).
- Public Upbit quotation is already direct HTTPS and does not require a backend credential.
- Cloud PAPER, authenticated read-only account access, and cloud AI cannot be considered Android-only until an actual backend deployment and identity/session path exist.

## Provider decision

`CLOUD_PROVIDER_DECISION_REQUIRED`.

No repository-approved always-on provider is currently available. Oracle plus a named Cloudflare tunnel are deployment ingredients/documentation, not evidence of a deployed canonical service. Firebase is explicitly not deployed. Selecting or provisioning a provider requires owner/deployment authority and must define the persistent database, authentication, server-side secret store, domain/TLS, backups, recovery, observability, and rollback path.

The implementation must not choose a new provider, expose the local runtime, or retain Quick Tunnel as a production fallback before that decision.

## Acceptance status

`BLOCKED — CLOUD DEPLOYMENT AUTHORITY REQUIRED`.

The following cannot be claimed:

- PC-off Android-only PAPER E2E
- canonical HTTPS backend origin
- automatic mobile endpoint configuration
- cloud deployment health
- server-side Upbit read-only account path in production
- cloud AI path in production

Repository-only checks confirm current safety contracts but do not satisfy the external deployment gate. The safety boundary remains `PAPER ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, and AI `ZERO_AUTHORITY/read-only`.
