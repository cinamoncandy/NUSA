# ADR-0014: Mobile-specific short-lived Cloud sessions

Status: Accepted for implementation

## Decision

NUSA mobile clients authenticate through a dedicated mobile session authority,
separate from the operator/dashboard shared-secret verifier.

The bootstrap proof is a server-managed, one-time enrollment proof bound to an
approved NUSA identity and device. The proof is never the dashboard bearer and
is not embedded in an APK. The server consumes the proof once, then issues an
opaque short-lived access token and a rotating refresh token. Only token
digests are stored server-side.

Mobile sessions carry only mobile scopes for PAPER/read-only use:

- `paper:read`
- `paper:simulate`
- `portfolio:read`
- `history:read`
- `ai:read`
- `broker:read`

They cannot authorize operator/admin routes, settings management, or any LIVE,
withdrawal, transfer, or production-mutation capability.

## Failure behavior

Invalid, expired, reused, revoked, malformed, or wrong-audience proofs/tokens
return normalized authentication failures. No anonymous fallback, dashboard
bearer fallback, broker credential fallback, or synthetic account data is
allowed. Refresh rotates the access and refresh credentials; logout revokes
the server session.

## Rejected alternatives

- Reusing `NUSA_CLOUD_DASHBOARD_TOKEN` as a mobile credential.
- Embedding an operator bearer in Android or a JavaScript bundle.
- Treating local `AuthContext` state or app installation as identity proof.
- Adding a third-party identity provider before the existing NUSA identity and
  secure-storage foundations are connected.
