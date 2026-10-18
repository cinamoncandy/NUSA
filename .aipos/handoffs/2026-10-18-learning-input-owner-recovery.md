# Learning input owner recovery

Canonical PR: #2792 (`feat/learning-input-set-a2`), base `3659e45e011032b71e37896eed7c3aef2580c153`. At inspection the PR head was `c7bcdd21bee230fdaa988b1f6187e3d6aaea8ed5`, OPEN/Draft, with exact-head CI PASS. The local `repair-2792-reconverge` worktree remains untouched.

## Production source findings

- Lane A Research decisions are durably recorded in `research_factory_decision_history`; `SqliteResearchFactoryDecisionHistoryRepository.list()` verifies the full hash chain and metadata before returning records.
- Lane B realized PAPER periods are read through the canonical production period reader; the evidence timestamp is the persisted `periodEndAt`.
- The existing `learningEvidenceAuthority` on the closed-learning coordinator reads a different Research evaluation ledger and is not the A2 canonical Research decision source.
- The production composition now exposes a separate `learningInputSetEvidenceAuthority` backed by the durable Research decision history and realized-period ledger. A2 construction/append is not yet wired.

## Verification on the local PR-head worktree

- New canonical Research evidence read-back test covers exact timestamp, ghost ID, and corrupted-chain fail-closed behavior: 4/4 history tests PASS.
- Typecheck, build, `validate:full`, safety invariants, and `git diff --check` PASS.
- Implementation commit `5d780808f2f8d948299064abe0b1460a72c88a50`; exact-head CI run `39119847026` PASS.
- Independent Audit, Release, merge, and runtime acceptance have not run; PR remains Draft.

## FIRST_BROKEN_TRANSITION

`canonical LearningInputSet owner inputs (cutoff + policy identities + META assignment) → A2 build → durable LearningInputSetLedger receipt`

The confirmed design defines the closed-window cutoff concept, and the production sources for Research/PAPER evidence are now exposed. No canonical owner for `learningPolicyVersion` or caller-independent META partition assignment/policy was found. Do not invent values, use `Date.now`/maximum evidence time, or promote test fixtures to production authority. Preserve strict `recordedAt < cutoff`.

Next: trace and bind existing cutoff/policy owners; then construct A2 only from their exact values, append and read back the durable receipt, and bind A1 to that receipt. Keep PR Draft; no Audit, Release, merge, or runtime acceptance until its gates pass.

`PAPER_ONLY`; `liveAuthority=NONE`; `productionMutationAllowed=false`; `aiAuthority=ZERO_AUTHORITY`. `LEARNING_LOOP_VERIFIED=false`; `PERFORMANCE_IMPROVEMENT=UNPROVEN`.
