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
