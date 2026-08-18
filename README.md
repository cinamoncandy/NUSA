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

## Cloud PAPER Runtime

```bash
pnpm cloud:runtime
```

This starts a localhost-by-default, authenticated, GET-only dashboard/PAPER surface.  
It does **not** grant LIVE authority.

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
| `apps/desktop` | Electron main, preload, renderer, paper broker, Upbit WebSocket |
| `apps/cloud` | Cloud PAPER / read-only runtime and dashboard server |
| `apps/mobile` | Read-only mobile operations surface |
| `packages/contracts` | Shared accounting, operations, AI, and risk contracts |
| `packages/storage` | SQLite accounting and durable storage |
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
