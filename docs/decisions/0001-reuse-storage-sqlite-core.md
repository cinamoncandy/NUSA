# Decision 0001 — Reuse the Existing SQLite Storage Core

Status: Accepted

Date: 2026-07-11

## Context

The repository already contains a SQLite implementation in `packages/storage/src/index.ts` using `node:sqlite`, transaction wrappers, idempotent ledger markers, and position snapshot repositories.

The desktop Paper and Control Plane runtime currently persists separate JSON session files. RFC 0001 requires replacing those files with versioned SQLite persistence without weakening restart safety, duplicate-order prevention, or fail-closed behavior.

Creating a second unrelated SQLite layer inside `apps/desktop` would duplicate transaction, migration, and recovery concerns and make later backtest and reporting integration harder.

## Decision

Extend the existing `packages/storage` SQLite core and keep application wiring in `apps/desktop`.

### Ownership

`packages/storage` owns:

- database lifecycle and connection configuration;
- schema versioning and migrations;
- transaction boundaries;
- Paper account and order repositories;
- Control Plane state and event repositories;
- processed automatic signal keys;
- integrity checks and repository-level decoding.

`apps/desktop` owns:

- Electron `userData` database path selection;
- startup recovery orchestration;
- legacy JSON import orchestration;
- visible diagnostics and Control Plane faulting;
- IPC and renderer publication;
- the rule that auto-trading is disabled after every restart.

## Required corrections to the current storage core

The current `SqliteDatabase` executes only `migrations[0].sql` during construction. The implementation must be changed before desktop integration so that it:

1. creates and reads a migration ledger;
2. applies every pending migration in ascending order;
3. wraps each migration in a transaction;
4. rejects unknown future schema versions;
5. runs `PRAGMA foreign_keys = ON`;
6. runs an integrity check before enabling Paper trading;
7. exposes explicit close and transaction behavior without renderer access.

## Transaction boundary

A successful Paper order must persist, in one transaction:

- updated account state;
- order/fill record;
- processed signal key for automatic orders;
- resulting Control event when applicable.

A failure at any point rolls back the entire operation. In-memory state must not be published as committed until the transaction succeeds.

## Migration from JSON

The first SQLite release must preserve legacy JSON files.

- Import only when the SQLite database is new and valid legacy JSON exists.
- Validate legacy Paper and Control state before import.
- Import both domains in one transaction.
- Record import completion in migration metadata.
- Never delete or overwrite legacy files automatically.
- If import is ambiguous or invalid, fault the Control Plane and keep trading disabled.

## Safety consequences

- Auto-trading remains OFF after restart regardless of restored status.
- A faulted recovery state cannot start or place orders until operator repair.
- Duplicate automatic signal keys survive restart.
- Telegram, Electron renderer, and future REST endpoints never access SQLite directly; they call the Control Plane/application service.

## Alternatives rejected

### New desktop-only SQLite implementation

Rejected because it duplicates an existing repository and transaction layer and would split accounting persistence from desktop persistence.

### Continue JSON persistence

Rejected because multi-record atomicity, queryable event history, migration control, and future reporting are insufficient.

### Add an ORM now

Rejected because the current scope is small, deterministic SQL is easier to audit, and adding a dependency does not improve the immediate safety objective.

## Follow-up

Implement RFC 0001 using this boundary, then build the backtest engine against the same strategy, accounting, and repository contracts.