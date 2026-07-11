# Architecture

## Overview

Dokkaebi is currently a small pnpm TypeScript monorepo with three implementation units:

```text
apps/execution
    |
    v
packages/contracts
    ^
    |
packages/storage
```

Both storage and execution depend on shared contracts. The pure risk engine does not depend on storage.

## Repository Layout

```text
apps/
  execution/
    src/index.ts
packages/
  contracts/
    src/index.ts
  storage/
    migrations/001_position_accounting.sql
    src/index.ts
tests/
  reconstruction.test.js
```

The root TypeScript project compiles application and package sources into `dist/`. Tests import compiled CommonJS output and run with Node's built-in test runner.

## Contracts

`packages/contracts` defines:

- ledger side, position scope, position status, and risk decision enums;
- immutable ledger and snapshot models;
- raw-value validation;
- deterministic ledger comparison;
- empty wallet and strategy snapshot constructors.

All accounting values use `bigint`. Timestamps are represented as strings and must be supplied in a lexically sortable format such as ISO 8601.

## Position Accounting

A ledger entry represents a buy or sell for a wallet, optional strategy, and symbol. Projection uses proportional cost-basis accounting:

```text
soldCostRaw = quoteCostRaw * soldBaseQtyRaw / currentBaseQtyRaw
realizedPnlRaw += knownSellQuoteRaw - soldCostRaw
avgEntryPriceRaw = quoteCostRaw / baseQtyRaw
```

The division operations use integer truncation.

Wallet and strategy snapshots are separate projections. Both retain realized PnL after close and support deterministic close/reopen behavior.

## Persistence and Recovery

`packages/storage` uses Node's `node:sqlite` `DatabaseSync`. Raw `bigint` values are stored as decimal `TEXT` and decoded to `bigint` at the repository boundary.

SQLite tables are:

- `position_ledger_entries`
- `wallet_position_snapshots`
- `strategy_position_snapshots`
- `applied_ledger_markers`

Ledger reads always order by `ts ASC, created_at ASC, id ASC`.

`appendAndApply` executes ledger insertion, applied-marker insertion, accounting projection, and snapshot persistence inside `BEGIN IMMEDIATE`. A failure rolls back all writes and rethrows the same error object.

Applied markers provide projection idempotency per scope and reject order regression. Explicit rebuild clears markers for the selected scope, replays the ordered ledger, and persists the reconstructed snapshot in one transaction.

Audit-style repository reads return newly decoded immutable objects and do not mutate state.

## Pre-Trade Risk

`apps/execution` exposes a pure `evaluatePreTradeRisk` function. Inputs are supplied by the caller; the function performs no I/O.

The current policy can block:

- sell quantity above the supplied position;
- order quote amount above a raw limit;
- resulting base position above a raw limit;
- trading after realized loss exceeds a raw limit.

A disabled policy returns allow. This module does not submit orders and does not communicate with an exchange.

## Runtime Boundaries

The current baseline has no long-running process or API surface. It does not yet contain:

- an exchange adapter;
- market-data ingestion;
- order lifecycle orchestration;
- a strategy scheduler;
- a control plane;
- authentication or secrets management;
- an Electron shell;
- operator notifications.

These are roadmap items, not hidden capabilities.

## Testing

Behavior-focused tests cover accounting transitions, oversell rollback, ledger and marker ordering, duplicate idempotency, explicit rebuild, error identity, file-backed restart recovery, and pure risk decisions.
