# Android 1.0.101 release model

The active Android delivery path is:

`DEVELOPMENT → RC → GALAXY PHYSICAL ACCEPTANCE → RELEASE`

The mobile product metadata in `apps/mobile/package.json` is the single source
of truth for product version `1.0.101`. Android derives a deterministic
monotonic versionCode from semver: `major*10,000,000 + minor*100,000 +
patch*10`, reserving the final digit for the channel (`debug=0`, `RC=1`,
`Release=2`). For this release that is RC `10,001,011` and final
`10,001,012`; it is above historical run-number builds and avoids collisions
between a previous final release and the next release candidate.
`NUSA_BUILD_NUMBER` remains independent provenance for a
CI/workflow run and is packaged in BuildConfig and artifact provenance; it does
not become the product patch version or Android versionCode.

RC builds use `NUSA_BUILD_CHANNEL=rc` and carry a version name such as
`1.0.101-rc.<run>`. Final release packaging uses
`NUSA_BUILD_CHANNEL=release` and carries `1.0.101`. Both variants retain the
exact source SHA, package identity `com.nusa.mobile`, APK checksum, and
provenance metadata.

The current repository Gradle configuration uses its existing debug signing
configuration for the release variant. `apksigner` verification proves the APK
is signed and structurally valid, but this change does not claim production-key
signing or public-production readiness.

The canonical workflow is `.github/workflows/android-release.yml`. A normal
main push produces an installable RC candidate; final release packaging is
manual and requires a physical-device acceptance evidence reference. GitHub
Release is canonical. Firebase App Distribution remains optional secondary
distribution and never becomes release authority.

Galaxy acceptance is an external gate: install the exact RC, launch it, verify
session behavior, MARKET/public quotation and chart behavior, capture network
diagnostics on failure, and record the result. CI cannot claim that physical
acceptance occurred.

Historical Preview artifacts, tags, and evidence are preserved as immutable
history. Preview naming is retired for all new Android packaging and release
automation; no historical artifact is deleted or rewritten by this change.

This is a packaging/release-model change only. `liveAuthority=NONE`,
`productionMutationAllowed=false`, and `AI authority=ZERO_AUTHORITY` remain
unchanged. No broker credential, Risk, order, transfer, withdrawal, or trading
authority is added.
