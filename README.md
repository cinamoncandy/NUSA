# NUSA

NUSA is an Electron-based Upbit Paper/Shadow trading application with fail-closed safety, recovery, diagnostics, evidence workflows, a bounded Cloud PAPER runtime, and read-only mobile operations surfaces.

Renderer interaction guidance: [Command Palette](docs/design/command-palette.md).

## Safety scope

- Live trading is not implemented or authorized.
- Production mutation remains disabled; current Cloud/mobile operations are PAPER/read-only only.
- The application does not request or store LIVE exchange execution credentials.
- Buy and sell activity is Paper/Shadow simulation only.
- AI remains advisory/zero-authority and cannot authorize orders, transfers, or LIVE activation.
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

## Cloud PAPER runtime

The repository includes an executable Cloud PAPER/read-only runtime bootstrap. It wires the Cloud dashboard server, durable SQLite-backed dashboard/PAPER state when configured, Upbit public market data, research coordination, and the bounded zero-authority AI runtime. It does **not** grant LIVE authority or production mutation.

Required environment configuration remains fail-closed; see `apps/cloud/src/cloudRuntimeConfig.ts`. Start the configured runtime with:

```bash
pnpm cloud:runtime
```

`cloud:runtime` being runnable does not mean it is publicly hosted or production-authorized. Hosting, external read-only preflight, and any future real-money transition remain separate operator/human-gated decisions.

Run validation:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run architecture:truth
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
- `apps/cloud/src/runtime.ts`: executable Cloud PAPER/read-only runtime composition root
- `apps/cloud/src/server.ts`: localhost-by-default authenticated GET-only dashboard/PAPER operations HTTP surface
- `apps/cloud/src/cloudRuntimeConfig.ts`: fail-closed Cloud runtime environment/configuration boundary
- `apps/cloud/src`: investment/research governance, durable PAPER state, public market-data, read-only operations projection, and zero-authority AI runtime integration
- `packages/contracts`: shared accounting, operations, AI, and risk contracts
- `packages/storage`: SQLite accounting and durable storage infrastructure

## Release boundary

Runnable does not mean Production-authorized. NUSA remains Paper/Shadow only, `liveAuthority` remains `NONE`, and `productionMutationAllowed` remains `false` unless a separately approved human/constitutional transition changes that boundary. Repository or CI validation must never be treated as real-world LIVE authorization.
