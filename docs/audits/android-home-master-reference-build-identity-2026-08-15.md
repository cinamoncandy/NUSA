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

## Latest head successor artifact

The final PR head is `5b40e5fa2e76bfbe2d0bee897e31f75a67623cf1`. Its exact-head Mobile Native run `31891313411` (run `980`) produced:

- Artifact: `nusa-android-rc-5b40e5fa2e76bfbe2d0bee897e31f75a67623cf1-980`
- APK SHA-256: `dab73313681a651d999d700f935aa19d885603b19791a43ca2599906a362d28d`
- Provenance source SHA: `5b40e5fa2e76bfbe2d0bee897e31f75a67623cf1`
- Bundle markers: `NUSA / HOME`, `TOTAL EQUITY`, `AI SIGNAL`, `PAPER · LIVE OFF`, `PAPER 연결 필요`, and `NUSA TERRAIN / STATE TRACE` present; `home-allocation-panel` absent.

## Required checks

All required checks passed on exact head `cabd7a8...`:

- CI: PASS (`31890492398`)
- Mobile Native: PASS (`31890492397`)
- Restricted LIVE Capability Surface Guard: PASS (`31890492399`)
- Restricted LIVE Transport Credential Readiness: PASS (`31890492408`)
- Restricted LIVE Activation Rehearsal: PASS (`31890492393`)
- Read-only Broker Credential Integration: PASS (`31890492439`)

The final head `5b40e5f` also has exact-head CI PASS (`31891313628`) and Mobile Native PASS (`31891313411`). The Restricted LIVE and Read-only Broker workflows do not declare `workflow_dispatch`; GitHub did not create a new `pull_request` run after the documentation/test-only successor commits. Their latest completed PR runs are the prior `cabd7a8` head listed above and are not relabeled as exact `5b40e5f` evidence.

## Physical gate

Physical Android install, launch, and before/after Home screenshots remain `HUMAN_ENVIRONMENT_ONLY_PENDING`. PR #535 remains Draft/HOLD and must not be merged until the screenshot comparison confirms the master-reference acceptance criteria and the remaining exact-head required workflows are independently satisfied.

Safety remains unchanged: `PAPER ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, and `AI ZERO_AUTHORITY/read-only`.
