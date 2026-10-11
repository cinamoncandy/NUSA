# Anonymous PAPER observation — canonical wiring

This branch is intentionally fail-closed until both integration points below are present and validated.

## Cloud server

Preserve the current `/health` runtime-liveness/runtimeHealth contract unchanged.

At server startup create the anonymous observation scope only when `NUSA_CLOUD_ANONYMOUS_OBSERVATION=1`.
For an allowlisted observation route with no Bearer header, route only that request through the per-process sentinel verifier and its `dashboard:read` principal.
A request that presents any Bearer token must stay on the ordinary verifier and must never fall back to anonymous access.
Use the observation request/verifier only for the six allowlisted read projections. Keep `/api/real-readonly-operations`, `/api/paper-orders`, `/api/operator/*`, `/v1/mobile/*`, `/v1/desktop/*`, `/api/settings/investment-allocation`, `/api/ux-telemetry`, and `/ready` on their existing authorization paths.

## Mobile App

Keep the credentialed `loadPersonalPaperOperations` path unchanged.
When no verified PAPER session exists, retain the current NOT_CONFIGURED state first, then attempt `loadAnonymousPaperObservation()` as a separate read-only path. Promote only a READY validated snapshot, only if the session is still unverified when the request completes. A session established while the anonymous request is in flight owns the projection and must not be overwritten.
Never use anonymous observation as fallback after a credentialed request fails or a presented credential is rejected.

## Acceptance

Focused tests plus exact-head CI must prove default-off behavior, anonymous read success only when enabled, invalid-token rejection, protected mutation/REAL/operator routes, GET-only/no-Authorization mobile behavior, and unchanged PAPER_ONLY/NONE/false/ZERO_AUTHORITY invariants before this branch may become READY_FOR_REVIEW.
