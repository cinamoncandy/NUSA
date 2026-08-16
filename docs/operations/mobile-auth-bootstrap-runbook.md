# Mobile auth bootstrap runbook

This runbook covers the mobile-specific Cloud session authority. It does not replace the operator/dashboard bearer and it does not grant LIVE authority.

## Security contract

- `PAPER ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, and `AI ZERO_AUTHORITY` remain mandatory.
- The operator/dashboard bearer is never used as a mobile credential.
- Upbit credentials, signing material, and operator credentials remain server-side.
- Mobile access tokens are short-lived opaque bearer values. The Cloud stores only SHA-256 digests in `mobile_sessions`.
- Refresh tokens rotate. A revoked or expired session fails closed.

## Enrollment provisioning

The Cloud process accepts `NUSA_CLOUD_MOBILE_ENROLLMENTS_JSON` only as a server-side configuration value. Each record contains a pre-hashed one-time proof, an approved NUSA identity, and an expiry:

```json
[{"proofHash":"<64 lowercase hex characters>","userId":"<approved identity>","email":"<approved email>","expiresAtMs":0}]
```

The raw proof is generated and delivered through an approved operator/device-enrollment process; it is never committed, placed in an APK, logged, or put in a URL. The record is consumed once and may optionally be bound to a hashed device identifier. Invalid, expired, reused, or device-mismatched proofs return `BOOTSTRAP_DENIED`.

Provision the value outside the repository with restrictive permissions, restart the Cloud service, and verify the service health without printing the value. Do not reuse `NUSA_CLOUD_DASHBOARD_TOKEN`.

## Mobile session lifecycle

1. The mobile client posts the approved enrollment proof and device identifier to `/api/mobile/session/bootstrap` over the canonical HTTPS origin.
2. Cloud returns a short-lived mobile access token and rotating refresh token with only PAPER/read-only scopes.
3. The mobile client stores the session only through the platform secure-storage adapter.
4. Before access expiry the client refreshes once through `/api/mobile/session/refresh`; refresh failure clears local session state and requires re-authentication.
5. Logout posts `/api/mobile/session/revoke` with the mobile access token and then deletes the secure local session.

The mobile session cannot access operator users/settings routes. It cannot create LIVE orders, cancel orders, withdraw, transfer, manage credentials, or invoke infrastructure operations.

## Device loss and rotation

- Revoke the affected mobile session in the Cloud session store and invalidate its refresh token.
- Issue a new enrollment proof for the replacement device with a new expiry and, when device binding is used, a new device hash.
- Never extend an old proof or copy a refresh token to another device.
- If the enrollment configuration or server signing/credential boundary is suspected compromised, rotate the configuration through the existing Oracle/systemd secret process and restart the service. Record the rotation event without recording secret values.

## Recovery expectations

The SQLite-backed Cloud runtime persists enrollment consumption and mobile session digests when the durable Cloud state database is enabled. An in-memory/test runtime intentionally loses mobile sessions on restart and must require safe re-enrollment; it must never silently fall back to the operator bearer or demo data.

## Verification

Run the focused mobile auth tests, typecheck, lint, AI zero-authority guard, Restricted LIVE checks, and read-only broker check. Oracle loopback and real Android verification remain external gates until the enrollment configuration, canonical HTTPS origin, and device environment are provisioned.

