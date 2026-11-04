# Research Intake Implementation Handoff — 2026-10-27

- Work order: `WO-RESEARCH-20261025-STRATEGY-REPLICATION-INTAKE`
- Canonical PR: #2878, existing draft branch `feat/research-intelligence-precommit-bridge`
- Pre-patch head reviewed: `987f24b97d09573c4d6c1a31227426e8dd009e15`
- Protected main observed: `e7f8a426a57a08339eae3778ca50de6512d6acd9`
- Scope: implementation-only follow-up to the fresh review; no validator verdict, Audit, Release, merge, deployment, or Oracle operation.

## Findings addressed locally

1. Crypto-news repeats with the same experiment identity but a later `createdAt` could create another durable precommit. The repository now reuses the original precommit and rejects changes to authority-bearing experiment content.
2. Inherited PIT/OOS policy identifiers could satisfy evaluation-plan validation. The contract now requires own policy properties.
3. Uppercase source SHA could fork crypto-news identity. Identity and persisted precommit now use lowercase SHA.

## Validation

- Focused changed-file TypeScript compile: PASS.
- Focused contract/storage tests: 35/35 PASS.
- `pnpm run preflight`: PASS using the temporary validation dependency path.
- `pnpm run validate:full`: PASS using the same temporary dependency path.
- Local `security:gate`: license metadata is incomplete in the existing dependency tree (41 of 991 locked packages represented; 854 missing); do not weaken the gate. Exact-head CI remains required.
- `git diff --check`: run before commit/push.

## Fresh review follow-up — durable chronology and canonical news precommit, 2026-10-27

Fresh review on exact predecessor `b028337047048180e01ab40208ca065cc18fb2a5` identified two P1s and one P2: recapture could change first-discovery chronology while retaining a mismatched receipt binding; a directly constructed news precommit could reach durable storage without the canonical Research Intelligence PIT binder; and `publicationDate` accepted arbitrary text.

The local successor now preserves the durable first-discovery timestamp while internally rebinding only a newly authenticated source receipt; the capture timestamp remains the time of the fresh fetch. News precommits must be the exact object emitted by the canonical persisted-memory binder unless an already-persisted experiment is safely reused. Optional publication dates use the existing strict timestamp validator. Focused changed-file compile and 35/35 contract/storage tests pass; preflight and `validate:full` pass. Local build/typecheck/lint commands cannot resolve absent local TypeScript/ESLint links; local security gate fails only on incomplete dependency license metadata, and no gate was weakened. New exact-head CI and review remain pending.

Next: commit only after fresh `main`/PR/branch verification, non-force push once to existing Draft #2878, and require successor exact-head CI plus fresh non-author review. No Formal Validator, Audit, Release, merge, deployment, or Oracle mutation.

## Exact-head CI repair — unused import, 2026-10-27

Exact-head CI on `3f79b8d1412eade7f566713eefca6d03a5e23de9` reported two failures (`actual-paper-runtime` and `discover-public-research`) from the same strict compile error: after replacing the old chronology helper, its import remained unused. The reported missing artifacts were downstream of that compile failure. Removed only the unused import; focused compile with unused checks, the 35 contract/storage tests, preflight, `validate:full`, and diff-check pass. This local repair is not yet committed or published. Next: refresh base/PR/branch and publish one non-force successor to existing Draft #2878, then verify new exact-head CI and request one fresh non-author review.

## Next permitted action

Refresh GitHub main/PR/branch state, then commit and non-force push only to the existing #2878 branch if it remains canonical and the local diff is as described. Require new exact-head CI/companion evidence and one fresh non-author review. Keep the PR Draft and stop before Formal Validator, Audit, Release authorization, merge, deployment, or runtime acceptance.

## Safety

`PAPER_ONLY`; `liveAuthority=NONE`; `productionMutationAllowed=false`; `realOrderAuthority=false`; `realTransferAuthority=false`; `aiAuthority=ZERO_AUTHORITY`.
