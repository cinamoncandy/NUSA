# NUSA

NUSA is an Electron-based Upbit Paper/Shadow trading application with fail-closed safety, recovery, diagnostics, and evidence workflows.

Renderer interaction guidance: [Command Palette](docs/design/command-palette.md).

## Safety scope

- Live trading is not implemented.
- The application does not request or store API keys.
- Buy and sell activity is Paper/Shadow simulation only.
- Electron renderer isolation, sandboxing, and restricted preload IPC remain enabled.

## Run the desktop app

Use Node.js 24 or newer.

```bash
git clone https://github.com/cinamoncandy/NUSA.git
cd NUSA
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm desktop
```

Run validation:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run package:validate
```

Create the Windows installer on Windows:

```bash
pnpm package:win
```

## Project layout

- `apps/desktop/src/main.ts`: Electron main process and IPC
- `apps/desktop/src/preload.ts`: restricted renderer API
- `apps/desktop/src/upbitWebSocket.ts`: public Upbit market-data WebSocket and reconnect handling
- `apps/desktop/src/paperBroker.ts`: Paper cash, positions, fees, and PnL
- `apps/desktop/renderer`: NUSA desktop workspace
- `apps/cloud/src`: server-side domain logic (investment committee, strategy governance, control
  audit ledger, and a Paper trading engine port of the desktop core). Not currently deployed or
  wired into a running process -- see `apps/cloud/src/server.ts` and
  `apps/cloud/src/paperEngineControlState.ts` for what exists and what is explicitly still open
  (a real token issuer, a persistence backend, and a hosting decision).
- `packages/contracts`: shared accounting and risk contracts
- `packages/storage`: SQLite accounting storage

## Release boundary

Runnable does not mean Production-authorized. NUSA remains Paper/Shadow only. Do not add credentials or enable live-trading capabilities as part of desktop verification.
