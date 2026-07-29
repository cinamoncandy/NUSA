# NUSA

NUSA is an Electron-based Upbit Paper/Shadow trading application with fail-closed safety, recovery, diagnostics, and evidence workflows.

## Branch status

The runnable desktop application currently lives on [`agent/electron-upbit-paper-trading`](https://github.com/cinamoncandy/NUSA/tree/agent/electron-upbit-paper-trading) and is tracked by [PR #1](https://github.com/cinamoncandy/NUSA/pull/1).

The `main` branch remains a reconstructed accounting/certification baseline and is not the desktop application entry point yet.

## Current verification

The current application-branch head has a successful GitHub Actions CI run. Automated typecheck, build, and tests pass on that head.

The application is Paper/Shadow only. Live trading, private API access, credentials, withdrawals, and live orders remain disabled.

## Run the desktop app

```bash
git clone https://github.com/cinamoncandy/NUSA.git
cd NUSA
git switch agent/electron-upbit-paper-trading
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm run dev
```

Use Node.js 24 or newer. For a Windows installer, use the repository's packaging command on Windows after validation passes.

## Release boundary

Runnable does not mean Production-authorized. A public v1.0 release still requires the documented owner review and real-session evidence gates. Do not enable live-trading capabilities or add credentials as part of desktop verification.
