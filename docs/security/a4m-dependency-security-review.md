# A4M Dependency Security Review

Date: 2026-07-29

## Scope and source of truth

The repository uses `pnpm@11.7.0` and tracks `pnpm-lock.yaml`; it does not track an npm
lockfile. `npm audit` was executed as requested and returned `ENOLOCK`, so its result cannot be
treated as an audit of this repository. The authoritative result for the installed dependency
graph is `pnpm audit --json` against the existing pnpm lockfile.

Observed pnpm advisory summary: 0 informational, 4 low, 14 moderate, 19 high, and 2 critical
vulnerability findings across 633 development/optional dependency entries. The report is not a
claim that all findings are reachable from the shipped app: the graph is overwhelmingly build,
test, browser-fixture, or packaging tooling.

## Impact classification

| Area | Examples | Classification | Action |
| --- | --- | --- | --- |
| Playwright browser download | `@playwright/test` 1.52.0 | development/test only | Deferred; upgrade with browser and CI compatibility test |
| Storybook manager/dev server | Storybook 8.6.14 | development only | Deferred; not shipped by `package:win` |
| Vitest UI server | Vitest 3.2.4 | development/test only | Deferred; UI server is not enabled in production |
| Electron advisories | Electron 39.0.0 | build/runtime framework, not direct app business API | Deferred; requires Electron upgrade and preload/packaging regression validation |
| `tar`, `brace-expansion` | transitive under electron-builder | packaging/build only | Deferred; upgrade electron-builder in a dedicated compatibility change |
| `ws` | direct public market WebSocket runtime | production runtime | Kept pinned at 8.18.3 and moved to `dependencies`; follow-up upgrade required because the audit reports newer patched versions |
| `builder-util-runtime`/`app-builder-lib` | transitive electron-builder graph | package build only | Deferred; no updater/private credential path is enabled |

No `npm audit fix --force` was run. No major dependency upgrade was attempted. That is
intentional: blind resolution could change Electron, preload, builder, or test contracts while
the app is paper-only and fail-closed.

## Follow-up work

1. Upgrade `ws` in isolation, then run full tests and a public-feed reconnect test.
2. Upgrade electron-builder and validate an actual signed/unsigned Windows installer on a clean
   Windows VM, including install, uninstall, user-data retention, and preload resolution.
3. Upgrade Electron only with a dedicated security release and Electron runtime regression set.
4. Re-run pnpm audit after each isolated change; do not replace the reviewed lockfile with an npm
   lockfile.
