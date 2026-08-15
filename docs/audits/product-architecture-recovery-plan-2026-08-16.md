# NUSA Product Architecture Recovery Plan — 2026-08-16

## Scope and verdict

- Base: `main` at `dd951890458eef43b77cd943a89e9e52d84d2500`
- Principle: reuse existing Oracle/PAPER assets; no new provider or backend
- Production code changed in this planning pass: none
- Current verdict: **IMPLEMENTATION BLOCKED at stable HTTPS ingress and mobile auth bootstrap**

The plan preserves working source assets and prevents downstream mobile changes from being built around an unknown hostname or an unsafe shared bearer credential.

## KEEP / FIX / REPLACE / DEV-ONLY

| Asset | Decision | Reason |
|---|---|---|
| `apps/cloud` runtime, PAPER engine, SQLite persistence/recovery | KEEP | Existing source-side PAPER and readiness contracts are substantial and safety-tested. |
| #237/#254 Oracle systemd, host validation, atomic deploy, backup, readiness, token rotation | KEEP | Existing operations foundation; no replacement provider. |
| Upbit public quotation client | KEEP | Direct unauthenticated HTTPS GET path already works independently of PAPER. |
| Server-side Upbit read-only bridge | KEEP / FIX DEPLOYMENT | Credentials remain server-side; actual deployment and health are unproven. |
| React Native Android shell, Markets, Chart, Home | KEEP / FIX CONNECTION | UI assets remain; current PAPER transport must move from Settings endpoint to canonical origin/session. |
| `paperEndpoint` persistence and Settings endpoint/token controls | REPLACE IN PRODUCTION UX | Manual infrastructure configuration violates the product contract. Preserve only as developer diagnostics during migration. |
| Shared dashboard bearer as mobile credential | REPLACE | It is an operator secret, not a mobile user session. Never embed it in APK or JS. |
| Cloudflare named/Quick Tunnel launchers and local bridge runbooks | DEV-ONLY | Useful for local diagnostics; prohibited in production Android path. |
| GitHub persistent release and Firebase distribution | KEEP / FIX PROVENANCE | Existing channels can remain after source/hash/version/certificate identity gates are added. |
| #535 Home visual redesign | HOLD | Separate visual acceptance; do not mix with infrastructure recovery. |

## Dependency DAG

| Stage | Status | Evidence / gate |
|---|---|---|
| A. Existing Oracle runtime discovery | PASS | #237/#254 and current files identified. |
| B. Stable HTTPS ingress | BLOCKED | No Oracle host, hostname, reverse proxy, persistent tunnel, or TLS attestation; external authority required. |
| C. Mobile canonical origin | BLOCKED BY B | Existing env parser is not wired to PAPER; do not add an unknown origin. |
| D. Mobile auth bootstrap | BLOCKED BY AUTH DECISION | No mobile login/session bootstrap exists; do not ship master bearer. |
| E. PAPER cloud E2E | BLOCKED BY B/C/D | Requires deployed readiness and session. |
| F. Settings infrastructure leakage removal | BLOCKED BY C/D | Cannot remove controls until a working automatic path exists. |
| G. Release identity/provenance | PARTIALLY AUTOMATABLE | Workflow/build defaults and persistent clobber behavior can be fixed after origin/auth contract is approved. |
| H. Android RC | PENDING | Requires exact source/config and release provenance. |
| I. Real-device acceptance | HUMAN_ENVIRONMENT_ONLY | PC-off install, PAPER, relaunch/recovery, TLS, and screenshot evidence. |

## Safe next implementation boundary

The next code change may begin only after the following non-secret inputs are supplied:

1. Oracle deployment host or an external attestation that the host is online.
2. Stable public HTTPS hostname and persistent ingress owner/configuration.
3. Approved mobile identity/session bootstrap contract, including session lifetime, refresh/revocation, and server-side user mapping.
4. Release configuration owner for the public origin and production signing identity.

No master dashboard token, Cloudflare API token, Oracle credential, Upbit key, JWT secret, or private key should be shared in an issue, PR, chat, or build artifact.

## Automated gates to implement after authority is available

- release Android uses only the canonical HTTPS origin;
- normal production PAPER path has no manual endpoint or bearer prerequisite;
- localhost/LAN/Quick Tunnel strings are rejected from the release path;
- cleartext traffic remains disabled;
- APK and JS bundle contain no server/broker secrets;
- `/health` and authenticated `/ready` are checked against the actual origin;
- PAPER state/action/history/recovery use the canonical session;
- public Markets/Chart remain direct public quotation paths;
- read-only broker remains GET-only;
- LIVE mutation is absent;
- AI remains `ZERO_AUTHORITY`;
- Home remains a Home shell during cloud failure;
- source SHA, run ID, version, certificate, and APK SHA-256 agree.

## Final product gate

Only after A–H are complete may the physical gate run:

```text
PC OFF
  -> install exact APK
  -> launch Home
  -> Markets public data
  -> Chart candles
  -> automatic NUSA Cloud session
  -> PAPER state/action/portfolio/history
  -> kill app
  -> relaunch and recovery
```

If endpoint, bearer, port, PC, LAN, or Quick Tunnel setup is requested, acceptance is FAIL.

## Stop condition

**BLOCKED — CLOUD INFRASTRUCTURE AUTHORITY REQUIRED**

Do not implement C–F against a guessed origin or invented authentication. Do not change #535 or merge visual work.

## Current repository validation

- `git diff --check`: PASS
- `pnpm run aipos:drift`: PASS
- `pnpm run aipos:conformance`: PASS; fingerprint `8556d936c4341b50f95f70d00d8e9bada0f9dd124237eca4d596e173f2efbd40`
- Oracle/cloud/mobile focused contracts: **21/21 PASS**
- Exact-head CI, cloud deployment health, and real Android acceptance: not claimed; no implementation PR exists.
