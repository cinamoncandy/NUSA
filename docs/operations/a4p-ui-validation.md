# A4P UI Validation

## Captures

The captures in `docs/artifacts/a4p/` were produced by launching the Electron app with
Playwright and GPU disabled. `dashboard.png` and the `dashboard-1280x720.png` /
`dashboard-1920x1080.png` variants are real renderer captures. The named state captures
(`shadow-running`, `market-reconnecting`, `shadow-completed`, `recovery-required`,
`reconciliation-matched`, `reconciliation-mismatched`, `evidence`, `settings`, and
`about`) are visual fixture captures with a non-production label; no Shadow start,
order, private API, credential, or state-changing IPC call was made.

## Resolution review

- 1280x720: Electron renderer launched and dashboard capture completed.
- 1440x900: Electron renderer launched and state fixture captures completed.
- 1920x1080: Electron renderer launched and dashboard capture completed.

The captures are visual review artifacts, not evidence of a live Shadow session.

## Accessibility contract

Automated repository tests cover accessible navigation labels, real button names,
disabled controls, `focus-visible`, reduced-motion rules, non-color status language,
and long-value wrapping/copy affordances. A full axe scan was not added because the
repository does not currently include axe; Electron launch and visual capture were
available, but screen-reader behavior remains a manual Windows verification item.

## Packaging

`pnpm run package:validate` passes. `pnpm run package:win` reaches unpacked Windows
packaging and writes the installer artifact, but exits non-zero in this environment when
electron-builder spawns its NSIS uninstaller helper (`spawn UNKNOWN`). This is an
environment/tooling limitation, not a claim of a successful release build.
