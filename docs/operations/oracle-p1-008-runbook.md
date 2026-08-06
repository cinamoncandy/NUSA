# Oracle P1 #008 Operations Runbook

The repository owns `deploy/oracle/nusa.service` and validation scripts. Installing into `/etc`, `/opt`, or `/var` requires explicit operator approval.

## Install and deploy

Build and preflight in a versioned directory `/opt/nusa/releases/<commit-sha>`, then atomically replace `/opt/nusa/current`. Start with `systemctl restart nusa`; verify authenticated `/ready` before accepting the release. On readiness failure, restore the previous symlink and restart. Do not run destructive migrations.

## Token rotation

Run `NUSA_ENV_FILE=/etc/nusa/cloud-runtime.env node scripts/generate-dashboard-token.js`, then restart the service. Rotation invalidates the old token immediately. Never print the token or pass it in process arguments.

## Backup and restore

Use SQLite online backup into `/var/backups/nusa`, write a SHA-256 manifest, run `PRAGMA integrity_check`, and retain seven daily and four weekly copies. On corruption, stop the service, preserve DB/WAL/SHM, restore a verified copy, run integrity checks, restart, and keep Paper execution fail-closed until owner review.

## Incident and host checklist

Verify `User=nusa`, `Group=nusa`, non-root execution, mode 0640 for the environment file, localhost-only bind, no external port 3000, SSH root/password login disabled, and least-privilege DB/backup/log directories. Oracle Security List/NSG checks remain manual.
