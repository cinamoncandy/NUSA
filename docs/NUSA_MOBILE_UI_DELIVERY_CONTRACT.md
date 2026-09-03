# NUSA Mobile UI Delivery Contract

## Purpose

This contract prevents a mobile UI change from being confused with a delivered Android UI.
A branch, mockup, source edit, successful build, merged commit, stable release, and installed APK are different states and must never be reported as if they were interchangeable.

This contract is subordinate to the NUSA constitution, AIPOS, `AGENTS.md`, and the CORE master operating instructions. It changes no trading authority.

## Canonical delivery states

Every mobile UI task must be classified using exactly one highest verified state:

1. `SOURCE_ONLY`
   - The visual change exists only on a feature branch or unmerged commit.
   - It is not applied to protected `main`.
   - It is not in the stable APK.
   - It must not be described as applied, deployed, shipped, installed, or visible on the owner's phone.

2. `MAIN_INTEGRATED`
   - The exact visual change is present in protected `main`.
   - Stable Android delivery is not yet proven.
   - It may be described as merged/integrated, but not as shipped or installed.

3. `STABLE_RELEASED`
   - `nusa-android.target_commitish` exactly equals the current protected `main` SHA.
   - The stable APK provenance is bound to that same source SHA.
   - The stable release is current, but the owner's installed APK is not yet proven current.

4. `DEVICE_VERIFIED`
   - The installed app exposes `BUILD_SOURCE_SHA` and that SHA equals the current stable release target.
   - The app exposes the active UI preset and it is the canonical preset for that release.
   - Physical visual acceptance remains `HUMAN_ENVIRONMENT_ONLY` when direct device inspection is unavailable.

## Reporting rule

A mobile UI task is never complete merely because source code exists or a branch was created.

Before saying that the UI "changed", "was applied", "was deployed", "shipped", or "is on the phone", verify the corresponding delivery state above. If device state cannot be inspected, stop at `STABLE_RELEASED` and explicitly say `DEVICE_NOT_VERIFIED`.

## Release convergence invariant

Android stable delivery must converge on exact protected `main`.

- The stable watchdog must not accept path-diff equivalence as convergence.
- A stale stable target must be retried only with bounded recovery.
- The stable release must remain fail-closed when exact-main CI is not successful.
- Release provenance must identify the exact source SHA used to build the APK.

## Installed-build identity invariant

The mobile app must expose its packaged build identity and stale-install status.

- Release builds show the exact packaged `BUILD_SOURCE_SHA` in shortened form.
- If the installed build differs from the canonical stable target, the UI shows `업데이트 필요` and exposes the canonical stable APK action.
- Lookup failure must never fabricate freshness.

## Visual preset convergence invariant

A stale local design preset must not mask the canonical design of a newly installed release.

The design-preset storage schema is therefore bound to the packaged release `BUILD_SOURCE_SHA`. When a new stable APK is installed, the build identity changes, the old preset schema becomes stale, and the app resets to the canonical `master` preset before persisting the new schema. Development builds use a separate deterministic development schema.

This intentionally prioritizes a truthful canonical release appearance over preserving obsolete internal visual presets. The preset is not trading authority and does not alter account, order, risk, credential, or LIVE state.

## Required verification for UI delivery work

Before closing or reporting a mobile UI delivery task as complete, verify as applicable:

- exact feature/head commit containing the visual change;
- presence of that change in protected `main`;
- exact-main CI success for the integrated source;
- `nusa-android.target_commitish == protected main`;
- release provenance source SHA equals protected `main`;
- installed build label equals stable source SHA when device evidence is available;
- active UI preset is the canonical release preset;
- safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.

## Failure classification

Use these classifications instead of a generic "UI did not update":

- `SOURCE_NOT_IN_MAIN`
- `STABLE_BEHIND_MAIN`
- `INSTALLED_BUILD_STALE`
- `VISUAL_PRESET_STALE`
- `DEVICE_NOT_VERIFIED`
- `VISUAL_REGRESSION`

The first matching root cause should be repaired without weakening release, safety, or provenance checks.
