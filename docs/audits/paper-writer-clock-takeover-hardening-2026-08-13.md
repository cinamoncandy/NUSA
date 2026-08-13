# PAPER Writer Clock/Takeover Hardening

## Scope

This maintenance slice verifies the existing SQLite PAPER writer lease without
adding a second persistence or concurrency system.

## Behavior

- A wall-clock regression against the persisted heartbeat fails closed and cannot
  authorize a takeover.
- A forward clock age beyond the bounded takeover window fails closed instead of
  treating a live writer as expired.
- An already-running writer treats a regression or excessive forward jump as
  lease loss before it can persist another state.
- A normal lease expiry after an abnormal stop still permits takeover, and the
  last transactionally saved account state is restored unchanged.

## Evidence

- Focused PAPER writer/execution tests: 17/17 PASS.
- SQLite migration tests: 11/11 PASS.
- Typecheck: PASS.
- Lint: PASS.
- Build: PASS.
- Architecture, security, AI zero-authority, AIPOS drift, and AIPOS conformance:
  PASS.
- `git diff --check`: PASS.

The full isolated suite was attempted but one unrelated Windows test could not
create a symlink because the environment lacks the required privilege. This is
an environment limitation, not a source failure; CI remains required for the
full-suite result.

## Safety

This change preserves PAPER-only execution, `liveAuthority=NONE`,
`productionMutationAllowed=false`, `realOrderAuthority=false`,
`realTransferAuthority=false`, and AI `ZERO_AUTHORITY`.
