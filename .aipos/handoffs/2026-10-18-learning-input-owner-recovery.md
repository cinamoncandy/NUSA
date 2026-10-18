# Learning input owner recovery

Canonical PR: #2792 (`feat/learning-input-set-a2`), base `3659e45e011032b71e37896eed7c3aef2580c153`. This change is based on its current head `65a4db2620a799f696c52449c3c2cf451647d98f`; the separate `repair-2792-reconverge` worktree remains untouched.

## Production source findings

- Lane A Research decisions are durably recorded in `research_factory_decision_history`; `SqliteResearchFactoryDecisionHistoryRepository.list()` verifies the full hash chain and metadata before returning records.
- Lane B realized PAPER periods are read through the canonical production period reader; the evidence timestamp is the persisted `periodEndAt`.
- The existing `learningEvidenceAuthority` on the closed-learning coordinator reads a different Research evaluation ledger and is not the A2 canonical Research decision source.
- The production composition now exposes a separate `learningInputSetEvidenceAuthority` backed by the durable Research decision history and realized-period ledger. A2 construction/append is not yet wired.

## Verification on the local PR-head worktree

- New canonical Research evidence read-back test covers exact timestamp, ghost ID, and corrupted-chain fail-closed behavior: 4/4 history tests PASS.
- Typecheck, build, `validate:full`, safety invariants, and `git diff --check` PASS.
- Implementation commit `5d780808f2f8d948299064abe0b1460a72c88a50`; exact-head CI run `39119847026` PASS.
- Current A2 contract correction removes META partition membership from the input-set fingerprint and rejects stale callers that still supply it; A2/retention focused tests 19/19 PASS, typecheck/build PASS, full isolated suite 1,245/1,245 PASS, `validate:full`, `security:gate`, AIPOS provenance, and preflight PASS. Lint PASS with 26 existing warnings.
- Independent Audit, Release, merge, and runtime acceptance have not run; PR remains Draft.

## FIRST_BROKEN_TRANSITION

`canonical LearningInputSet owner inputs (cutoff + policy identities) → A2 durable receipt → A1 Decision → A3 durable META assignment → A4 eligibility`

The confirmed A2 contract contains evidence, cutoff and policy identities; it does not contain A3 partition membership. Binding META membership into A2 would create a cycle because A3 assignment also requires the A1 Decision fingerprint derived from A2. A2 now rejects that field, preserving the acyclic order above. The canonical closed-window boundary exists as durable PAPER `periodEndAt`, but it is not yet wired into A2. No canonical owner for all four policy identities or caller-independent META cycle-order allocator is production-wired. Do not invent values, use `Date.now`/maximum evidence time, or promote test fixtures to production authority. Preserve strict `recordedAt < cutoff`.

Next: bind the durable closed-window boundary and exact policy identities into A2, append/read back the receipt, bind A1 to that receipt, then assign A3 from canonical cycle order. Keep PR Draft; no Audit, Release, merge, or runtime acceptance until its gates pass.

`PAPER_ONLY`; `liveAuthority=NONE`; `productionMutationAllowed=false`; `aiAuthority=ZERO_AUTHORITY`. `LEARNING_LOOP_VERIFIED=false`; `PERFORMANCE_IMPROVEMENT=UNPROVEN`.
