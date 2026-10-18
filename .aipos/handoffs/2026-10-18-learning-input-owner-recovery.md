# Learning Loop recovery and convergence state

Fresh GitHub snapshot, 2026-10-18: protected `main` is `3659e45e011032b71e37896eed7c3aef2580c153`.

## Canonical A2

PR #2792 is OPEN/Draft, base `main` at the SHA above, head `65a4db2620a799f696c52449c3c2cf451647d98f`. Exact-head CI and companion PAPER/readiness/restricted-surface checks PASS (CI run `39122108680`; companion runs `39122108628`, `39122108609`, `39122108667`, `39122108595`, `39122108679`). Audit fallback was SKIPPED; this is not Audit or Release evidence.

The production composition exposes `learningInputSetEvidenceAuthority` readers for durable Research history and realized PAPER periods. It does not construct or append A2 input sets in the production caller graph. A2 accepts caller-supplied cutoff and META identity; no canonical cutoff owner or partition assignment owner was found. Preserve strict `recordedAt < cutoff`. Do not derive policy from `Date.now`, maximum evidence timestamp, or caller input.

## Stack snapshot and stale evidence

All listed PRs are OPEN/Draft. Exact-head CI evidence does not override stale base identity or conflicts.

| PR | Base SHA | Head SHA | Current finding |
|---|---|---|---|
| #2793 | `c7bcdd21` | `388e4b36` | Base is older than #2792 head `65a4db26`; its CI is not evidence for current stacked identity. |
| #2794 | `388e4b36` | `1036b53b` | Parent identity matches #2793 head; prior CI only. |
| #2795 | `1036b53b` | `da2033ba` | Parent identity matches #2794 head; exact-tree CI run `39124665789` PASS; independent review absent. |
| #2796 | `ba0ac079` | `5e336429` | Base stale versus #2795 head; GitHub reports CONFLICTING. |
| #2797 | `5e336429` | `5d2b3be6` | Stacked on #2796; exact-head full CI not established in current snapshot. |
| #2798 | `5d2b3be6` | `8f07be1e` | Stacked; exact-head full CI not established in current snapshot. |
| #2799 | `8f07be1e` | `548a92ff` | Prior exact-head CI PASS; base must be re-evaluated after predecessor convergence. |
| #2800 | `b2b8a172` | `c61861e0` | Base stale versus #2799 head; GitHub reports CONFLICTING. |

## A3 replay repair in progress

The #2795 source called the single-use holdout claim path again when the same assignment already existed. A restarted replay therefore rejected its own prior holdout claim. A local fix now validates the deterministic assignment fingerprint against the durable receipt and requires the corresponding holdout key still be durably used, without issuing a second claim. A file-backed SQLite regression covers restart, exact replay, no duplicate assignment, and changed-key rejection.

Focused A3 tests: 17/17 PASS. Full `pnpm test` with Git Bash on PATH: 1,248 isolated test files PASS after an initial environment-only `spawnSync bash ENOENT`; no test assertions were relaxed. Build, typecheck, `validate:full`, security gate, AIPOS YAML/provenance, and lint completed PASS (lint retains 26 existing warnings). Exact-tree workflow-dispatch CI run `39124665789` completed SUCCESS on `da2033ba8c939ba837e167cbab6ccf2b1fbcdfbc`, including validation and aggregate coverage. Because #2795 is stacked, this is not a PR-required check and is not Audit/Release evidence. No independent review is recorded.

Read-only A4 caller search found no production caller of `applyBoundedChange` or `MetaOosLedger.eligibility`; A4 still accepts caller-provided eligibility and A3 accepts caller-provided partition. Existing components/ledgers therefore do not prove a production A3→A4 authority path. Do not wire eligibility until canonical owners are resolved.

This change does not establish policy authority or wire A2→A1→A3→A4 into production. Do not mark the Learning Loop verified. Keep PR Draft; do not Audit/Release/merge while cutoff/META owners are unresolved or downstream stack identities are stale.

## Current blockers and safety

- `BLOCKED_LEARNING_CUTOFF_OWNER_UNDEFINED_OR_UNVERIFIED`
- `BLOCKED_META_PARTITION_POLICY_UNDEFINED`
- Next canonical transition: obtain approved canonical, versioned, replay-stable cutoff and META assignment authorities; then wire production A2→A1→A3→A4 and revalidate the stacked PRs bottom-up. #2795 also needs fresh independent review before any readiness transition.
- Preserve `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, and `aiAuthority=ZERO_AUTHORITY`.
- `LEARNING_LOOP_VERIFIED=false`; `PERFORMANCE_IMPROVEMENT=UNPROVEN`; `AUTOPILOT_VERIFIED_COMPLETION_LOOP=false`.
