# Technical Debt

## Node SQLite warning

The persistence tests and runtime use Node's built-in `node:sqlite` module. Node 24 currently emits an experimental-feature warning when this module is loaded. The implementation is covered by file-backed restart, transaction, idempotency, and rebuild tests, but the warning remains until Node marks the API stable or the project deliberately adopts another SQLite driver.

Action: track Node release notes and reassess during the versioned SQLite event/account repository work. Do not suppress the warning in tests and do not replace the driver solely to remove console output.

## Deprecated transitive dependencies

The Electron packaging dependency graph currently reports nine deprecated transitive packages, including legacy `glob`, `rimraf`, `tar`, `boolean`, and `@npmcli/move-file` versions. They arrive through `electron-builder` and related packaging tools rather than direct runtime imports.

Action: review the dependency tree during a dedicated packaging maintenance task. Upgrade only after checking release notes, Windows packaging output, installer behavior, and license changes. Do not force resolutions or replace dependencies during Paper Trading recovery hardening.

## Electron install policy

`electron-builder@26.0.12` reaches `@electron/node-gyp` through a Git-hosted transitive dependency. The repository explicitly sets `blockExoticSubdeps: false` so pnpm can consume the reviewed lockfile, while `onlyBuiltDependencies` restricts lifecycle scripts to `electron` and `electron-winstaller`.

Action: retain `--frozen-lockfile` in CI, review any future lockfile change, and fail CI if package resolution drifts.
