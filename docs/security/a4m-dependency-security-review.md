# A4M Dependency Security Review

Date: 2026-07-29

## Scope and source of truth

The repository uses `pnpm@11.7.0` and tracks `pnpm-lock.yaml`; it does not track an npm
lockfile. `npm audit` was executed as requested and returned `ENOLOCK`, so its result cannot be
treated as an audit of this repository. The authoritative result for the installed dependency
graph is `pnpm audit --json` against the existing pnpm lockfile.

The initial pnpm advisory summary was 0 informational, 4 low, 14 moderate, 19 high, and 2
critical findings. After the runtime-only updates in this branch, `pnpm audit --json` reports
0 informational, 2 low, 8 moderate, 14 high, and 2 critical findings. The report is not a claim
that all findings are reachable from the shipped app: the remaining graph is overwhelmingly
build, test, browser-fixture, or packaging tooling.

## Impact classification

| Area | Examples | Classification | Action |
| --- | --- | --- | --- |
| Playwright browser download | `@playwright/test` 1.52.0 | development/test only | Deferred; upgrade with browser and CI compatibility test |
| Storybook manager/dev server | Storybook 8.6.14 | development only | Deferred; not shipped by `package:win` |
| Vitest UI server | Vitest 3.2.4 | development/test only | Deferred; UI server is not enabled in production |
| Electron advisories | Electron 39.8.1 | packaged runtime framework | Updated within major 39; current Electron advisories are cleared |
| `tar`, `brace-expansion` | transitive under electron-builder | packaging/build only | Deferred; upgrade electron-builder in a dedicated compatibility change |
| `ws` | direct public market WebSocket runtime | production runtime | Updated from 8.18.3 to 8.21.0 within major 8; the root runtime advisory is cleared |
| `ws` transitive | Storybook's nested WebSocket dependency | development only | Deferred with Storybook; not shipped by `package:win` |
| `builder-util-runtime`/`app-builder-lib` | transitive electron-builder graph | package build only | Deferred; no updater/private credential path is enabled |

No `npm audit fix --force` was run. No major dependency upgrade was attempted. Electron-builder
and its tar/brace-expansion findings remain build-time only and are deferred to a separate
packaging compatibility change. The app remains paper-only and fail-closed.

## Follow-up work

1. Upgrade electron-builder and validate an actual signed/unsigned Windows installer on a clean
   Windows VM, including install, uninstall, user-data retention, and preload resolution.
2. Upgrade Storybook/Playwright/Vitest in isolated development-tool changes.
3. Re-run pnpm audit after each isolated change; do not replace the reviewed lockfile with an npm
   lockfile.
