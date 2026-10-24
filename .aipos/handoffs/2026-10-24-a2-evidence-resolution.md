# A2 evidence-resolution handoff — 2026-10-24

Scope: existing PR #2792 only. No server deployment, Oracle mutation, merge, LIVE authority, or real-money action. Safety remains PAPER_ONLY, liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY.

## Fresh repository/GitHub state

- Protected main: `9bb373516d3e2f6da200e4728c5e5b2708dd131e` (includes #2870 security dependency remediation; canonical Audit/Release run `40089691942` completed successfully).
- PR #2792 remains OPEN / Draft / mergeable, branch `feat/learning-input-set-a2`.
- Remote PR head before sync push: `d5e77af1bf8d8c7701919113d7d26bf8686a64e2`.
- Local synchronized candidate: `c518e035b650ffaa2688036b847bfad1f65e7945`, a merge of current protected main into the existing A2 branch; main is an ancestor. No force push.
- Previous exact-head review and CI receipts are historical. Do not reuse them.

## Implemented A2 contract and regression

- A2 resolution requires the existing LearningEvidenceAuthority and exact durable Research/PAPER identities/timestamps before append and on replay/read paths.
- A2 evidence reference ordering and A1 reservation reconstruction use the same locale-independent code-unit order.
- Sparse aligned evidence arrays and malformed/ambiguous references fail closed.
- Mixed-case PAPER ids [B,a] regression proves the file-backed SQLite restart preserves the correct A1 reservation and matching A1 consumes it.
- Existing stores and ledgers are reused; no parallel engine, store, scheduler, or authority was added.

## Local validation on candidate `c518e035…`

- Node `v24.19.0`, pnpm `11.25.0`.
- `pnpm install --frozen-lockfile`: PASS.
- Build: PASS.
- Focused A2/A1/storage set: 45 tests PASS.
- `pnpm run preflight`: PASS.
- `pnpm run validate:full`: PASS.
- `pnpm run security:gate`: PASS after #2870 merged dependency remediation; no high/critical findings or secrets.
- `git diff --check`: PASS.
- CI, review, formal Validator, Audit, Release, merge: pending for synchronized candidate.

## Next permitted action

Fresh-check the remote branch and PR immediately before a non-force push of the locally validated synchronized candidate to the existing branch. Then wait for exact-head CI and all required companions to finish. Request a fresh independent review only after exact-head checks are green. Keep #2792 Draft; do not merge or deploy. Synchronize A1 (#2793) only after A2 completes its review gate. Do not block or touch #2855 or the order-book archive server deployment.

## Follow-up — authority-bound reservation P2 (2026-10-24)

Fresh review of exact head `7a7fc070ec3e48206049caa7b8ea82603b4892c8` found P2: a generic shared-ledger writer could append canonical-looking A2 metadata whose source records were absent; after restart, storage could reserve A1 capacity despite the A2 reader rejecting it.

Local repair now uses the existing storage boundary only:

- `SqliteEvolutionLearningLedger.append` checks A2 source identities and exact observed times inside its SQLite transaction using the existing hash-chain Research decision-history reader and checksum-valid PAPER-period reader.
- Reservation replay re-resolves legacy and current A2 rows against those same durable readers. Missing/corrupt reader authority fails closed; ordinary non-A2 writes do not scan or initialize these readers.
- PAPER source validation uses a read-only reader method, avoiding schema DDL during ledger recovery.
- Removed the injected verifier callback so callers cannot supply their own trust claim. New canonical A2 writes use `LEARNING_INPUT_SET_AUTHORITY_VERIFIED`; legacy rows remain readable only when actual durable source evidence still resolves.
- Regression coverage includes forged missing-source generic append/restart, valid A2 reservation persistence, unrelated writer blocked from the reserved slot, matching A1 consumes exactly one slot, mixed-case `[A,a]` ordering, sparse evidence, receipt bounds, and source timestamp mismatch.

Validation so far: Node `v24.19.0`; `pnpm build` PASS; all three focused A2 identity/retention and storage suites PASS (46/46); `pnpm run preflight` PASS; `pnpm run validate:full` PASS; `pnpm run security:gate` PASS (0 raw high/critical, 0 secrets); AIPOS YAML and work-order provenance validators PASS; diff check PASS before final metadata cleanup. Generated `docs/audits/*-2026-10-25` reports are validator outputs and must not be committed.

GitHub was freshly read: #2792 remains OPEN / Draft / mergeable at remote head `7a7fc070ec3e48206049caa7b8ea82603b4892c8`, protected base `9bb373516d3e2f6da200e4728c5e5b2708dd131e`; the P2 thread is on that head. All earlier CI/review receipts are historical once this repair is committed. No push has been made yet.

Next: final AIPOS/diff checks; commit the substantive repair and its handoff on the existing branch; push non-force; wait for exact-head CI plus required companions; request exactly one fresh independent review only after green. Keep Draft. Do not proceed to A1 and do not touch #2855, server deployment, Oracle, or runtime.
