# ADR-0014: Mobile-first cloud provider is an external decision

## Status

BLOCKED — decision required

## Context

NUSA currently has substantial `apps/cloud` source code, a loopback-only server,
an Oracle systemd recipe, a PC-managed Cloudflare tunnel runbook, and Firebase
readiness files. It has no repository evidence of an approved, deployed,
always-on HTTPS backend. The Android PAPER path still requires a manually
configured endpoint and a verified in-memory session.

## Decision

Do not select a provider or convert any existing recipe into the production
architecture implicitly. A cloud provider/deployment authority must explicitly
choose the always-on host, domain/TLS, authentication, persistent storage,
server-side secret store, backup/recovery, observability, and rollback plan.

Until then, the mobile-first migration is blocked with
`CLOUD_PROVIDER_DECISION_REQUIRED`. PC/localhost/Quick Tunnel remains a
development or diagnostic path only and cannot be promoted to production.

## Safety

This decision adds no execution capability. `PAPER ONLY`, `liveAuthority=NONE`,
`productionMutationAllowed=false`, and AI `ZERO_AUTHORITY/read-only` remain
unchanged. No Upbit credential is placed in Android.
