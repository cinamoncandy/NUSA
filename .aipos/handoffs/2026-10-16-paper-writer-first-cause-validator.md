# Fresh non-author review handoff

Work order: WO-OPS-20261016-PAPER-WRITER-CAUSE. Branch: codex/paper-writer-lease-cause-20261016. Base: 67630b806996a0774fa41d772e61de6192493a84.

The author repaired first-cause loss in the existing PAPER writer heartbeat and existing runtime-last-failure.json. This does not establish the initiating cause of the actual deployed lease losses. The original outer error, sticky lease loss, SQL ownership/expiry predicate, heartbeat, TTL and takeover policy must remain unchanged. No authority is granted by this handoff.

A separate fresh VALIDATOR must read AGENTS.md, recover AIPOS, and follow docs/GRILL_ME_PROTOCOL.md against the actual final PR head and current main. Review cause retention across heartbeat and subsequent assertions; diagnostic-only read on rejected renewal; bounded causes/SQLite primary errcodes; secret exclusion; cycles/depth bound; existing receipt compatibility; no renewal after loss; and isolated real-SQLite regressions. Record findings bound to exact head. The implementation author must not claim independent PASS, mark Ready, force Audit/Release or merge before that review.

Focused regression: 28/28 PASS, including actual competing SQLite write lock and unchanged ledger/replay/recovery tests. Full strict managed build and root/mobile typecheck PASS; source hashes match for all applicable tracked compilation files. See .aipos/evidence/paper-writer-first-cause-validation-20261016.json for final gates.

Historical baseline code reproduces missing causes; isolated test DB mutation is not runtime canary or useful Autopilot completion. Actual deployed c26 runtime passed release readiness then lost lease repeatedly. A later process returned local/public HTTP200 with 130 fills, 20 periods, zero cycles and zero holdout passes. Long-term runtime continuity remains UNVERIFIED. Partial baseline feedback must not be promoted to a qualified cycle.

After fresh review and exact-head CI, use the existing deterministic Audit and Release bot. Never self-approve/merge. Deploy only the governed exact main through oracle-paper-release.yml; preserve historical failures and wait for natural causal evidence. No synthetic production failure, forced takeover, TTL relaxation, balance reset, or qualification threshold change.

The latest-main rebase preserves EXECUTION provenance while rebinding PAPER_ADAPTER to blob0f5de0d7. Focused rebase validation passes 29/29, including the exact-source guard. This rebase still requires fresh exact-head CI and independent review. Module qualification remains TARGET_ONLY, isLevel10Qualified=false and every independent criterion UNVERIFIED. Review the provenance rebind too; this is no qualification promotion.
