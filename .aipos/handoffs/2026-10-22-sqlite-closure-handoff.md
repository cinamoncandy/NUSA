# SQLite shared integrity closure repair

PR #2855, branch fix/sqlite-integrity-attestation-2770.
Fresh protected main: 8174e6241c3558362ab333c0b092337ce4d52bf4 (GitHub main and PR base rechecked 2026-10-22 KST).
PR base API snapshot: 8174e6241c3558362ab333c0b092337ce4d52bf4.
Latest source repair recorded in the AIPOS evidence successor: b4968375f160f020534e16c304dd5171c145ad4b.

The previous current-head Codex finding on 09bd6051f09bb3ad0230c1900445d3648d858754 reproduced replacement of DatabaseSync.prototype.prepare after the storage module loaded and before canonical database construction. The fake method returned quick_check=ok; the raw trust registry then admitted both genuine AI stores with only four scoped checks. This was reproduced in a separate local process.

The source repair captures the built-in DatabaseSync.prototype.prepare and Reflect.apply immediately after importing node:sqlite, before any project module imports. Canonical full-file and AI-store scoped integrity PRAGMAs use this private captured method. New regression on the compiled source proves a post-load prototype replacement cannot forge the full scan: forged full calls 0, genuine full checks 1, scoped checks 4. Existing wholesale CommonJS barrel replacement and pre-bootstrap internal cache replacement tests remain.

Local evidence on source repair 17c0a3120123711c8955301e957c4d8a116cff6d:
- pnpm typecheck, pnpm build, pnpm preflight, pnpm run validate:full, pnpm run security:gate, and git diff --check: PASS.
- focused startup/lease/recovery: 34/34 PASS.
- AI calibration/attribution durability: 22/22 PASS.
- AIPOS YAML and architecture drift validators: PASS.
- The security gate generated an SBOM file diff during validation; that generated-only diff was restored.

The earlier exact-head CI and companion workflow receipts on 09bd6051 are historical after this source repair. No formal NUSA Validator, Audit, Release, merge, or Oracle mutation has occurred. Keep the PR Draft. Oracle was not accessed or mutated.

The AIPOS sync is already committed and pushed at PR head c404e3180c722bf6aed6d9922d622a00ea66cded. Fresh exact-head GitHub workflows on c404 are all completed/success: CI 39702093301, Mobile Native 39702093299, PAPER runtime 39702093383, Capability Guard 39702093361, Activation 39702093339, Transport 39702093419, Read-only Broker 39702093302, Android Guard 39702093402. PR #2855 remains OPEN/DRAFT with base=8174e6241c3558362ab333c0b092337ce4d52bf4.

Next: fresh non-author review on exact head c404, independent adjudication of all current review threads, then a separate formal NUSA Validator receipt with exact SHA, P0/P1/P2 counts and explicit ACCEPTED. The current review history only reaches 3eb81c1; current threads include still-unadjudicated whole-module-cache and Research child-heap findings. Any new commit invalidates c404 exact-head receipts. Keep Draft. No Audit/Release/merge/Oracle mutation before Validator acceptance.

Exact-head workflow evidence on c404 is PASS, but review and Validator remain pending. Oracle `/health` and `/ready` were attempted read-only and were blocked by this environment's network policy; Oracle runtime health/source SHA, real PAPER fill/PnL, restart/replay, and learning-cycle continuity remain UNVERIFIED.

Safety remains: PAPER_ONLY; liveAuthority=NONE; productionMutationAllowed=false; realOrderAuthority=false; realTransferAuthority=false; aiAuthority=ZERO_AUTHORITY; VERIFIED=false.
