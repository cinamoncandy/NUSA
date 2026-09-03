# NUSA Functional Gap Analysis

Audited commit: 8468cb3bd404979cd9cead998f9e4bfad6c7e800
Branch: agent/mobile-first-ui-v1
PR: 45 (Draft)

## Capability classification

| Capability | Status | Highest gap | Release impact |
|---|---|---|---|
| Core runtime | VERIFIED_COMPLETE | none observed | critical |
| Upbit public market data | IMPLEMENTED_UNVERIFIED | real external runtime evidence | critical |
| Paper execution | VERIFIED_COMPLETE | none observed | critical |
| Accounting and PnL | VERIFIED_COMPLETE | none observed | critical |
| Persistence and recovery | VERIFIED_COMPLETE | none observed | critical |
| Risk and kill switch | VERIFIED_COMPLETE | none observed | critical |
| SMA strategy routing | IMPLEMENTED_UNVERIFIED | long-running runtime evidence | required |
| Evidence and diagnostics | VERIFIED_COMPLETE | none observed | required |
| Functional renderer | PARTIAL | Electron GUI smoke | required |
| Windows packaging | IMPLEMENTED_UNVERIFIED | installer build and install smoke | required |
| Live trading | OUT_OF_SCOPE | prohibited by safety policy | excluded |

## Selected mission

Mission ID: GAP-001-electron-release-smoke
Priority: P1 release verification
Title: Verify Electron launch and Windows package smoke for the functional Paper shell

Reason selected: the functional renderer and package capabilities are wired and tested, but the highest-value remaining gap is runtime evidence at the actual Electron boundary. This unlocks release confidence without changing trading logic, IPC contracts, or visual scope.

Acceptance criteria:

- Electron launches from the current build.
- Paper mode and connection status are visible.
- Existing functional navigation remains usable.
- No live/private mutation or credential UI is exposed.
- package:validate remains PASS.
- package:win result is recorded truthfully, or marked UNVERIFIED when the Windows environment cannot execute it.

Files: apps/desktop/renderer, apps/desktop/src, package.json, generated release output only.
Focused tests: renderer bootstrap and mobile UI tests.
Integration tests: Electron launch smoke and package validation.
Regression tests: full test suite only at the release gate.
Recovery tests: existing recovery suite; no recovery behavior change.
Verification: pnpm run release:check with CI=true PASS; package:validate PASS; package:win reached win-unpacked then failed with EACCES on external HTTPS download; PR CI still pending.
Rollback: revert the functional UI commit and retain the legacy renderer compatibility surface.
Expected commit: test(release): verify electron and package smoke
Expected PR: update PR #45; do not create a new PR.
Expected next mission: run safe read-only Upbit runtime and prepare separate Shadow evidence.

## Scoring

Mission score = release impact + dependency unlock + safety gain + verification gain - implementation cost - regression risk - agent cost.

- GAP-001 Electron/package smoke: 5 + 4 + 2 + 3 - 2 - 2 - 1 = 9
- Real Upbit runtime: 4 + 1 + 1 + 3 - 3 - 3 - 3 = 0; external runtime evidence is deferred until the local release boundary is verified.
- Visual redesign: 1 + 0 + 0 + 0 - 4 - 2 - 3 = -8; explicitly deferred.

No implementation gap outranks the selected verification mission without changing scope.
