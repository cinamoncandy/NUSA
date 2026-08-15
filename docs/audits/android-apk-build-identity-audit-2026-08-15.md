# Android APK Build Identity Audit — PR #535

Date: 2026-08-15

## Scope

Audit only. No UI, product, API, or authority changes were made.

Expected PR head:

`1adb7c635c0561b10c0a9a806adc8ede4ae26bda`

## Evidence

- GitHub Actions Mobile Native run `31888787751` / release candidate run `972` reports `headSha` exactly equal to `1adb7c635c0561b10c0a9a806adc8ede4ae26bda`.
- The workflow checks out `${{ github.event.pull_request.head.sha }}`, verifies `git rev-parse HEAD`, verifies base ancestry, and supplies that SHA as `NUSA_BUILD_SHA` to Gradle.
- Release artifact: `nusa-android-rc-1adb7c635c0561b10c0a9a806adc8ede4ae26bda-972`.
- Artifact provenance reports source SHA `1adb7c635c0561b10c0a9a806adc8ede4ae26bda`.
- APK SHA-256: `0d58b920d667c1e3c60514fa7e034eb522bd161b36212e68b48af72fb795a949`.
- The APK contains `assets/index.android.bundle`.

## Bundle marker result

The release APK bundle contains the new Home markers. Korean strings are stored in the Hermes bundle's UTF-16 string table.

- `NUSA / HOME`: present
- `오늘의 PAPER 상태`: present (UTF-16LE)
- `ACCOUNT EQUITY`: present
- `PAPER · LIVE OFF`: present (UTF-16LE)
- `PAPER 서버 연결이 필요합니다`: absent
- `PAPER 연결`: absent
- `PAPER 준비`: absent
- `AI 신뢰도`: absent

For comparison, the prior APK SHA-256 `599b016482605627038398063103cd807fdc07a85060cac30663825db49fabc7` contains the old connection markers and does not contain the new Home markers.

## Identity from repository build contract

- Application ID: `com.nusa.mobile`.
- For run `972`, Gradle derives `versionCode=972` and `versionName=1.0.972-1adb7c63`.
- Release and debug builds use the repository's `debug.keystore` signing config. Certificate extraction from the APK/device is not locally verified because this environment has neither Android SDK build tools nor `adb`.

## Installation conclusion

The artifact identity and embedded bundle are consistent with PR #535. The observed old Home screen therefore does not demonstrate a stale run 972 bundle; it demonstrates that the device was running a different installed artifact or that the run 972 APK was not successfully installed/replaced/launched.

Installed-package application ID, version, signing certificate, update result, and post-install bundle markers remain unverified because `adb` and a connected Android device are unavailable in this environment.

## Gate

- UI code changes: NONE for this audit.
- PR #535 merge: PROHIBITED.
- Visual acceptance: FAIL / HUMAN_ENVIRONMENT_ONLY pending.
- Required automated checks for head `1adb7c...`: PASS before this audit.
- Safety boundary changes: NONE.
