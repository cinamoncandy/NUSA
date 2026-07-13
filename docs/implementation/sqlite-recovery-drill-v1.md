# SQLite Recovery Drill v1

The recovery drill uses an isolated temporary database. It verifies that a
durable ledger row survives close/reopen and that a corrupted SQLite file is
rejected during startup. It does not modify an operator database and does not
attempt automatic repair.

Recovery remains fail-closed: the application must preserve the damaged file,
keep Paper execution disabled, and require a verified restore and owner review.
