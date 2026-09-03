# Mobile build identity visibility

Purpose: make stale-installed APKs immediately diagnosable from the mobile UI.

The release pipeline already seals the exact source commit into `apps/mobile/src/generatedBuildConfig.ts` as `BUILD_SOURCE_SHA`. The mobile More workspace now renders the first eight characters of that sealed SHA as `빌드 <sha8>`. Development/unprepared builds render `빌드 dev`.

This is display-only diagnostics. It adds no credential, order, withdrawal, transfer, LIVE, or production-mutation capability.

Safety invariants remain:
- liveAuthority=NONE
- productionMutationAllowed=false
- aiAuthority=ZERO_AUTHORITY
