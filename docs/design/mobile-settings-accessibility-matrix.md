# Mobile Settings Accessibility Matrix

Scope: `apps/mobile/src/settingsView.tsx` presentation only.

## Required states

| Area | Current/normal | Busy | Error | Disabled/restricted |
| --- | --- | --- | --- | --- |
| Theme | selected item announced | control disabled | save error visible | no color-only meaning |
| Capital allocation | percent and amounts readable | controls disabled | invalid/save error visible | 0% clearly explained |
| Cloud PAPER | status text + chip | `확인 중` text | error notice | optional state remains neutral |
| Safety | PAPER-only copy visible | n/a | n/a | LIVE/prod mutation shown as unavailable, not success |
| Usage telemetry | `꺼짐/켜짐` text + selected state | control disabled while saving | save error + previous state restored | default off, no silent opt-in |

## Touch and focus

- All actionable controls target at least 44x44pt.
- Text labels remain adjacent to controls and do not depend on iconography.
- Keyboard/focus order follows visual order when a hardware keyboard or accessibility navigation is used.
- Destructive actions such as reset remain visually and semantically distinct from normal settings.

## Text scaling

Verify at increased font scaling:
- section headings wrap without overlap;
- status chips do not obscure titles;
- segmented-control labels remain understandable;
- amount rows can wrap or stack rather than clip;
- long security/privacy explanations remain fully readable.

## Color independence

Every success/warning/danger/neutral state must retain a textual label. Restricted authority must remain neutral/informational; absence of LIVE authority is not a positive success state.

## Motion and announcements

Settings should not introduce decorative motion required for comprehension. Async save/connection states should use stable visible text. Avoid repeatedly announcing high-frequency state changes.

## Mobile regression checklist

1. 320-360pt width: no horizontal clipping.
2. 200% text scaling: headings/status/actions remain discoverable.
3. Busy state: duplicate save/connect actions unavailable.
4. Error state: recovery path stays visible.
5. Reset: telemetry returns off and theme/settings defaults restore coherently.
6. Safety section: `PAPER ONLY`, LIVE unavailable, production mutation unavailable remain explicit.
