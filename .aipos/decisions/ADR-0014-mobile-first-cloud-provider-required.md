# ADR-0014: Oracle mobile-first deployment requires infrastructure access

## Status

BLOCKED — existing Oracle infrastructure access required

## Context

NUSA currently has substantial `apps/cloud` source code, a loopback-only server,
the completed Oracle operations foundation from #237/#254, a PC-managed
Cloudflare tunnel runbook, and Firebase readiness files. The owner has selected
the existing Oracle path for the mobile-first target, but the repository still
has no inspectable Oracle host, canonical hostname, persistent HTTPS ingress,
deployment attestation, or mobile authentication bootstrap. The Android PAPER
path still requires a manually configured endpoint and a verified in-memory
session.

## Decision

Reuse the existing Oracle operations foundation; do not create a new provider or
server. Oracle infrastructure authority must explicitly provide the always-on
host, stable domain/TLS ingress, mobile authentication/bootstrap, persistent
storage, server-side secret store, backup/recovery, observability, and rollback
evidence.

Until then, the mobile-first migration is blocked with
`EXISTING_CLOUD_INFRASTRUCTURE_ACCESS_REQUIRED`. PC/localhost/Quick Tunnel remains a
development or diagnostic path only and cannot be promoted to production.

## Safety

This decision adds no execution capability. `PAPER ONLY`, `liveAuthority=NONE`,
`productionMutationAllowed=false`, and AI `ZERO_AUTHORITY/read-only` remain
unchanged. No Upbit credential is placed in Android.
