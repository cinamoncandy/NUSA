# Oracle PAPER Operations Runbook

This runbook deploys the NUSA Cloud runtime to an Oracle Linux host while preserving the current PAPER/read-only safety boundary. It does **not** authorize LIVE trading, private broker mutation, credential expansion, automatic data restore, or Evidence mutation.

## Invariants

- Service user/group: `nusa:nusa`; never root.
- Dashboard bind: `127.0.0.1` or `localhost` only.
- `/health`: unauthenticated liveness only.
- `/ready`: authenticated readiness; all checks must be true before a release is accepted.
- Dashboard token: at least 32 UTF-8 bytes; generated token material is never printed.
- Runtime database and backups live outside `/opt/nusa/current`.
- Releases are immutable directories under `/opt/nusa/releases/<full-commit-sha>`.
- `/opt/nusa/current` is an atomic symlink.
- `productionMutationAllowed=false`; no deploy step changes execution authority.

## Host layout

```text
/etc/nusa/cloud-runtime.env        root:nusa 0640
/etc/systemd/system/nusa.service  root:root 0644
/opt/nusa/releases/<sha>/          immutable release
/opt/nusa/current -> releases/...  atomic symlink
/var/lib/nusa/                     nusa:nusa persistent state
/var/backups/nusa/                 nusa:nusa backup snapshots
```

Create the service user and persistent directories with the least privileges required by your host policy. Install `deploy/oracle/nusa.service` as `/etc/systemd/system/nusa.service` and run `node scripts/host-security-validate.js` before enabling it.

## Environment and token rotation

The minimum environment file is:

```text
NUSA_CLOUD_DASHBOARD_PORT=3000
NUSA_CLOUD_DASHBOARD_HOST=127.0.0.1
NUSA_CLOUD_STATE_DB_PATH=/var/lib/nusa/cloud-state.db
NUSA_CLOUD_DASHBOARD_TOKEN=<secret>
```

Generate or rotate the secret atomically with:

```bash
sudo -u root node scripts/generate-dashboard-token.js
```

The script writes mode `0640`, prints only metadata, and reports `restartRequired=true`. Restart the service after rotation; there is deliberately no old-token grace period.

## Backup

Before a release switch:

```bash
sudo -u nusa node scripts/sqlite-backup.js
```

The backup uses SQLite `VACUUM INTO`, runs `PRAGMA integrity_check`, writes a SHA-256 sidecar, retains the most recent 7 daily snapshots and 4 weekly snapshots, and never changes application Evidence or trading state.

Verify that the command reports `status=PASS` before continuing.

## Preflight validation

Run both checks from the release tree:

```bash
node scripts/host-security-validate.js
sudo node scripts/oracle-validate.js
```

`oracle-validate` fails closed if the environment file, backup directory, service unit, localhost binding, token strength, persistent database location, or current symlink contract is invalid.

## Read-only release identity observation

Before changing a release, and again after readiness succeeds, observe the Oracle release identity from the host itself:

```bash
sudo -u nusa env NUSA_EXPECTED_SHA=<full-40-char-protected-main-sha> \
  node scripts/oracle-release-observation.js
```

The observer is read-only. It never changes `/opt/nusa/current`, releases, services, databases, credentials, or trading authority. It emits one JSON record and exits non-zero unless the `current` symlink resolves to the exact expected immutable release directory.

Interpret its `status` as follows:

- `CURRENT`: observed SHA exactly equals the expected SHA and the release is staged under `/opt/nusa/releases`.
- `STALE`: `current` resolves to a valid older/different release. The record also distinguishes whether the expected release is already staged.
- `BLOCKED`: deployment identity cannot be trusted, for example because the expected SHA is malformed, `current` is missing/not a symlink, or the target is unreadable/invalid.

Do not label Oracle current or globally converged when the observer reports `STALE` or `BLOCKED`.

Until a dedicated trusted Oracle evidence publisher exists, the protected deployment convergence receipt accepts the SHA from this local read-only observation as an explicit operator-provided input. This is an auditable handoff, not a substitute for the authenticated readiness check. Dispatch only after capturing the host observation:

```bash
gh workflow run deployment-convergence-receipt.yml \
  -f source_sha=<full-40-char-protected-main-sha> \
  -f oracle_observed_sha=<observer-observed-sha>
```

If `oracle_observed_sha` is absent, malformed, or different from `source_sha`, the global convergence receipt remains fail-closed.

## Atomic release switch

Stage and verify the complete release at `/opt/nusa/releases/<full-sha>` first. Then switch only the symlink:

```bash
sudo env NUSA_COMMIT_SHA=<full-40-char-sha> node scripts/atomic-deploy.js
sudo systemctl daemon-reload
sudo systemctl restart nusa.service
```

The switch records the prior release path and reports `readinessRequired=true`. It does not restart services itself and does not touch persistent data.

A repeated convergence request for a SHA that already observes as `CURRENT` must not run the switch again. Record the observation as already converged and continue with receipt publication only. This keeps same-SHA convergence idempotent and avoids unnecessary service restarts.

## Acceptance check

Check process liveness locally, then run the authenticated readiness probe. The readiness script reads the bearer token from `/etc/nusa/cloud-runtime.env`, so the secret is not passed on the command line or printed.

```bash
curl --fail --silent http://127.0.0.1:3000/health
sudo node scripts/oracle-readiness-check.js
```

Accept the release only when `/ready` returns HTTP 200 and all four checks are true: database, migrations, dashboard persistence, and runtime recovery. Then run the read-only release identity observation again and require `status=CURRENT` for the exact protected-main SHA.

## Failed readiness: rollback

If readiness fails, do not attempt an automatic database restore. Roll the release symlink back, restart, and prove readiness again:

```bash
sudo env NUSA_DEPLOY_ACTION=rollback node scripts/atomic-deploy.js
sudo systemctl restart nusa.service
sudo node scripts/oracle-readiness-check.js
```

After rollback, run `scripts/oracle-release-observation.js` again against the attempted target SHA. It must report non-current (`STALE`) and global deployment convergence must remain failed for that target. Preserve the failed readiness output, rollback output, and observer output as incident evidence.

If rollback readiness also fails, stop the service and investigate the persistent state and logs. Do not bypass readiness, relax localhost binding, shorten the token, or enable LIVE/private mutation to recover service.

## Operational logging

Cloud operational events use JSON records with `timestamp`, `severity`, `event`, and `correlationId`. The structured logger redacts secret/token/password/authorization/API-key/credential-shaped fields. Operator scripts also emit JSON status records and must not include secret material.

Use journald as the host transport:

```bash
journalctl -u nusa.service --since today --output=cat
```

Treat any staging, filesystem access, validation, readiness, or rollback failure as a durable deployment-blocked state. Preserve the corresponding command output and do not clear the state merely because Cloudflare, Android, Windows, or PAPER evidence is green.

## Restore policy

Backups are evidence for a **manual, reviewed** restore. No script in this scope automatically overwrites the live database, deletes Evidence, or mutates production state. A restore requires a separate maintenance decision, service stop, checksum/integrity verification, preserved pre-restore copy, and post-restore authenticated readiness verification.
