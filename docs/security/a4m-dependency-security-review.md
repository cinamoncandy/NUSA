# A4M Dependency Security Review

Date: 2026-07-29

## Scope and source of truth

The repository uses `pnpm@11.7.0` and tracks `pnpm-lock.yaml`; it does not track an npm
lockfile. `npm audit` was executed as requested and returned `ENOLOCK`, so its result cannot be
treated as an audit of this repository. The authoritative result for the installed dependency
graph is `pnpm audit --json` against the existing pnpm lockfile.

The initial pnpm advisory summary was 0 informational, 4 low, 14 moderate, 19 high, and 2
critical findings. After targeted same-major updates, `pnpm audit --json` reports 0
informational, 0 low, 1 moderate, 2 high, and 0 critical findings. The remaining findings are
development or packaging transitive dependencies and are not included in the production ASAR.

## Impact classification

| Area | Examples | Classification | Action |
| --- | --- | --- | --- |
| Playwright browser download | `@playwright/test` 1.55.1 | development/test only | Updated within major 1 |
| Storybook manager/dev server | Storybook 8.6.17 | development only | Updated within major 8; not shipped by `package:win` |
| Vitest UI server | Vitest 3.2.6 | development/test only | Updated within major 3; UI server is not enabled in production |
| Electron advisories | Electron 39.8.5 | packaged runtime framework | Updated within major 39; current Electron advisories are cleared |
| `brace-expansion` | transitive under electron-builder/eslint | packaging/build only | Deferred; major-sensitive transitive override avoided |
| `ws` | direct public market WebSocket runtime | production runtime | Updated from 8.18.3 to 8.21.0 within major 8; the root runtime advisory is cleared |
| `ws` transitive | jsdom's nested WebSocket dependency | development only | Deferred; root runtime `ws` is patched and nested override avoided |
| `builder-util-runtime`/`app-builder-lib` | transitive electron-builder graph | package build only | Deferred; no updater/private credential path is enabled |

No `npm audit fix --force` was run. No major dependency upgrade was attempted. The two
remaining High findings are build/test-only transitive dependencies; forcing cross-major
overrides could break jsdom, eslint, or electron-builder. The app remains paper-only and
fail-closed.

## Follow-up work

1. Upgrade or replace the remaining transitive `brace-expansion` and jsdom `ws` paths only with
   compatibility tests and a clean Windows packaging validation.
2. Validate an actual signed/unsigned Windows installer on a clean Windows VM, including install,
   uninstall, user-data retention, and preload resolution.
3. Re-run pnpm audit after each isolated change; do not replace the reviewed lockfile with an npm
   lockfile.
