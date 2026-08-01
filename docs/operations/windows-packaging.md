# Windows Packaging

## Requirements

- Node.js 24 or newer
- pnpm 11.7.0 or newer
- Windows build host for the NSIS installer
- Dependencies installed with `pnpm install --frozen-lockfile --config.block-exotic-subdeps=false`

## Build and validate

From the repository root:

```powershell
pnpm install --frozen-lockfile --config.block-exotic-subdeps=false
pnpm run preflight
pnpm run typecheck
pnpm run build
pnpm run package:validate
pnpm run package:win
```

The installer is written to `release/NUSA-<version>-Windows-Setup.exe`. The packaged app is
ASAR-enabled. Electron-builder includes compiled `dist/`, the renderer entrypoint, the desktop
package metadata, and the production `ws` dependency; TypeScript, source maps, tests, and docs
are excluded from the application file set.

## Install, uninstall, and first run

Run the NSIS installer, accept the per-user installation location, and launch NUSA from the
Start Menu or desktop shortcut. Uninstall from Windows **Apps > Installed apps**. Uninstall does
not delete user data by policy, so recovery and Evidence records remain available for review.

The installed application remains Paper-only. Live trading, private API, credential storage, and
real order capabilities are disabled; an unconfigured risk gate returns `HALT`.

## Runtime locations

Electron stores the application data below its platform `userData` directory. On Windows this is
normally `%APPDATA%\\nusa`:

- `nusa.db`: durable Paper/control/recovery state
- `paper-session.json`, `control-session.json`: compatibility session stores
- `shadow-evidence\\`: immutable Shadow Evidence archives
- recovery state and audit records: `nusa.db` and the existing recovery/audit stores
- diagnostic logs: collected from the app process and Windows Event Viewer; no secret is logged

Do not copy credentials into these locations. For a support bundle, collect the exact app version,
commit/fingerprint diagnostics, sanitized startup/recovery messages, and verifier output. Do not
include database contents or Evidence archives unless an authorized operator requests them.

## Production safety checks

`pnpm run package:validate` verifies appId, product name, deterministic installer name, icon,
compiled entrypoints, ASAR, explicit NSIS settings, production `ws`, `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`, and the fail-closed risk-gate marker. It does not start
Electron, connect to a market, place orders, or create operational Evidence.
