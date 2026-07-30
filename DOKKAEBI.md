# DOKKAEBI

## Mission

NUSA is a private, single-user investment system whose supreme objective is to
increase the user's long-term, risk-adjusted wealth. This is an optimization
goal, not a profit guarantee.

Every AI and system component serves that objective through:

1. efficiency,
2. capital preservation,
3. evidence-based decisions,
4. safety and user control,
5. convenience.

The first market is Upbit spot. Binance futures is a later phase and must remain out of scope until the Upbit spot system has passed backtest, walk-forward, paper-trading, recovery, and risk-control gates.

## Non-negotiable principles

- Wealth accumulation is optimized, never promised.
- When evidence, persistence, reconciliation, or authorization is uncertain, preserve capital and fail closed.
- No AI output is authority; user approval and deterministic controls remain mandatory.
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

### Not active

- Live Upbit orders
- API key storage
- Binance futures
- Autonomous real-money AI execution

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
#1 Convert Dokkaebi to Electron paper trading app
```

Before starting work, read this file, `AGENTS.md`, the active PR, current tests, and the latest branch state.
