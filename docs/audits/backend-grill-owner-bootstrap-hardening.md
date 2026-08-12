# Backend GRILL: owner bootstrap hardening

## Finding

The operator user bootstrap path previously used an owner UPSERT that could convert an existing persisted USER row with the bootstrap id into OWNER/ACTIVE state. That violates fail-closed privilege-boundary semantics when an identity collision exists.

## Fix

- Reject any existing bootstrap id that is not already OWNER + ACTIVE.
- Do not mutate an existing non-owner record into owner state.
- Apply the same fail-closed behavior to both in-memory and SQLite repositories.
- Add regression coverage for both repository implementations.

## Safety

- No LIVE trading authority changes.
- PAPER/read-only safety boundaries remain unchanged.
- No broker credential mutation.
