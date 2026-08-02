# NUSA Mobile Release Candidate

## Scope

This checklist validates unsigned Android and iOS simulator Release candidates.
Store signing, device installation, and store submission remain external gates.

## Required evidence

- [ ] Frozen dependency install and lockfile verification
- [ ] Security and license gate
- [ ] Typecheck, lint, build, and full test suite
- [ ] Foundation smoke test
- [ ] Android `assembleRelease`
- [ ] iOS simulator Release `xcodebuild` with signing disabled
- [ ] Paper-only safety configuration remains enabled
- [ ] Exact commit SHA and workflow run URLs recorded

## Safety boundary

`productionMutationAllowed=false` remains required. No API keys, store signing
assets, or live trading credentials belong in the repository or CI logs.

## External blockers

Signed Android APK/AAB, signed iOS archive, device validation, and store
submission require approved platform credentials and are not represented by an
unsigned candidate build.
