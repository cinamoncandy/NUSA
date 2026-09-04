# NUSA

**NUSA** is a private, single-user, fail-closed **Upbit Paper/Shadow trading** and deterministic research platform built with Electron.

It prioritizes capital survival, evidence, and safety over speed or aggressive automation.

> Live trading is **not implemented**.  
> Production mutation remains **disabled**.  
> AI has **zero authority** over orders, transfers, or live activation.

## Key Features

- Electron desktop application (Windows primary)
- Upbit public market-data WebSocket with robust reconnect
- Local Paper trading engine (cash, positions, fees, PnL)
- Bounded Cloud PAPER / read-only runtime
- Read-only mobile operations surface
- Strong safety boundaries and recovery workflows
- Deterministic accounting and evidence collection
- AIPOS: cross-AI repository continuity contract

## Safety Scope (Non-negotiable)

- Live trading is not implemented or authorized
- The application does not request or store LIVE exchange execution credentials
  (read-only `UPBIT_ACCESS_KEY/SECRET` may be used for observation-only account
  sync via `apps/desktop/src/exchange/upbitReadOnlyCredentialProvider.ts` and
  `services/upbit-readonly/`; execution paths still throw `LiveMutationDisabledError`)
- Buy and sell activity is Paper/Shadow simulation only
- AI remains advisory / zero-authority
- Electron renderer isolation, sandboxing, and restricted preload IPC remain enabled
- `liveAuthority` remains `NONE`
- `productionMutationAllowed` remains `false`

## Quick Start (Desktop)

Requires **Node.js 24+**.

```bash
git clone https://github.com/cinamoncandy/NUSA.git
cd NUSA
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm desktop
```

## Cloud PAPER runtime

Start it with no configuration:

```bash
pnpm cloud:runtime
```

This starts a localhost-by-default, authenticated, GET-only dashboard/PAPER surface.  
It does **not** grant LIVE authority.

It launches through `scripts/start-cloud-runtime.js`, which supplies the operational defaults the
runtime requires — dashboard port and host, Upbit's PUBLIC quotation feed, and PAPER starting
capital — and prints the endpoint to configure the mobile app against. A dashboard token is
generated once and kept owner-only at `~/.nusa/cloud/dashboard-token`, so the device does not need
reconfiguring on every restart. Private exchange credentials found in the environment are stripped
rather than forwarded.

Every default is applied only when that variable is absent, so explicit configuration always wins.
`readCloudRuntimeConfig` itself remains fail-closed and unchanged — see
`apps/cloud/src/cloudRuntimeConfig.ts` for the full list of variables. To run the compiled runtime
directly with no defaults supplied, use `pnpm cloud:runtime:bare`.

A single writer may mutate the PAPER account at a time, enforced by a lease in the state database.
A clean shutdown releases it; a crash or a force-kill leaves it behind, and a lease that is too old
to take over safely is refused rather than seized. When nothing is running, clear an abandoned lease
with:

```bash
node scripts/reset-paper-writer-lease.js
```

It refuses to act while a runtime is answering on the dashboard endpoint or while the lease is still
valid, and it only removes the lease row — cash, positions, and fills are untouched.

## Validation

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run architecture:truth
pnpm run package:validate
```

## Project Layout

| Path | Purpose |
|------|---------|
| `apps/desktop` | Electron main, preload, renderer, paper broker (`src/paper/paperBroker.ts`), Upbit WebSocket (`src/exchange/upbitWebSocket.ts`) |
| `apps/cloud` | Cloud PAPER / read-only runtime and dashboard server |
| `apps/mobile` | Read-only mobile operations surface |
| `apps/execution` | Execution gateway / durable-execution policy-validation-only services (no live authority by default) |
| `apps/autopilot` | Audit runner and coding-evidence automation (fail-closed, zero authority) |
| `packages/core` | Shared strategy, market-data, and paper-trading domain logic |
| `packages/contracts` | Shared accounting, operations, AI, and risk contracts |
| `packages/storage` | SQLite accounting and durable storage |
| `packages/aipos` | AIPOS continuity helpers |
| `services/upbit-readonly` | Localhost-only read-only Upbit observation bridge (GET-only) |
| `services/nusa-mcp` | Constrained local MCP surface (allowlisted paths/origins) |
| `.aipos/` | Cross-AI recovery, work orders, architecture state |

## Architecture Principles

```
Market Data → Intelligence → Strategy → Decision → Risk → Portfolio → Execution → Paper Adapter → Review → Memory
```

- Strategy emits signals only (never places orders)
- Risk may reject, resize, pause, or halt any intent
- Paper and Live adapters share interfaces but never share mutable operating state
- Fail closed on uncertainty

Full principles: see `nusa.md`, `AGENTS.md`, and `.aipos/architecture.md`.

## License

MIT License — see [LICENSE](LICENSE).

**This software is for paper trading and research only.**  
No warranty. No liability for financial decisions or losses.

## Disclaimer

NUSA is a research and simulation tool.  
It is not a broker, not financial advice, and not authorized for real-money trading.
