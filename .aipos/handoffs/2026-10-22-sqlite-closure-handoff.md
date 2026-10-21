# SQLite shared integrity closure repair

PR #2855; base 8174e6241c3558362ab333c0b092337ce4d52bf4.
Reviewed broken head: 378099d0d1d234b375af1699424faac5e718a519.
Source repair and local validation target: 9888a4b3ef1a2c965831bfd1098d94bc2e185501.

Fresh non-author Codex review on 378099d0 reproduced preloading sqliteVerifiedSharedConnection.js, replacing its require.cache exports before the barrel loaded, then constructing both genuine stores with a forged wrapper and a raw unscanned DatabaseSync. Moving the resolver to another module and eager consumer loading only moved the replaceable trust boundary.

Canonical SqliteDatabase full-scan registration and both existing AI-store admission checks now share the index.ts lexical scope. The WeakMap and resolver are not exported, there is no imported registration/verifier capability, and sqliteVerifiedSharedConnection.ts is deleted. Existing AI-store paths re-export the same genuine constructors; their implementations were relocated without changing their schemas, scoped checks, hash-chain replay, ownership, or standalone full scans. Startup ordering remains unchanged.

On source repair 9888a4b3ef1a2c965831bfd1098d94bc2e185501 in the /workspace development container (not Oracle): TypeScript compiler, pnpm typecheck and pnpm build PASS; focused startup/lease/research-recovery 33/33 PASS (12+2+19); AI durability/attribution/migrations 41/41 PASS; architecture runtimeCycles=0/findings=0; validate:full PASS; security:gate PASS (zero unmitigated high/critical, zero secrets); Storybook build PASS; git diff --check PASS. Before repair the new internal-cache exploit test failed with Missing expected exception on 378099d0. Security initially failed on GHSA-f2ph-cmg5-wxc8; the official Storybook patch 8.6.18 -> 8.6.19 closes it with no gate waiver. Electron binary download failed during dependency installation; an install-only retry omitted lifecycle downloads and explicitly ran the repository security backports. No product test was skipped or weakened. GitHub exact-head CI remains required.

Require fresh CI and all five companion workflows on the final pushed successor, then fresh non-author review with no current unresolved P0/P1 and a separate fresh Claude/NUSA Validator with exact SHA, counts and explicit ACCEPTED. Keep Draft until canonical readiness gates. No author approval, Audit, Release, merge or Oracle mutation before acceptance. Source validation binds 9888a4b3ef1a2c965831bfd1098d94bc2e185501; documentation successor is resolved from the current remote PR head, not a self-referential SHA.

All earlier CI/review receipts, including 3fa87132 and 378099d0, are historical for acceptance after this repair. No independent Validator/Audit/Release acceptance is claimed. Oracle was not accessed or mutated in this repair session.

PAPER_ONLY; liveAuthority=NONE; productionMutationAllowed=false; realOrderAuthority=false; realTransferAuthority=false; aiAuthority=ZERO_AUTHORITY; VERIFIED=false.
