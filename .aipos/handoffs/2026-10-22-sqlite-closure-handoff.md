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

The AIPOS sync was committed/pushed at c404e3180c722bf6aed6d9922d622a00ea66cded; all eight exact-head workflows there completed/success. Fresh review of fedb934b787af7fdc63ec80f44aa52bc18032a3b found P1s: mutable CommonJS Module._load could substitute the integrity boundary; AIPOS current-head evidence was stale. All nine fedb runs later completed/success. A local repair pins Module._load before application code and regression-tests rejection of a corrupt database under loader-replacement attempts; build, focused 40/40, validate:full, and AIPOS provenance pass. Candidate security gate remains unverified because package audit is unavailable. fedb is only the finding head; resolve current branch ref from GitHub. PR #2855 remained OPEN/DRAFT with protected main/base 8174e6241c3558362ab333c0b092337ce4d52bf4.

Next: retry security:gate when package audit is available, recheck protected main and current PR branch ref, then commit/push the local repair as a normal fast-forward. Resolve current head dynamically from GitHub; preserve fedb only as the review-finding head. Then obtain all exact-head workflows, fresh non-author adjudication of every finding, and separate formal NUSA Validator. Any successor commit invalidates previous exact-head receipts. Keep Draft; no Audit/Release/merge/Oracle mutation before Validator acceptance.

Exact-head workflow evidence on c404 is PASS, but review and Validator remain pending. Oracle `/health` and `/ready` were attempted read-only and were blocked by this environment's network policy; Oracle runtime health/source SHA, real PAPER fill/PnL, restart/replay, and learning-cycle continuity remain UNVERIFIED.

Safety remains: PAPER_ONLY; liveAuthority=NONE; productionMutationAllowed=false; realOrderAuthority=false; realTransferAuthority=false; aiAuthority=ZERO_AUTHORITY; VERIFIED=false.
