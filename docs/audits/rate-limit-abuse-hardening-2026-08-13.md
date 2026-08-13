# Rate Limit / Abuse Hardening Audit — 2026-08-13

## Finding

The shared `DeterministicRateLimitManager` existed but was not connected to the Cloud HTTP boundary. In addition, its request-id deduplication map had no bound, so a caller could exhaust memory with unique request IDs even when token capacity was exhausted.

## Remediation

- Cloud HTTP now applies a per-route, per-credential/network bounded limiter before request-body parsing and authorization handlers.
- The limiter reuses `DeterministicRateLimitManager`, applies higher weight to mutating requests, returns `429 RATE_LIMITED` with `Retry-After`, drains rejected bodies, and emits a secret-minimized blocked-event audit projection.
- Credential identities are hashed for bucket keys; raw bearer values are never logged or persisted.
- Bucket count is bounded and the shared manager now supports bounded request-id tracking. New identities or request IDs fail closed once capacity is exhausted.
- A monotonic wall-clock wrapper prevents local clock rollback from opening a refill bypass.

## Evidence

- `tests/cloud-rate-limit.test.js`: bounded buckets, duplicate request-id idempotency, and exhaustion: PASS.
- `tests/connectivity-guards.test.js`: shared rate-limit manager clock and decision regression: PASS.
- Existing Cloud dashboard HTTP suite: 12/12 PASS after integration.
- Typecheck: PASS.
- Build: PASS.
- `git diff --check`: PASS.

## Safety

This is a denial-of-service boundary only. It creates no broker, credential, LIVE, transfer, withdrawal, production-mutation, AI, risk-override, or kill-switch authority. PAPER remains the only mutation surface and all existing authorization/risk gates remain authoritative.
