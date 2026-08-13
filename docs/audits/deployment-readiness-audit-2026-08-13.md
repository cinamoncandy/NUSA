# Deployment Readiness Audit - 2026-08-13

## Scope

Audit the repository-controlled deployment boundary for environment configuration,
database placement and migrations, health/readiness, shutdown, backup/restore,
logging, least privilege, and Firebase readiness.

## Evidence

- `pnpm run release:check`: `TECHNICAL_CHECKS_PASS` (preflight, typecheck, build,
  package contract, auto-update disabled).
- Focused readiness suite: 102/104 passed. The two unavailable cases are the
  Windows symlink fixtures in `backup-restore.test.js` and
  `recovery-backup-scan-copy-atomicity.test.js`; both fail before application
  assertions with `EPERM` because this environment does not permit symlink
  creation. They are not weakened or skipped.
- Configuration validation covers required port/token, loopback-only binding,
  bounded markets, positive initial capital, bounded investment percentage,
  stable identities, duplicate identity rejection, and default PAPER behavior.
- Authenticated `/ready` reports database, migrations, dashboard persistence,
  and runtime recovery independently; unknown or unhealthy checks return
  fail-closed readiness.
- Graceful shutdown is bounded, idempotent, and exits non-zero on stop failure
  or timeout. Backup verification is checksum-, manifest-, and secret-scan
  bound; destructive restore is intentionally unavailable.
- Oracle/readiness and deployment scripts enforce an external database path,
  localhost binding, non-root systemd service, restricted writable paths, and
  no credential output. Firebase remains readiness-only with SQLite
  authoritative and emulator deployment blocked by unavailable CLI.

## Not claimed

Production signing, installed-machine GUI smoke, real Firebase deployment,
production smoke, and physical Android acceptance require external environment
evidence and remain `HUMAN_ENVIRONMENT_ONLY` or blocked.

## Safety

`PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`,
`realOrderAuthority=false`, `realTransferAuthority=false`, and AI
`ZERO_AUTHORITY` remain unchanged. No broker credential or LIVE capability is
introduced.
