# SQLite shared integrity closure repair

PR #2855, branch fix/sqlite-integrity-attestation-2770.
Fresh protected main: 0e04ff50afa87b57e611f54bec528abe2cf9dc8d.
PR base API snapshot: 8174e6241c3558362ab333c0b092337ce4d52bf4.
Current source repair before AIPOS evidence successor: 17c0a3120123711c8955301e957c4d8a116cff6d.

The previous current-head Codex finding on 09bd6051f09bb3ad0230c1900445d3648d858754 reproduced replacement of DatabaseSync.prototype.prepare after the storage module loaded and before canonical database construction. The fake method returned quick_check=ok; the raw trust registry then admitted both genuine AI stores with only four scoped checks. This was reproduced in a separate local process.

The source repair captures the built-in DatabaseSync.prototype.prepare and Reflect.apply immediately after importing node:sqlite, before any project module imports. Canonical full-file and AI-store scoped integrity PRAGMAs use this private captured method. New regression on the compiled source proves a post-load prototype replacement cannot forge the full scan: forged full calls 0, genuine full checks 1, scoped checks 4. Existing wholesale CommonJS barrel replacement and pre-bootstrap internal cache replacement tests remain.

Local evidence on source repair 17c0a3120123711c8955301e957c4d8a116cff6d:
- pnpm typecheck, pnpm build, pnpm preflight, pnpm run validate:full, pnpm run security:gate, and git diff --check: PASS.
- focused startup/lease/recovery: 34/34 PASS.
- AI calibration/attribution durability: 22/22 PASS.
- AIPOS YAML and architecture drift validators: PASS.
- The security gate generated an SBOM file diff during validation; that generated-only diff was restored.

The earlier exact-head CI and companion workflow receipts on 09bd6051 are historical after this source repair. No formal NUSA Validator, Audit, Release, merge, or Oracle mutation has occurred. Keep the PR Draft. Oracle was not accessed or mutated.

Next: commit the AIPOS/handoff evidence successor, push the existing branch normally, refresh PR metadata without a source-only status commit, then require exact-head CI and all five companions, fresh non-author review, and a separate formal NUSA Validator receipt with exact SHA, P0/P1/P2 counts and explicit ACCEPTED. Only after acceptance may Audit/Release proceed.

Safety remains: PAPER_ONLY; liveAuthority=NONE; productionMutationAllowed=false; realOrderAuthority=false; realTransferAuthority=false; aiAuthority=ZERO_AUTHORITY; VERIFIED=false.
