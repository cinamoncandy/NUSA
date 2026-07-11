# SQLite Persistence Implementation Checklist

Status is intentionally split between implemented behavior and audit follow-up.

## Implemented

- [x] Ordered migration runner with a `schema_migrations` ledger.
- [x] Transactional migration application and rollback.
- [x] Unknown applied migration fails startup closed.
- [x] Main-process SQLite storage for Paper account, orders, Control state/events, signal keys, and import metadata.
- [x] One transaction writes the desktop runtime state.
- [x] Strict legacy JSON import input; JSON is preserved and imported once only.
- [x] Restart restores automatic trading as OFF.
- [x] Corrupt/partial storage blocks Paper trading.
- [x] Runtime command gate blocks manual orders, control commands, and automatic execution once persistence is unavailable.
- [x] Write failure restores broker, control, and strategy running state before faulting the runtime.
- [x] Tests cover fresh/reopened DBs, migration rollback, unknown migration, legacy import, corrupt DB, duplicate signal recovery, manual BUY/SELL rollback, control-command rollback, and automatic-order rollback.
- [x] Windows CI run #98: frozen install, typecheck, and 56/56 tests.

## Audit Follow-up

- [ ] Add migration checksum/name metadata if the RFC audit confirms it is required.
- [ ] Add SQLite integrity and foreign-key checks before startup if the persistence schema gains relationships.
- [ ] Complete a line-by-line RFC review of persisted-state decoding and renderer diagnostics.
- [ ] Keep PR #1 Draft until audit and owner review.

## Safety Boundaries

- PAPER only; no live order path or exchange private API calls.
- No credentials, tokens, or private account data are committed.
- Persistence errors use operator-facing messages; raw SQLite errors and paths are not sent to IPC callers.
- Legacy JSON source files are not deleted.
