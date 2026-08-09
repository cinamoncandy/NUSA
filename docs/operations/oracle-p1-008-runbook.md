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
- Oracle starts `dist/apps/cloud/src/oracleRuntime.js`, which injects the current canonical risk gate before PAPER fills.
- Canonical PAPER approval is never generated or inferred by the runtime. Missing, expired, mismatched, duplicate, P0, kill-switch, recovery, persistence, market-health, or stale-data conditions fail closed before a fill.
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

The minimum read-only environment file is:

```text
NUSA_CLOUD_DASHBOARD_PORT=3000
NUSA_CLOUD_DASHBOARD_HOST=127.0.0.1
NUSA_CLOUD_STATE_DB_PATH=/var/lib/nusa/cloud-state.db
NUSA_CLOUD_DASHBOARD_TOKEN=<secret>
```

To enable the existing PAPER execution loop on Oracle, configuration remains explicit and bounded:

```text
NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW=<positive-number>
NUSA_CLOUD_RISK_POLICY_FINGERPRINT=<approved-policy-fingerprint>
NUSA_CLOUD_PAPER_MAX_DAILY_LOSS_KRW=<positive-number>
NUSA_CLOUD_PAPER_MAX_OPEN_ORDERS=<positive-integer>
NUSA_CLOUD_PAPER_APPROVAL_ID_KRW_BTC=<existing-canonical-approval-id>
NUSA_CLOUD_PAPER_APPROVAL_ID_KRW_ETH=<existing-canonical-approval-id>
```

The canonical strategy identity for this Oracle Cloud loop is `cloud-cio-paper-v1`. Each approval stored in the current durable canonical risk repository must match `PAPER`, the exact market symbol, this strategy ID, and the configured policy fingerprint. A generic `NUSA_CLOUD_PAPER_APPROVAL_ID` may be used as a fallback, but market-specific IDs are preferred because canonical approval scope is symbol-bound. The runtime never creates an approval. If no valid approval exists, the canonical gate returns `APPROVAL_MISSING` (or the relevant mismatch/expiry reason) and no fill occurs.

Generate or rotate the dashboard secret atomically with:

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

When PAPER execution is enabled, additionally verify the risk-policy fingerprint, daily-loss limit, open-order limit, and intended market approval IDs are present. Do not weaken or bypass these values to recover service.

## Atomic release switch

Stage and verify the complete release at `/opt/nusa/releases/<full-sha>` first. Then switch only the symlink:

```bash
sudo env NUSA_COMMIT_SHA=<full-40-char-sha> node scripts/atomic-deploy.js
sudo systemctl daemon-reload
sudo systemctl restart nusa.service
```

The switch records the prior release path and reports `readinessRequired=true`. It does not restart services itself and does not touch persistent data.

## Acceptance check

Check process liveness locally, then run the authenticated readiness probe. The readiness script reads the bearer token from `/etc/nusa/cloud-runtime.env`, so the secret is not passed on the command line or printed.

```bash
curl --fail --silent http://127.0.0.1:3000/health
sudo node scripts/oracle-readiness-check.js
```

Accept the release only when `/ready` returns HTTP 200 and all four checks are true: database, migrations, dashboard persistence, and runtime recovery.

A healthy `/ready` response does not itself grant PAPER execution. Canonical approval, P0, kill switch, market freshness/health, recovery, persistence, daily-loss, open-order and idempotency checks remain authoritative on every actionable PAPER tick.

## Failed readiness: rollback

If readiness fails, do not attempt an automatic database restore. Roll the release symlink back, restart, and prove readiness again:

```bash
sudo env NUSA_DEPLOY_ACTION=rollback node scripts/atomic-deploy.js
sudo systemctl restart nusa.service
sudo node scripts/oracle-readiness-check.js
```

If rollback readiness also fails, stop the service and investigate the persistent state and logs. Do not bypass readiness, relax localhost binding, shorten the token, loosen canonical risk limits, fabricate approval, or enable LIVE/private mutation to recover service.

## Operational logging

Cloud operational events use JSON records with `timestamp`, `severity`, `event`, and `correlationId`. The structured logger redacts secret/token/password/authorization/API-key/credential-shaped fields. Operator scripts also emit JSON status records and must not include secret material.

Use journald as the host transport:

```bash
journalctl -u nusa.service --since today --output=cat
```

## Restore policy

Backups are evidence for a **manual, reviewed** restore. No script in this scope automatically overwrites the live database, deletes Evidence, or mutates production state. A restore requires a separate maintenance decision, service stop, checksum/integrity verification, preserved pre-restore copy, and post-restore authenticated readiness verification. Canonical PAPER approvals and risk state are part of the durable database and must be reviewed after restore before PAPER execution is considered safe to resume.
