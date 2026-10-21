# Fresh non-author review handoff

Work order: WO-OPS-20261016-PAPER-WRITER-CAUSE. Branch: codex/paper-writer-lease-cause-20261016. Base: 67630b806996a0774fa41d772e61de6192493a84.

The author repaired first-cause loss in the existing PAPER writer heartbeat and existing runtime-last-failure.json. This does not establish the initiating cause of the actual deployed lease losses. The original outer error, sticky lease loss, SQL ownership/expiry predicate, heartbeat, TTL and takeover policy must remain unchanged. No authority is granted by this handoff.

A separate fresh VALIDATOR must read AGENTS.md, recover AIPOS, and follow docs/GRILL_ME_PROTOCOL.md against the actual final PR head and current main. Review cause retention across heartbeat and subsequent assertions; diagnostic-only read on rejected renewal; bounded causes/SQLite primary errcodes; secret exclusion; cycles/depth bound; existing receipt compatibility; no renewal after loss; and isolated real-SQLite regressions. Record findings bound to exact head. The implementation author must not claim independent PASS, mark Ready, force Audit/Release or merge before that review.

Focused regression: 28/28 PASS, including actual competing SQLite write lock and unchanged ledger/replay/recovery tests. Full strict managed build and root/mobile typecheck PASS; source hashes match for all applicable tracked compilation files. See .aipos/evidence/paper-writer-first-cause-validation-20261016.json for final gates.

Historical baseline code reproduces missing causes; isolated test DB mutation is not runtime canary or useful Autopilot completion. Actual deployed c26 runtime passed release readiness then lost lease repeatedly. A later process returned local/public HTTP200 with 130 fills, 20 periods, zero cycles and zero holdout passes. Long-term runtime continuity remains UNVERIFIED. Partial baseline feedback must not be promoted to a qualified cycle.

After fresh review and exact-head CI, use the existing deterministic Audit and Release bot. Never self-approve/merge. Deploy only the governed exact main through oracle-paper-release.yml; preserve historical failures and wait for natural causal evidence. No synthetic production failure, forced takeover, TTL relaxation, balance reset, or qualification threshold change.

The latest-main rebase preserves EXECUTION provenance while rebinding PAPER_ADAPTER to blob0f5de0d7. Focused rebase validation passes 29/29, including the exact-source guard. This rebase still requires fresh exact-head CI and independent review. Module qualification remains TARGET_ONLY, isLevel10Qualified=false and every independent criterion UNVERIFIED. Review the provenance rebind too; this is no qualification promotion.

## Fresh review receipt and bounded metadata repair

A separate non-author VALIDATOR reviewed head `ba61f9f85bc62e556cb62c9e110c7b6fb2058b26` against base `67630b806996a0774fa41d772e61de6192493a84`. CI run `38924202514` and all required companions passed. Findings were P0=0, P1=0, P2=1: the PR body and committed operator receipts still named the pre-rebase head/run or said CI/review was pending. Code and safety scope passed. Receipt: https://github.com/cinamoncandy/NUSA/pull/2739#issuecomment-6219576287.

This successor changes operator-facing metadata only. It does not change writer behavior, TTL, ownership, takeover, Risk, capital, qualification, or authority, and it does not identify the initiating lease-loss cause. Because this metadata repair creates a new head, fresh exact-head CI and fresh non-author P2 clearance remain mandatory before Ready/Audit/Release.

## 2026-10-18 latest-main reconvergence

The existing PR branch was merged forward to protected main `3659e45e011032b71e37896eed7c3aef2580c153` without rewriting branch history. The only manual merge conflicts were the PAPER_ADAPTER exact-source qualification pin and its regression test. Current main's lifecycle/recovery changes and the writer first-cause diagnostics auto-merged in `paperTradingExecutionLoop.ts`; the resulting canonical Git blob is `1113297fa143b4e26318e3c57152bdf2d620ddb6`. Qualification remains TARGET_ONLY and all independent criteria remain UNVERIFIED; diagnostic provenance stays bound to implementation commit `b9cb7bde15bfa581159f263220a1d113b250dadc`.

Local validation after this merge is fresh: 31/31 focused writer/receipt/exact-source/liveness/auto-recovery/startup-budget tests PASS; root typecheck and build PASS; preflight, validate:full and security gate PASS; lint has zero errors and 26 pre-existing warnings. Latest-main merge implementation commit is `1ae09a01865f4856ae1e1cdb63e8ccc1bd976824`. Historical CI/review receipts must not be reused for the final candidate; the resulting metadata-sync head still requires fresh exact-head CI and a fresh non-author Validator before deterministic Audit/Release. The initiating deployed lease-loss cause remains unproven and must be established only by natural runtime evidence after governed exact-main deployment.
