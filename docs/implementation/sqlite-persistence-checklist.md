# SQLite Persistence Implementation Checklist

Status is intentionally split between implemented behavior and audit follow-up.

## Implemented

- [x] Ordered migration runner with a `schema_migrations` ledger.
- [x] Transactional migration application and rollback.
- [x] Unknown applied migration fails startup closed.
- [x] Applied migration IDs are immutable. Renaming, deleting, or reusing an applied ID is unsupported and fails startup closed; compatibility changes require a new, later migration.
- [x] Migration checksums cover both the immutable ID and SQL. SQL drift under an applied ID fails startup closed.
- [x] Legacy migration ledgers without the checksum column/value are upgraded in place: the original ID, applied timestamp, schema, and application rows are preserved while the current checksum is backfilled once.
- [x] Main-process SQLite storage for Paper account, orders, Control state/events, signal keys, and import metadata.
- [x] One transaction writes the desktop runtime state.
- [x] Strict legacy JSON import input; JSON is preserved and imported once only.
- [x] Restart restores automatic trading as OFF.
- [x] Corrupt/partial storage blocks Paper trading.
- [x] Runtime command gate blocks manual orders, control commands, and automatic execution once persistence is unavailable.
- [x] Write failure restores broker, control, and strategy running state before faulting the runtime.
- [x] Required SQLite safety pragmas are applied and verified: `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL`, and `busy_timeout=5000`.
- [x] Startup runs `PRAGMA quick_check`; failure closes the connection and blocks persistence startup.
- [x] Tests cover fresh/reopened DBs, migration rollback, unknown migration, immutable-ID rename rejection, checksum drift, legacy checksum backfill/data preservation, legacy import, corrupt DB, duplicate signal recovery, manual BUY/SELL rollback, control-command rollback, and automatic-order rollback.

## Migration Compatibility Policy

1. The full migration ID, including numeric prefix and descriptive name, is a permanent database identity after release.
2. Never rename, delete, reorder, or edit SQL for an applied migration.
3. Corrections and schema evolution are append-only and use a new strictly greater ID.
4. A database containing an ID absent from the current plan is treated as incompatible and fails closed without modifying application data or the migration ledger.
5. A checksum mismatch is treated as migration drift and fails closed.
6. Legacy rows without checksum metadata may be backfilled only when the exact ID still exists in the current plan. Backfill does not rerun migration SQL or rewrite `applied_at`.
7. There is no implicit alias or rename mapping. Any exceptional compatibility bridge requires an explicit reviewed migration and fixture-based regression coverage.

## Audit Follow-up

- [ ] Complete a line-by-line RFC review of persisted-state decoding and renderer diagnostics.
- [ ] Keep PR #1 Draft until audit and owner review.

## Safety Boundaries

- PAPER only; no live order path or exchange private API calls.
- No credentials, tokens, or private account data are committed.
- Persistence errors use operator-facing messages; raw SQLite errors and paths are not sent to IPC callers.
- Legacy JSON source files are not deleted.
