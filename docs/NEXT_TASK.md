# Next Task

## Completion update

The stabilization work below is implemented on `agent/electron-upbit-paper-trading`:

- malformed Paper and Control Plane sessions return visible diagnostics and fail closed;
- Paper account state, Control Plane status, events, order quantity, and processed automatic signal keys persist atomically;
- automated trading is always disabled after restart;
- faulted recovery state cannot restart a strategy without operator repair;
- duplicate automatic signals cannot create duplicate Paper orders;
- risk rejection is recorded as an outcome without terminating the process;
- manual and automatic Paper orders continue to use the same broker risk limits;
- Windows CI installs from a frozen lockfile and passes typecheck and all 39 tests.

Latest verified baseline:

- commit: `8bc72ab761b2f2e76a684852b48323e1e49dab78`
- Windows CI run: `#55`
- `pnpm run typecheck`: PASS
- `pnpm test`: PASS (39/39)

## Current next task — SQLite persistence

Implement `docs/rfc/0001-sqlite-persistence.md`.

### Objective

Replace the current Paper and Control JSON session files with a versioned SQLite event/account repository while preserving every existing safety guarantee.

### Required implementation

1. Add a main-process-only persistence abstraction and SQLite implementation.
2. Add schema versioning and transactional migrations.
3. Persist:
   - Paper account state,
   - Paper orders,
   - Control Plane state,
   - Control events,
   - processed automatic signal keys,
   - persistence diagnostics.
4. Make automatic signal-key claiming atomic and durable across restart.
5. Persist each Paper fill and its resulting account state in one transaction.
6. Keep automatic trading disabled after every restart.
7. Fault the Control Plane and block all orders on corrupt, unsupported, ambiguous, or partially migrated state.
8. Add a one-way JSON-to-SQLite migration path:
   - validate existing JSON strictly,
   - import both states in one transaction,
   - do not import twice,
   - retain legacy files after successful import by renaming them,
   - never delete legacy files in this task.
9. Keep the Electron renderer isolated from direct database access.
10. Update technical-debt and operation notes with any SQLite/runtime limitations discovered.

### Required tests

Add deterministic tests covering:

- fresh database creation,
- migration version tracking,
- Paper/account/order round trip,
- Control state/event round trip,
- transaction rollback,
- restart default-off behavior,
- processed signal-key persistence,
- duplicate signal rejection after restart,
- valid JSON import,
- corrupt JSON fail-closed behavior,
- corrupt SQLite fail-closed behavior,
- unsupported future schema,
- interrupted migration without partial data,
- existing risk and duplicate-order behavior.

### Acceptance criteria

- `pnpm install --frozen-lockfile` passes in Windows CI.
- `pnpm run typecheck` passes.
- `pnpm test` passes with all existing and new tests.
- Existing 39 tests remain green.
- No live order path, credential handling, or Binance code is added.
- No legacy JSON file is deleted.
- Automatic trading remains OFF after restart.
- One signal cannot create duplicate automatic orders across restarts.
- Persistence failure produces a visible diagnostic and blocks further orders.
- PR #1 remains Draft and is not merged without owner approval.

## Implementation order

1. Repository interfaces and migration runner.
2. SQLite schema and repository tests.
3. JSON import tests and implementation.
4. Electron runtime integration.
5. Full Windows CI verification.
6. Documentation update and audit report.

## After this task

1. Build the backtest engine against the same strategy, risk, accounting, and repository contracts.
2. Add Telegram Remote Center v1 for read-only status and alerts.
3. Later separate the always-on core service from Electron so the engine can run on a VPS while Electron and Telegram act as clients.
