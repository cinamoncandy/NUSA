# NUSA

## Mission

NUSA is a private, single-user trading system built to maximize:

1. efficiency,
2. long-term risk-adjusted profit,
3. safety,
4. convenience.

The first market is Upbit spot. Binance futures is a later phase and must remain out of scope until the Upbit spot system has passed backtest, walk-forward, paper-trading, recovery, and risk-control gates.

## Non-negotiable principles

- Evidence before confidence.
- Capital survival before return maximization.
- Paper before live.
- Risk may veto every trade.
- No strategy is trusted permanently.
- Every meaningful feature must improve profit potential, safety, efficiency, or convenience.
- No API key, secret, credential, or private operating data may be committed.
- Live trading requires explicit owner approval and dedicated safety controls.

## Target architecture

```text
Market Data
  -> Intelligence
  -> Strategy
  -> Decision
  -> Risk
  -> Portfolio / Capital Allocation
  -> Execution
  -> Paper or Live Adapter
  -> Review
  -> Memory / Research
```

### Boundaries

- Strategy produces signals, not exchange orders.
- Decision combines strategy, market regime, account state, and policy.
- Risk can reject, resize, or halt any decision.
- Execution does not know strategy internals.
- Exchange-specific behavior belongs behind adapters.
- Paper and live execution should share contracts while remaining operationally isolated.

## Current scope

### Active

- Electron Windows desktop app
- Upbit public WebSocket market data
- Local Paper Trading
- Session persistence
- Basic risk limits
- SMA strategy engine
- Control plane
- Desktop chart and event display
- `apps/cloud`: substantial server-side domain logic (investment committee, strategy governance,
  hash-chained control audit ledger with a mobile-triggered kill switch, mobile dashboard API/HTTP
  server, and a Paper trading engine ported from the desktop core). Present in the source tree,
  covered by tests, and runnable as a bounded localhost-by-default PAPER runtime via
  `pnpm cloud:runtime` (`scripts/start-cloud-runtime.js`). It remains PAPER-only with
  `liveAuthority=NONE` and `productionMutationAllowed=false`; use `pnpm cloud:runtime:bare`
  to run the compiled runtime with no operational defaults supplied.

### Not active

- Live Upbit orders
- API key storage for execution (read-only observation keys via
  `apps/desktop/src/exchange/upbitReadOnlyCredentialProvider.ts` and
  `services/upbit-readonly/` are the only credential path; execution use is prohibited)
- Binance futures
- Autonomous real-money AI execution
- Any cloud-hosted process beyond the local bounded PAPER runtime. `apps/cloud`'s server and
  trading engine run locally via `pnpm cloud:runtime`; remote persistence, hosting, and
  authentication for a real deployment remain open decisions, not implementation gaps.

## Product stages

### Stage 1 — Upbit Spot Research and Paper

- deterministic accounting
- durable persistence
- backtest engine
- decision engine
- risk engine 2.0
- strategy registry
- performance analytics
- failure recovery

### Stage 2 — Upbit Spot Live Candidate

Only after measurable paper evidence and explicit owner approval:

- API credential vault
- read-only account sync
- dry-run order adapter
- kill switch
- daily loss limit
- reconciliation
- idempotent order handling

### Stage 3 — Binance Futures

Only after the spot system is mature:

- isolated futures domain model
- leverage and margin controls
- liquidation and funding awareness
- futures-specific strategies and risk policies

## Success metrics

Trading metrics:

- CAGR
- maximum drawdown
- Sharpe and Sortino ratios
- profit factor
- expectancy
- recovery factor
- exposure

System metrics:

- crash-free runtime
- deterministic recovery
- WebSocket reconnect reliability
- duplicate-order prevention
- persistence integrity
- test and CI health

## Working roles

- Owner: final investment and live-trading approval.
- Codex: implementation, tests, refactoring, commits, and pull requests.
- ChatGPT: architecture, research, audit, risk review, and prioritization.
- GitHub: source of truth for code, decisions, and current state.

## Current source of truth

Development currently continues on:

```text
agent/electron-upbit-paper-trading
```

Existing Draft PR:

```text
#1 Convert NUSA to Electron paper trading app
```

Before starting work, read this file, `AGENTS.md`, the active PR, current tests, and the latest branch state.
