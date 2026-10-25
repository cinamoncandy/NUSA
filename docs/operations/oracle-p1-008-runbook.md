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
/etc/systemd/system/nusa-research.service root:root 0644
/etc/systemd/system/nusa-research.timer root:root 0644
/etc/systemd/system/nusa-autopilot.service root:root 0644
/opt/nusa/releases/<sha>/          immutable release
/opt/nusa/current -> releases/...  atomic symlink
/var/lib/nusa/                     nusa:nusa persistent state
/var/backups/nusa/                 nusa:nusa backup snapshots
```

The manual `Oracle PAPER Release` workflow requires an online, dedicated repository runner
with the `nusa-paper-host` label on this host. Run it as an unprivileged account separate from
`nusa`; do not use the Codex development runner. Install the reviewed
`deploy/oracle/nusa-release-step.sh` as root-owned mode `0755` at
`/opt/nusa/bin/nusa-release-step`, outside the release tree, and grant that runner account
passwordless sudo for that exact helper only. A missing runner leaves dispatches queued without
deploying anything. The workflow builds on GitHub-hosted Linux and verifies the built archive's
SHA-256. Before backup or other release mutation, it also requires the installed `/opt/nusa/bin/nusa-release-step`
to be byte-for-byte identical to `deploy/oracle/nusa-release-step.sh` from the exact reviewed bundle. If that helper
source changed, install the reviewed root-owned helper first; never let the release tree replace its own privileged
helper. Only then may the host back up, stage, switch, restart, and check readiness. Never build the repository on
the 1 GB PAPER host as part of a release.

Create the service user and persistent directories with the least privileges required by your host policy. The helper installs all four units from the exact staged release; do not copy units from a dirty checkout.

## Environment and token rotation

The minimum environment file is:

```text
NUSA_CLOUD_DASHBOARD_PORT=3000
NUSA_CLOUD_DASHBOARD_HOST=127.0.0.1
NUSA_CLOUD_STATE_DB_PATH=/var/lib/nusa/cloud-state.db
NUSA_CLOUD_DASHBOARD_TOKEN=<secret>
NUSA_AUTOPILOT_RUNTIME_ENDPOINT=https://<canonical-autopilot-worker>/scheduled/run
NUSA_AUTOPILOT_RUNTIME_TOKEN=<secret>
NUSA_AUTOPILOT_STATE_PATH=/var/lib/nusa/autopilot/runtime-state.json
NUSA_AUTOPILOT_INTERVAL_MS=60000
NUSA_AUTOPILOT_MAX_ATTEMPTS=3
```

Generate or rotate the secret atomically with:

```bash
sudo -u root node scripts/generate-dashboard-token.js
```

The script writes mode `0640`, prints only metadata, and reports `restartRequired=true`. Restart the service after rotation; there is deliberately no old-token grace period.

## Backup

Before a release switch:

```bash
sudo /opt/nusa/bin/nusa-release-step backup
```

The canonical root-owned release helper embeds the topology resolver so the first release can verify storage without depending on the old active release containing a new resolver script. It requires both the state database and backup directory to resolve to the same single ext4/xfs backing disk; unsupported or multi-device filesystems, split devices, remote sources, and ambiguous topology fail closed. It runs the existing `scripts/sqlite-backup.js` SQLite `VACUUM INTO` backup inside a transient systemd cgroup capped at exactly 1,048,576 bytes/second (1 MiB/s) read and write with low CPU priority, then runs `PRAGMA integrity_check` and writes a SHA-256 sidecar. It retains one verified snapshot per UTC calendar bucket for the most recent 7 daily buckets and 4 weekly buckets (same-day/same-week release duplicates are pruned), and never changes application Evidence or trading state. The cap only limits backup throughput; backup completion and integrity remain required.

Verify that the command reports `status=PASS` before continuing.

## Bounded release disk hygiene

When root disk pressure is high, use the privileged helper rather than ad-hoc wildcard deletion:

```bash
sudo /opt/nusa/bin/nusa-release-step prune
```

The prune operation validates every direct child of `/opt/nusa/releases` as a real 40-hex release directory before deleting anything. It always preserves the active release and the rollback release recorded in `.previous-release`, and retains no additional superseded release (`RELEASE_RETENTION=0`). The host previously retained two extras, but an observed 2026-10-17 release had four 1.6 GB trees, an 88% idle root baseline, and 93% staging pressure. One-generation rollback remains intact while superseded source remains recoverable from GitHub. It never touches `/var/lib/nusa` or `/var/backups/nusa`.

## Preflight validation

Run both checks from the release tree:

```bash
node scripts/host-security-validate.js
sudo node scripts/oracle-validate.js
```

`oracle-validate` fails closed if the environment file, backup directory, service unit, localhost binding, token strength, persistent database location, or current symlink contract is invalid.

## When to dispatch the release workflow
The workflow verifies that the requested source is the current protected main three times: when the build job
starts, at the start of the host job before download, and immediately before activation after backup/staging/preflight.
A merge that lands before the final check therefore fails closed instead of activating a stale release. To avoid wasted
releases:
1. Dispatch only when no merge is queued or in flight, and take `source_sha` from the current main tip.
2. Wait for the post-merge `CI` push run on that exact SHA to be green; the workflow requires it and fails otherwise.
3. If main moved before the host recheck, nothing was changed on the host; repeat steps 1-2 with the new tip. If main may
   have moved after it, check which commit is active before assuming the release matches the latest main.

## Atomic release switch

Stage and verify the complete release at `/opt/nusa/releases/<full-sha>` first. The canonical `activate` helper then installs the four unit files from that exact immutable release, enables them, atomically switches the symlink, restarts PAPER and Autopilot, and proves readiness. If any step fails, it restores the prior symlink and unit set before returning failure:

```bash
sudo /opt/nusa/bin/nusa-release-step preflight <full-40-char-sha>
sudo /opt/nusa/bin/nusa-release-step activate <full-40-char-sha>
```

The switch records the prior release path and reports `readinessRequired=true`. It does not restart services itself and does not touch persistent data.
The helper executes the staged `scripts/atomic-deploy.js`, `scripts/oracle-readiness-check.js`, and `scripts/autopilot-readiness.js`; no host-side copy of those scripts is used. Initial authenticated `/ready` keeps the 300-second cold-start budget, with each request capped at 5 seconds and 1-second retry delay. The two non-mutating mobile-owner route-presence probes share a separate bounded 30-second proof window; initial activation uses each route request cap of 5 seconds and a 1-second retry delay. After initial readiness, the same root-owned `activate` helper retains ownership for a 180-second stability soak. It repeatedly proves PAPER readiness, Autopilot readiness, systemd liveness, and exact release identity. During soak, authenticated `/ready` uses a bounded 30-second retry window, with each request capped at 2 seconds and 500 ms retry delay, so repeated short event-loop stalls can recover without weakening detection of sustained listener/lease loss. The same 30-second route-proof bound applies during post-activation checks, with route requests capped at 2 seconds and a 500 ms retry delay. Wrong route status, sustained failure, timeout, or identity drift still rolls back inside the existing activation boundary; a one-shot listener that later loses its PAPER writer lease is never accepted as `DEPLOYED`.

Before copying an immutable release into `/opt/nusa/releases`, the root-owned helper computes the extracted source size and requires enough free root space to complete the copy while still preserving the existing 92% disk-guard boundary plus a 512 MiB safety margin. Preflight then checks the actual post-stage root usage and refuses activation at or above 92%. The workflow never deletes host data; persistent state, backups, and Evidence are untouched.

## Acceptance check

Check process liveness locally, then run the authenticated readiness probe. The readiness script reads the bearer token from `/etc/nusa/cloud-runtime.env`, so the secret is not passed on the command line or printed.

```bash
curl --fail --silent http://127.0.0.1:3000/health
sudo node scripts/oracle-readiness-check.js
```

Accept the release only when `/ready` returns HTTP 200 and all four checks are true: database, migrations, dashboard persistence, and runtime recovery. The activation helper also requires `autopilot-readiness.js` to observe a fresh, non-blocked heartbeat with all zero-authority markers intact.

## Failed readiness: rollback

If PAPER startup readiness fails with `PAPER_WRITER_CLOCK_ANOMALY` in the current activation journal, `activate` may perform one bounded recovery before rollback. It invokes the staged canonical `reset-paper-writer-lease.js` as the `nusa` service user; that script refuses to clear a lease while `/health` answers or while the lease is still valid, and it only removes the `paper-default` writer-lease row. The helper then restarts and retries PAPER readiness exactly once. Any unrelated readiness failure, reset refusal, or failed retry proceeds to the normal rollback path.\n\nIf readiness still fails, do not attempt an automatic database restore. The `activate` helper rolls the release symlink and systemd unit files back, restarts both runtimes, and proves readiness again. If rollback readiness also fails, stop the services and investigate the persistent state and logs. Do not bypass readiness, relax localhost binding, shorten the token, or enable LIVE/private mutation to recover service.

```bash
sudo systemctl status nusa.service nusa-autopilot.service --no-pager
sudo node /opt/nusa/current/scripts/oracle-readiness-check.js
```

## Operational logging

Cloud operational events use JSON records with `timestamp`, `severity`, `event`, and `correlationId`. The structured logger redacts secret/token/password/authorization/API-key/credential-shaped fields. Operator scripts also emit JSON status records and must not include secret material.

Use journald as the host transport:

```bash
journalctl -u nusa.service --since today --output=cat
```

## Restore policy

Backups are evidence for a **manual, reviewed** restore. No script in this scope automatically overwrites the live database, deletes Evidence, or mutates production state. A restore requires a separate maintenance decision, service stop, checksum/integrity verification, preserved pre-restore copy, and post-restore authenticated readiness verification.
