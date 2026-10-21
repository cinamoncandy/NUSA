# SQLite startup recovery ordering handoff — 2026-10-21

## Canonical target

- Repository: `cinamoncandy/NUSA`
- PR: `#2855`, branch `fix/sqlite-integrity-attestation-2770`
- Protected main: `0e04ff50afa87b57e611f54bec528abe2cf9dc8d`
- Source head before this local repair: `602656747aa76c35372b50a41fc5b5fae6fee1d9`
- PR remains Draft; no release or Oracle action is authorized by this handoff.

## Failure and repair

Exact-head CI run `39598885589` failed `tests/research-startup-recovery.test.js` at the production composition boundary: `competing=false` returned `FAIL_CLOSED` where `READY` is required; `competing=true` retained owner-preservation behavior. The cause was Cloud AI durability schema initialization mutating the shared SQLite schema after Research `prepareRecovery()` had captured schema-bound evidence.

The local repair now initializes Cloud AI durability on the canonical `DatabaseSync` connection before Research composition and recovery preparation. The full-file `PRAGMA quick_check` remains in `SqliteDatabase` construction; research recovery remains before PAPER writer-lease acquisition. The regression asserts both AI durability schema tables exist when recovery evidence is prepared.

## Validation on the uncommitted working tree

- `pnpm build`: PASS
- `tests/research-startup-recovery.test.js`: 19/19 PASS
- `tests/paper-startup-lease-budget-2770.test.js`: 9/9 PASS
- `tests/paper-writer-lease-liveness.test.js`: 2/2 PASS
- `pnpm run validate:full`: PASS
- `pnpm run security:gate`: PASS
- `git diff --check`: PASS

These are local results only. They do not replace new exact-head CI or independent review.

## Next permitted actions

1. Recheck protected main and the current PR branch, then commit and push the repair to existing PR `#2855` without force.
2. Bind fresh exact-head CI and all five companion workflows to the pushed head.
3. Obtain fresh non-author review with zero unresolved P0/P1 findings.
4. Obtain a separate structured NUSA VALIDATOR receipt with exact head, P0/P1/P2 counts, and explicit `ACCEPTED`.
5. Only then proceed to independent Audit, Release authorization, and protected merge.

Do not deploy/restart Oracle or mutate its database during PR validation. Preserve `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, and `aiAuthority=ZERO_AUTHORITY`.
