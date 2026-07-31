# RFC 0001 — Versioned SQLite Persistence

Status: Accepted for implementation

Branch: `agent/electron-upbit-paper-trading`

## Purpose

Replace the current JSON-based Paper and Control Plane session files with a versioned SQLite repository without weakening the safety guarantees already established.

This change is intended to improve:

- crash consistency,
- atomic multi-record updates,
- auditable event history,
- restart recovery,
- future backtest/reporting support,
- operational diagnostics.

It must not add live trading, private Upbit API access, credential storage, or Binance futures behavior.

## Non-negotiable guarantees

1. Automatic trading is always disabled after process restart.
2. Corrupt or ambiguous persistence state fails closed.
3. A repeated automatic signal cannot produce a duplicate order, including after restart.
4. Manual and automatic Paper orders continue to use the same risk checks.
5. Migration failure cannot partially activate a new schema.
6. No destructive deletion of legacy JSON files occurs during the first migration release.
7. The Electron renderer never receives direct database access.

## Scope

Persist the following domains:

- Paper account cash and position state,
- Paper orders/fills,
- Control Plane status and order quantity,
- Control events,
- processed automatic signal keys,
- schema and migration metadata,
- migration/import diagnostics.

Out of scope:

- market tick history,
- candle history,
- backtest datasets,
- live exchange orders,
- API credentials,
- Telegram state,
- Binance futures.

## Database location

Use one SQLite file under Electron `userData`, for example:

```text
<userData>/nusa.sqlite3
```

The path must be owned by the main process and never exposed to the renderer.

## SQLite settings

On open, configure and verify:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
```

If required safety pragmas cannot be applied or verified, startup must fail closed and emit a visible diagnostic.

## Schema versioning

Create a migration table:

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

Migrations must:

- run in ascending version order,
- execute inside explicit transactions,
- be idempotent at the migration-runner level,
- roll back completely on error,
- refuse unknown future schema versions.

## Initial schema

### account_state

Single-row snapshot for fast recovery.

```sql
CREATE TABLE account_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  cash REAL NOT NULL,
  market TEXT NOT NULL,
  quantity REAL NOT NULL,
  average_price REAL NOT NULL,
  realized_pnl REAL NOT NULL,
  fee_rate REAL NOT NULL,
  updated_at TEXT NOT NULL
);
```

### paper_orders

```sql
CREATE TABLE paper_orders (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  price REAL NOT NULL CHECK (price > 0),
  fee REAL NOT NULL CHECK (fee >= 0),
  filled_at TEXT NOT NULL
);
```

### control_state

```sql
CREATE TABLE control_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  auto_trade_enabled INTEGER NOT NULL CHECK (auto_trade_enabled IN (0, 1)),
  order_quantity REAL NOT NULL CHECK (order_quantity > 0),
  updated_at TEXT NOT NULL
);
```

The persisted value of `auto_trade_enabled` is historical only. Recovery must always construct runtime state with automatic trading disabled.

### control_events

```sql
CREATE TABLE control_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  data_json TEXT
);
```

### processed_signal_keys

```sql
CREATE TABLE processed_signal_keys (
  signal_key TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
```

### persistence_diagnostics

```sql
CREATE TABLE persistence_diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  severity TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  context_json TEXT
);
```

## Repository contract

Introduce a main-process-only repository abstraction. Suggested responsibilities:

```text
open()
runMigrations()
loadRuntimeState()
savePaperOrderAndAccount()
saveControlState()
appendControlEvent()
claimSignalKey()
recordDiagnostic()
close()
```

`claimSignalKey()` must be atomic and return whether the caller successfully claimed a previously unseen key.

## Transaction boundaries

The following must be atomic:

### Manual or automatic Paper fill

1. validate and execute through `PaperBroker`,
2. insert the Paper order,
3. update account snapshot,
4. append control event,
5. persist signal key when automatic,
6. commit.

If any persistence step fails, the runtime must not continue as though the order were durable. The Control Plane must fault and automatic trading must be disabled.

### Control mutation

Status, order quantity, and event append should be committed in one transaction when they represent one operator action.

## JSON migration

Legacy files may exist:

```text
paper-session.json
control-session.json
```

Migration policy:

1. Open/create SQLite and complete schema migrations.
2. If SQLite already has initialized account/control state, do not import JSON again.
3. Otherwise validate both JSON files using existing strict validators.
4. Import valid state in one transaction.
5. Force recovered automatic trading OFF.
6. Record an import diagnostic.
7. Rename legacy files to `.migrated-<timestamp>.json` only after the import transaction commits.
8. Do not delete migrated files in this release.
9. If either JSON file is corrupt or the pair is inconsistent, fail closed and leave files untouched.

## Recovery policy

Startup must distinguish:

- new installation,
- healthy existing database,
- legacy JSON import,
- corrupt database,
- migration failure,
- unsupported future schema,
- incomplete or inconsistent state.

Any ambiguous state must:

- disable automatic trading,
- fault the Control Plane,
- block manual and automatic orders,
- surface a diagnostic in the desktop UI,
- preserve the original persistence files for repair.

## Numeric integrity

SQLite `REAL` is acceptable for the current Paper prototype, but repository boundaries must reject:

- non-finite numbers,
- negative cash,
- negative quantity,
- invalid fee rate,
- impossible order values,
- market mismatch.

A future money/quantity fixed-point migration should be tracked as technical debt before live trading.

## Testing requirements

Add deterministic tests for:

1. fresh database initialization,
2. migration table creation and current version,
3. account/order/control/event round trip,
4. atomic rollback when one write fails,
5. restart forces auto-trading OFF,
6. processed signal key survives restart,
7. duplicate signal claim is rejected,
8. valid JSON to SQLite migration,
9. corrupt JSON fails closed without deleting files,
10. corrupt SQLite fails closed,
11. unsupported future schema fails closed,
12. migration interruption leaves no partial schema/data,
13. manual and automatic order persistence use identical risk outcomes,
14. existing 39 tests remain green.

## Acceptance criteria

- `pnpm install --frozen-lockfile` passes in Windows CI.
- `pnpm run typecheck` passes.
- `pnpm test` passes with all new and existing tests.
- No JSON file is deleted.
- Automatic trading is OFF after every restart.
- Duplicate automatic orders are impossible across restart boundaries.
- A persistence error blocks further orders and produces a visible diagnostic.
- PR remains Draft until CI is green and audit is complete.

## Rollout

1. Add repository and migration tests.
2. Add SQLite implementation behind an internal persistence interface.
3. Add JSON import path.
4. Switch Electron runtime to SQLite.
5. Keep legacy JSON readers only for one-way import.
6. Run clean-install and upgrade tests on Windows.
7. Update `docs/NEXT_TASK.md` and `docs/TECHNICAL_DEBT.md`.

## Follow-up

After this RFC is implemented and stable:

1. build the backtest engine on the same strategy, risk, and accounting contracts;
2. add Telegram Remote Center v1 as a read-only/status-and-alert adapter over the same Control Plane;
3. later separate the always-on core service from the Electron desktop client for VPS operation.
