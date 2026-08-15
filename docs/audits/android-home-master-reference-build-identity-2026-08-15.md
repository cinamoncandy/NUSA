# Android Home master-reference build identity — 2026-08-15

## Scope

PR #535 was rebuilt as a Home-only visual implementation from the master visual reference. This audit proves the exact-head Android release candidate contains the new Home composition; it does not claim physical-device installation or visual acceptance.

## Exact source and artifact

- Repository: `cinamoncandy/NUSA`
- PR: `535` (Draft/HOLD)
- Source head: `cabd7a83eb02df30f67f929815ccee6ca606e7ed`
- Mobile Native workflow run: `31890492397`
- Run number: `977`
- Artifact: `nusa-android-rc-cabd7a83eb02df30f67f929815ccee6ca606e7ed-977`
- APK: `app-release.apk`
- APK SHA-256: `5615bb2ccfb0640435e10bbc2e0e1c465babf6c82764f72c24cd00309de8b0be`
- Provenance source SHA: `cabd7a83eb02df30f67f929815ccee6ca606e7ed`

## Bundle marker verification

The APK `assets/index.android.bundle` contains the Home markers:

- `NUSA / HOME`: present
- `TOTAL EQUITY`: present
- `AI SIGNAL`: present
- `PAPER · LIVE OFF`: present
- `PAPER 연결 필요`: present
- `NUSA TERRAIN / STATE TRACE`: present
- `home-allocation-panel`: absent

This proves source-to-bundle identity for the new Home composition. It does not prove that a physical device installed or launched this APK.

## Required checks

All required checks passed on exact head `cabd7a8...`:

- CI: PASS (`31890492398`)
- Mobile Native: PASS (`31890492397`)
- Restricted LIVE Capability Surface Guard: PASS (`31890492399`)
- Restricted LIVE Transport Credential Readiness: PASS (`31890492408`)
- Restricted LIVE Activation Rehearsal: PASS (`31890492393`)
- Read-only Broker Credential Integration: PASS (`31890492439`)

## Physical gate

Physical Android install, launch, and before/after Home screenshots remain `HUMAN_ENVIRONMENT_ONLY_PENDING`. PR #535 remains Draft/HOLD and must not be merged until the screenshot comparison confirms the master-reference acceptance criteria.

Safety remains unchanged: `PAPER ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, and `AI ZERO_AUTHORITY/read-only`.
