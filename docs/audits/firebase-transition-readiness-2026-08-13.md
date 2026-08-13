# Firebase Transition Readiness Audit — 2026-08-13

## Finding

Firebase remains a deployment/readiness target only. SQLite is the authoritative NUSA user, approval, PAPER, audit, and runtime persistence. No Firebase project, Admin credential, dual-write, cutover, or authoritative-source switch is assumed or introduced.

The deny-by-default Firestore rules had a direct-write hardening gap: an owner could write an arbitrary user status or audit action, and a self-registration payload could include unbounded extra fields.

## Remediation

- Firestore user status is restricted to `PENDING`, `ACTIVE`, `REJECTED`, or `SUSPENDED`.
- Firestore audit actions are restricted to `APPROVE`, `REJECT`, `SUSPEND`, or `RESTORE`.
- Self-registration uses an explicit allowlist of fields and remains `USER + PENDING` only.
- Owner updates remain limited to USER status/updatedAt fields; role escalation, deletion, and owner mutation remain denied.
- Audit documents remain append-only and owner-only; unknown paths remain denied.
- Functions and Hosting remain intentionally absent.

## Evidence

- `tests/firebase-config.test.js`: deny-by-default, secret-free, lifecycle/action allowlists, and field-boundary assertions: PASS.
- `pnpm run firebase:validate`: PASS.
- Existing SQLite migration/recovery and operator approval suites remain authoritative and unchanged.

## Safety and migration boundary

Firebase Auth/Firestore cannot become authoritative without an explicit project, identity mapping, migration verification, dual-read parity, rollback evidence, and separate cutover approval. No credentials are stored. PAPER-only, `liveAuthority=NONE`, `productionMutationAllowed=false`, and AI ZERO_AUTHORITY remain unchanged.
