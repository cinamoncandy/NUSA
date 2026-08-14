# Technical Debt

## Node SQLite warning

The persistence tests and runtime use Node's built-in `node:sqlite` module. Rechecked
2026-08-14: as of Node 24 (the project's required minimum per `package.json`'s `engines`
field), `node:sqlite` no longer requires the `--experimental-sqlite` flag and has been
promoted to Stability 1.2 (Release Candidate) -- settled behind an experimental warning,
not yet stamped fully Stable. Confirmed directly in this sandbox on Node 22.22.2 (below
the project's required minimum, so not representative of the actual target runtime): the
warning still fires (`ExperimentalWarning: SQLite is an experimental feature and might
change at any time`). The implementation is covered by file-backed restart, transaction,
idempotency, and rebuild tests, but the warning itself remains until Node marks the API
fully Stable or the project deliberately adopts another SQLite driver.

Action: track Node release notes and reassess during the versioned SQLite event/account
repository work. Do not suppress the warning in tests and do not replace the driver
solely to remove console output.

## Deprecated transitive dependencies

Reassessed 2026-08-14. `electron-builder` was bumped `26.15.0` -> `26.15.3` (patch-only,
same day release per npm; `pnpm run build` passes against the new lockfile) as a
dedicated packaging maintenance step. That bump did not change the deprecated set:
`pnpm install` still reports 7 deprecated transitive packages, all pinned inside
electron-builder's own dependency graph or dev-only test tooling, not by anything NUSA's
`package.json` selects directly:

- `glob@7.2.3`, `inflight@1.0.6` -- pulled in by `@electron/asar@3.4.1` and by
  `rimraf@2.6.3` (below), both fixed versions inside `app-builder-lib@26.15.3`.
- `rimraf@2.6.3` -- pulled in by `temp@0.9.4` (the latest published `temp` release),
  used by `electron-winstaller@5.4.0` for scratch-file handling.
- `boolean@3.2.0` -- pulled in by `global-agent@3.0.0` via `@electron/get@3.1.0`;
  `app-builder-lib` pins `@electron/get` to `^3.0.0` even though `@electron/get@5.1.0`
  has already dropped `global-agent`/`boolean` entirely.
- `@xmldom/xmldom@0.8.13` -- pulled in by `plist@3.1.0` via `@electron/osx-sign@1.3.3`,
  another fixed `app-builder-lib` dependency.
- `glob@10.5.0` -- unrelated to packaging: pulled in by `test-exclude@7.0.2` via
  `@vitest/coverage-v8`/`c8` (dev/test tooling only).
- `whatwg-encoding@3.1.1` -- pulled in by `jsdom@26.0.0` via `html-encoding-sniffer@4.0.0`
  (dev/test tooling only).

None of these are direct dependencies, and none are reachable from packaged runtime code
-- confirmed by tracing each with `pnpm why <package>`. Every packaging-related one
(`glob@7.2.3`, `inflight`, `rimraf`, `boolean`, `@xmldom/xmldom`) resolves through a
version electron-builder's own `app-builder-lib`/`electron-winstaller` pins internally;
forcing a different resolution would fight upstream's own lockfile and is exactly the
kind of forced resolution AGENTS.md prohibits. They clear only when electron-builder (or
`temp`) ships a release that repins them upstream.

Action: re-run this trace whenever `electron-builder` releases a new minor/major version,
and re-check `@electron/get` in particular since `app-builder-lib` is the only remaining
blocker keeping `boolean` in the tree. Do not add `pnpm.overrides` for these packages, and
do not replace `electron-builder`/`electron-winstaller`/`temp` solely to silence the
warning. Windows packaging output (`pnpm package:win`) still needs a real Windows run to
confirm the patch bump before it ships in a release build.

## Electron install policy

`electron-builder@26.0.12` reaches `@electron/node-gyp` through a Git-hosted transitive dependency. The repository explicitly sets `blockExoticSubdeps: false` so pnpm can consume the reviewed lockfile. pnpm 11.7 does not use the legacy `onlyBuiltDependencies` value for its current lifecycle policy; the verified `allowBuilds` map restricts lifecycle scripts to `electron` and `electron-winstaller` on local and GitHub Actions installs.

Action: retain `--frozen-lockfile` in CI, review any future lockfile change, and fail CI if package resolution drifts.
