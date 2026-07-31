# NUSA Rollback Guide

Rollback is a controlled install operation, not an in-app trading action.
Record the current version, commit, Evidence export, diagnostics bundle, and
configuration backup before changing versions.

Install the previously verified Windows installer, then launch it and confirm
the version in About. Run the startup and reconciliation checks before starting
any Paper or Shadow session. If migration validation fails, keep the recovery
gate closed and restore the backup through the documented owner-reviewed flow.

Do not delete the user-data directory, Evidence, recovery records, or crash
markers during rollback. Live trading and private API mutation remain disabled.
