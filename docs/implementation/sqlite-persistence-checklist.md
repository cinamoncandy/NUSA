# SQLite Persistence Implementation Checklist

Source documents:

- `docs/rfc/0001-sqlite-persistence.md`
- `docs/decisions/0001-reuse-storage-sqlite-core.md`
- `AGENTS.md`

## 1. Migration engine

- [ ] Replace single-migration startup with an ordered migration runner.
- [ ] Add migration ledger table with version, name, checksum, and applied timestamp.
- [ ] Apply each migration transactionally.
- [ ] Reject a database whose schema version is newer than the application supports.
- [ ] Enable foreign keys.
- [ ] Add startup integrity and foreign-key checks.
- [ ] Keep `:memory:` support for deterministic tests.

## 2. Repository contracts

Add explicit repository interfaces and SQLite implementations for:

- [ ] Paper account state.
- [ ] Paper orders/fills.
- [ ] Control Plane state.
- [ ] Control events.
- [ ] Processed automatic signal keys.
- [ ] Migration/import metadata.

Repository decoding must validate enum values, finite numeric values, non-negative quantities, supported state versions, and required relationships.

## 3. Atomic application service

- [ ] Add one application-level transaction for an accepted Paper order.
- [ ] Persist account state, order, signal key, and Control event together.
- [ ] Do not mutate or publish committed in-memory state before database commit.
- [ ] Return explicit accepted, duplicate, risk-rejected, and persistence-failed outcomes.
- [ ] Keep manual and automatic orders on the same broker/risk path.

## 4. Startup recovery

- [ ] Open the database from Electron `userData`.
- [ ] Run migrations and integrity checks before starting the market stream.
- [ ] Restore Paper account, orders, Control state, events, and signal keys.
- [ ] Force auto-trading OFF after every restart.
- [ ] Fault and disable order paths when recovery is corrupt or ambiguous.
- [ ] Publish a visible diagnostic to the renderer.

## 5. Legacy JSON import

- [ ] Detect a new SQLite database plus legacy Paper/Control JSON files.
- [ ] Validate both JSON documents using the existing strict validators.
- [ ] Import both in one transaction.
- [ ] Record import source and completion metadata.
- [ ] Preserve legacy JSON files unchanged.
- [ ] Never repeat a completed import.
- [ ] Fail closed on partial, conflicting, or corrupt legacy state.

## 6. Tests

Required deterministic tests:

- [ ] Fresh database creates every migration and repository.
- [ ] Reopening an up-to-date database is idempotent.
- [ ] Pending migrations apply in order.
- [ ] Migration failure rolls back schema and migration ledger changes.
- [ ] Future schema version is rejected.
- [ ] Foreign-key and integrity failure blocks startup.
- [ ] Paper order transaction commits all records.
- [ ] Injected persistence failure rolls back all records.
- [ ] Duplicate automatic signal remains blocked after restart.
- [ ] Auto-trading restores as OFF.
- [ ] Faulted state cannot start or place manual/automatic orders.
- [ ] Valid JSON imports exactly once.
- [ ] Invalid JSON imports nothing and faults recovery.
- [ ] Legacy files remain present and unchanged.
- [ ] Existing position-ledger and snapshot tests remain green.

## 7. Validation and PR rules

- [ ] `pnpm install --frozen-lockfile` passes on Windows CI.
- [ ] `pnpm run typecheck` passes.
- [ ] `pnpm test` passes in full.
- [ ] PR remains Draft until audit.
- [ ] PR description includes migration, recovery, rollback, and safety results.
- [ ] No live order, credential, Telegram control, or Binance code is added in this batch.

## Completion report format

Report:

1. changed files;
2. schema and migration versions;
3. transaction boundaries;
4. JSON import behavior;
5. recovery/fail-closed behavior;
6. tests added and full results;
7. warnings and remaining technical debt;
8. commit SHA and CI run;
9. confirmation that the PR remains Draft and unmerged.