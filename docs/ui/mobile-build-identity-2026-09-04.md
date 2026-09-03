# Mobile build identity and stale-install prevention

NUSA Android stable packaging seals the exact source commit into `apps/mobile/src/generatedBuildConfig.ts` as `BUILD_SOURCE_SHA`.

The mobile More workspace exposes the first eight characters of that exact packaged SHA so the installed APK can be identified without external tooling. Release builds show `빌드 <sha8>`; unprepared development builds show `빌드 dev`.

The installed app also checks the public `nusa-android` stable release metadata. If the release target differs from its packaged `BUILD_SOURCE_SHA`, it shows `업데이트 필요` and offers the canonical stable APK download action. Lookup failures do not fabricate freshness; the exact local build identity remains visible.

Repository-side convergence is enforced independently: the Android stable trigger and watchdog only accept `nusa-android.targetCommitish == protected main` as converged. A stale release target is dispatched or retried toward exact main after exact-main CI succeeds; path-diff based stale-release bypasses are prohibited by regression tests.

This is diagnostics and deployment-governance only. It does not change trading authority, credentials, broker mutation, LIVE activation, withdrawals, transfers, or order capability. `liveAuthority=NONE`, `productionMutationAllowed=false`, and `aiAuthority=ZERO_AUTHORITY` remain unchanged.
