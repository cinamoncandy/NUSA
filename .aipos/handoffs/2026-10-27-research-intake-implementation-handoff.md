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

## Next permitted action

Refresh GitHub main/PR/branch state, then commit and non-force push only to the existing #2878 branch if it remains canonical and the local diff is as described. Require new exact-head CI/companion evidence and one fresh non-author review. Keep the PR Draft and stop before Formal Validator, Audit, Release authorization, merge, deployment, or runtime acceptance.

## Safety

`PAPER_ONLY`; `liveAuthority=NONE`; `productionMutationAllowed=false`; `realOrderAuthority=false`; `realTransferAuthority=false`; `aiAuthority=ZERO_AUTHORITY`.
