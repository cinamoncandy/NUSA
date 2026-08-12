# Firebase Readiness

Firebase is an optional deployment target. SQLite remains authoritative until
a project, identity mapping, migration, and rollback plan are approved.

Required deployment-only values: `NUSA_FIREBASE_PROJECT_ID` and explicit
`NUSA_FIREBASE_AUTH_ENABLED=true|false`. No service-account JSON, private key,
token, or credential belongs in this repository. Client role/status claims are
never trusted; server authorization must require `OWNER`, `ACTIVE`, and
`users:manage` for approval mutations.

Only Auth and Firestore are prepared. Functions and Hosting are intentionally
omitted until a real project and deployment need exist. A future adapter must
support dual-read verification, append-only audit parity, rollback to SQLite,
and explicit cutover evidence.
