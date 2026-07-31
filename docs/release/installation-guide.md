# NUSA Windows Installation Guide

## Supported release

Windows x64, Node 24 and pnpm 11 are required for building from source. The
application starts in Paper mode. `LIVE TRADING DISABLED` is a permanent safe
default for this release and no API key is requested.

## Build and install

Run `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm run build`,
`pnpm run package:validate`, and `pnpm run package:win`. The installer is written
to `release/NUSA-<version>-Windows-Setup.exe`. Run the installer as a normal
user and keep the default per-user location.

## Validate

Open the app and confirm Paper mode, `LIVE TRADING DISABLED`, Settings, About,
and Diagnostics. The app must close normally. Uninstall from Windows Settings;
user data is intentionally preserved for recovery and backup verification.

## Data locations

Settings, logs, Evidence, recovery, crash markers, and diagnostics are stored
under the Electron user-data directory. The exact path is available through the
read-only diagnostics export and is never printed into a release report.
