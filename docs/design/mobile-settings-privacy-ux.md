# Mobile Settings Privacy UX

Status: implementation-ready Designer specification

## Goal
Expose the existing `settings.usageTelemetry.enabled` preference in Mobile Settings without inventing consent, enabling telemetry by default, or changing authority/trading behavior.

## Placement and copy
Add a new section immediately after **04 · APPEARANCE** and before **SAFETY & AUTHORITY**. Title: **사용 데이터 공유**. Status chip: **꺼짐** when disabled, **켜짐** when enabled.

Disabled copy: `사용성 개선을 위한 진단 이벤트 공유가 꺼져 있습니다. 거래 내용이나 인증 토큰을 공유하도록 이 설정이 권한을 확장하지 않습니다.`

Enabled copy: `사용성 개선을 위한 진단 이벤트 공유가 켜져 있습니다. 언제든 다시 끌 수 있습니다.`

Use an explicit two-state segmented control:
- `OFF` → `공유 안 함`
- `ON` → `공유`

## Interaction
Persist through the existing `SettingsRepository` path and update only `usageTelemetry.enabled`. Disable the control during save. On persistence failure, preserve or restore the previous visible selection and surface the existing settings save error.

## Accessibility
The control must expose a text label and selected state, retain at least a 44x44pt touch target, and never rely on color alone. Explanatory copy remains visible without hover/long-press. Save failures should reuse the existing error notice rather than adding a noisy announcement loop.

## Responsive acceptance
At phone widths, labels may wrap but must not clip. No horizontal scrolling. Long Korean copy wraps naturally. The control remains operable with large text scaling.

## Safety invariants
Presentation/settings consent only. Do not modify broker behavior, execution authority, risk gates, credentials, LIVE activation, or production mutation behavior. `liveAuthority=NONE`, `productionMutationAllowed=false`, and AI `ZERO_AUTHORITY` remain unchanged.

## Acceptance checks
1. Existing users with no persisted telemetry field render **꺼짐**.
2. Enabling writes only `usageTelemetry.enabled=true` through the existing settings repository.
3. Disabling writes only `usageTelemetry.enabled=false`.
4. Reset Settings returns the preference to disabled via `DEFAULT_SETTINGS`.
5. Save failure does not leave a false persisted opt-in state.
6. Copy never implies telemetry is required for LOCAL PAPER, Cloud PAPER, or account connection.
7. Screen remains usable at phone width and with large text.
