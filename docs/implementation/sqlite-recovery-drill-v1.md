# SQLite Recovery Drill v1

The recovery drill uses an isolated temporary database. It verifies that a durable ledger row survives close/reopen and that a corrupted SQLite file is rejected during startup. It does not modify an operator database and does not attempt automatic repair.

## Supported Operator Recovery Procedure

1. Stop the application. Do not keep retrying commands against uncertain persistence.
2. Preserve the failed database file unchanged for incident evidence. Do not edit, delete, migrate, vacuum, or overwrite it in place.
3. Restore a known-good backup to the original database location while the application is stopped.
4. Restart the application and require SQLite safety pragmas, migration verification, and `quick_check` to pass.
5. Confirm Paper automatic trading is OFF after restart.
6. Review restored account, orders, Control state, processed signal keys, and available audit evidence.
7. Resume Paper operation only after explicit owner review and manual enablement.

No in-application repair command, automatic database repair, salvage, or merge of damaged and backup databases is supported. A database that fails integrity, migration, decoding, or persistence checks remains fail-closed.

Recovery remains PAPER/DRY_RUN-only. Manual orders, Control mutations, and automatic signal execution stay blocked until a verified database opens successfully. Restoring a backup does not automatically resume a strategy or automatic trading.
