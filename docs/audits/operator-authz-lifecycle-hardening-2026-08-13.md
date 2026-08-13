# Operator Authorization Lifecycle Hardening

## Finding

The operator access repository accepted status actions without checking the target's current state. That allowed semantically invalid transitions such as `PENDING -> SUSPENDED` and `ACTIVE -> REJECTED`. The in-memory repository also did not enforce the same email identity uniqueness that SQLite enforced with its unique constraint.

## Fix

- Enforce the canonical transitions: `PENDING -> ACTIVE|REJECTED`, `ACTIVE -> SUSPENDED`, and `REJECTED|SUSPENDED -> ACTIVE`.
- Reject all other status actions before mutating the user or audit ledger.
- Require a stable user ID to retain its normalized email identity.
- Reject a normalized email reused by a different user ID in both repositories.
- Preserve OWNER-only `users:manage`, ACTIVE approval enforcement, append-only audit writes, and PAPER-only authority.

## Verification

- Operator, server authorization, runtime identity, decision authorization, and AI zero-authority focused tests: 35/35 PASS.
- Typecheck, lint, and build: PASS.
- No LIVE, broker, credential, risk, or execution authority was added.
- Physical Android acceptance remains HUMAN_ENVIRONMENT_ONLY and is not asserted here.
