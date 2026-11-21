# Backups and order-book retention (2026-11-20)

Status: read-only analysis from the repository. The host was not read. PAPER only; no gate, threshold, limit, capital or authority changes. This PR must not merge before the 2026-11-23 release (see section 5).

Labels used below: **FACT** (in code or a repo document, with the source), **GIVEN** (stated by the owner or the task, not found in the repo), **ESTIMATE** (computed here, not measured).

## 1. Question A: where do the backups go?

| Question | Answer | Source |
|---|---|---|
| What is backed up | Only the PAPER state SQLite file (`NUSA_CLOUD_STATE_DB_PATH`), as a `VACUUM INTO` snapshot. That one file holds the PAPER ledger and all research tables (order books, ticks, candles). Env files (`/etc/nusa/*.env`), the release tree, unit files and controller state are NOT backed up. | `scripts/sqlite-backup.js`, `docs/PROPOSAL`/`WO-ARCH-20261027-STATE-DB-SPLIT` (same_file_tables) |
| Where | `NUSA_BACKUP_DIR`, default `/var/backups/nusa`, on the same host. The release helper REQUIRES the state DB and the backup directory to be on the same disk (ext4/xfs, one device), because the I/O cap is per device. | `deploy/oracle/nusa-release-step.sh` `backup)` and `backup_block_device_for_paths` |
| When | Only inside a release (`backup` job of `oracle-paper-release.yml`, run by `sudo /opt/nusa/bin/nusa-release-step backup`). No timer or cron exists in `deploy/` or `scripts/`. No release means no backup. | workflow, `deploy/oracle/*` |
| Verification | On the copy: `PRAGMA integrity_check` must return ok, then a SHA-256 sidecar is written. The sidecar is never re-hashed against the file afterwards: retention only checks that the sidecar text is well formed and names the file. There is no check that the snapshot restores into a running service. | `verifyAndManifest`, `hasVerifiedSidecar` in `scripts/sqlite-backup.js` |
| Copies kept | 7 daily (one per UTC day that had a backup) and 4 weekly (made only when the backup runs on a UTC Sunday), so at most 11 verified files plus the one being written. The buckets are by calendar day, not by age: after a quiet fortnight the oldest copy can be weeks old. | `DAILY_RETENTION = 7`, `WEEKLY_RETENTION = 4` |
| Leaves the host? | No. Nothing in the repo copies a backup off the host (no rsync, rclone, object storage, snapshot). Searches for offsite, off-site, snapshot in `deploy/`, `scripts/`, `docs/`, `.github/` found none (the only hits are design proposals). One disk failure, one host loss or an operator `rm` takes the live DB and every copy together. | grep of the repo |
| Restore tested? | Not on the host. `scripts/backup-restore.js` has `backup`, `verify` and `drill` (verify-only on an isolated temporary directory) and `restore` throws "destructive restore is intentionally unsupported". No document records a restore of a real `/var/backups/nusa` file into a working runtime. `WO-ARCH-20261027-STATE-DB-SPLIT` still lists "until a restore drill passes" as a future gate. | `scripts/backup-restore.js` L565, work orders |

### Why the backup holds the live database for 35 to 56 minutes

- FACT: the throttle. The helper runs the backup in a transient systemd scope with `IOReadBandwidthMax` and `IOWriteBandwidthMax` of 1,048,576 B/s (1 MiB/s) plus `nice -n 19` (`nusa-release-step.sh`). This was added because an uncapped backup on the shared disk made the PAPER writer lease and listener unavailable (`WO-OPS-20261025-ORACLE-BACKUP-IO-THROTTLE`, observed about 0.8 MiB/s real).
- FACT: the work is several full passes over the file: `VACUUM INTO` (read the DB, write the copy), `integrity_check` of the copy, a SHA-256 pass, and on Sundays a full copy for the weekly file plus a second check and hash. The work order budgets "six Sunday full-file phases".
- FACT: observed durations: 30 min (runbooks), 48 to 51 min (redesign proposal), 36 and 37 min on 2026-11-17 with the maintenance window open (`2026-11-17-main-handoff.md`), 1 h 55 min on 2026-10-27 on the old 1 vCPU host (`WO-ARCH-20261027-STATE-DB-SPLIT`).
- FACT: the source DB is opened read-only in WAL mode, so the snapshot itself does not take a write lock; the stall comes from I/O contention and the read transaction that lasts the whole `VACUUM INTO`. The handoff states that `/health` and the collector stall for the duration, and the controller's 5-minute liveness check once stopped a healthy collector twice (2026-11-17). The "maintenance window" announces the backup to the controller.
- FACT: that maintenance window is bounded to 60 minutes (`maintenanceMaxMs: 60 * 60 * 1000`, `deploy/control/nusa-control.js`). A backup longer than an hour is no longer covered by it.
- ESTIMATE: backup time scales roughly linearly with DB bytes, because the throughput is capped, not CPU bound.

## 2. Question B: order-book retention

### The setting

- Name: `NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS`. Whole days 14 to 90; unset, empty, zero, non-numeric or leading-zero values give 14 with a log warning; below 14 gives 14; above 90 gives 90. FACT: `researchOrderBookRetention` in `apps/cloud/src/researchOrderBookCollector.ts` L36 to 56, read once in `apps/cloud/src/closedLearningProductionRuntime.ts` L200 to 203 at process start.
- Where the host gets it: NOWHERE in the repo. No shipped env file, no `deploy/oracle/paper-markets.json` key (that file is the owner market list, not runtime settings), no unit file sets it. The only mention outside code is `WO-RESEARCH-20261021-ORDERBOOK-RETENTION`, which tells the owner to put it in `/etc/nusa/cloud-runtime.env` by hand. `deploy/cloud-paper/README.md` confirms that file is created and edited on the host (`0600`). Whether the owner already set a value there is NOT VERIFIED; the 14-day statement in `docs/RESEARCH_HISTORY_MINING_DESIGN_2026-11-20.md` section 1 implies the default is in force.
- Because it is read at process start, a new value takes effect only at the next restart. The 2026-11-23 release restarts the runtime, so it is the natural moment (the release step sources the runtime env file and does not rewrite it).

### What the prune does

FACT, `pruneOrderBookSamplesBefore` in `packages/storage/src/marketMicrostructureStore.ts`, called hourly by the collector with cutoff = now minus retention (never less than 14 days):

1. It does not simply delete. In one transaction, for each market and at most one day of rows per call, it first copies the study-relevant rows into the archive table `research_orderbook_study_rows` (migration 032, `WITHOUT ROWID`): minutes 58, 59 and 0 of every hour, minutes 1 to 10 of the 00/04/08/12/16/20 UTC hours, minutes 43 to 45 of every hour. About 204 of 1,440 rows per market per day (14 percent). Then it deletes the live rows older than the cutoff. If the copy fails nothing is deleted.
2. The archive is trimmed to cutoff minus 61 days, so rows survive about 75 days with the 14-day default (75 + the extra retention days when raised).
3. The archive key is `(market, captured_at_ms)`. There is no `request_started_at_ms` column anywhere in the schema (the column list is market, captured_at_ms, best_bid, best_ask, bid_size_5, ask_size_5, total_bid_size, total_ask_size); the capture time is the collection round time.
4. Not archived (WO remaining_gaps): every other minute (86 percent), and the WebSocket-recorded markets (count-pruned, never archived).

Consequence for 2026-11-20 data: the first prune that touches it is about 2026-12-04. Then 86 percent of its rows are deleted irreversibly; 14 percent (the minutes above) stay in the archive until about 2027-02-03. The existing study design reads only those minutes; a NEW pre-registration (`docs/FINDINGS_2026-11-20.md` section 2) that needs other minutes would not have them.

### Row size and growth

| Item | Value | Label |
|---|---|---|
| Schema | 8 columns: market text (about 7 to 8 bytes), `captured_at_ms` integer, six REAL (8 bytes each); primary key `(market, captured_at_ms)` on a rowid table, so a second b-tree holds the key | FACT (`packages/storage/src/index.ts` migration 028) |
| Bytes per row incl. index | about 100 | ESTIMATE; the same figure the 2026-10-21 work order used |
| Samples per market per day | 1,440 (one per minute, all KRW markets, about 300) | FACT design, upper bound 432,000 rows/day |
| Rows per day on the host | about 368,000 (5.15 million / 14 days) | GIVEN 5.15 M rows on 2026-11-15; consistent with 0.36 M/day measured in October (`WO-RESEARCH-20261021`) and with the 68 percent hour coverage |
| Growth per day | about 37 MB | ESTIMATE |
| State DB total | 957 MiB on 2026-10-26 with 4.21 M book rows and 876 k ticks; not re-measured since | FACT (old, other host) |
| Disk | 77 GB, 33 percent used, 52 GB free on 2026-11-15 | FACT, `PAPER_RESTART_RUNBOOK_2026-11-14.md` |

### Retention options (ESTIMATES; 368 k rows/day, 100 B/row)

| Retention | Live rows | Live book size | Added to the DB vs 14 d | Added to up to 12 backup files | Backup time vs now |
|---|---|---|---|---|---|
| 14 d (today) | 5.15 M | 0.52 GB | 0 | 0 | 1.0x (36 to 56 min) |
| 28 d | 10.3 M | 1.03 GB | +0.52 GB | +6.2 GB | about 1.4x (about 51 to 80 min) |
| 45 d | 16.6 M | 1.66 GB | +1.14 GB | +13.7 GB | about 1.9x (about 70 to 108 min) |
| 60 d | 22.1 M | 2.21 GB | +1.69 GB | +20.3 GB | about 2.4x (about 87 to 136 min) |
| 90 d | 33.1 M | 3.31 GB | +2.79 GB | +33.5 GB | about 3.3x (about 120 to 185 min) |

The time column assumes the DB is about 1.2 GB today (ESTIMATE: 957 MiB in October plus about 0.1 GB of order-book growth and unmeasured tick growth; the real size is unknown) and linear scaling from the observed 36 min (11-17) to 56 min (upper observed). If the DB is bigger, the ratio is smaller. The 12 is 11 retained copies plus the one in progress; fewer if releases are rarer than one per day.

### Proposal

- FACT constraints: the maintenance window is 60 minutes; the backup step timeout is 180 minutes; a backup that outruns the window is the 2026-11-17 failure mode (the controller may stop the collector).
- Recommended value now: **28 days**. 11-20 data survives to about 2026-12-18 instead of 12-04, disk cost is about 0.5 GB live and about 6 GB worst case in copies (well inside 52 GB free), and the expected backup stays near the 60-minute window (about 51 min from today's best observed 36 min; the upper case of about 80 min exceeds it, so measure first).
- 45 days is defensible for disk (about 1.1 GB live, about 14 GB worst case in copies, leaves more than 35 GB of the 52 GB free) but NOT for the maintenance window: about 70 to 108 minutes exceeds the 60-minute bound. Choose 45 only together with recommendation 2 or 3 below (longer window or smaller backup), or if the owner accepts one unprotected backup per release.
- Needed: the new pre-registered study's data span, which this document does not know. Retention must cover (study end) minus (first usable day); set it from that, not the other way round.
- Deleted rows cannot be restored; raising retention now keeps only what has not been pruned yet (rows older than about 14 days already exist only as the 14 percent archive).

## 3. Risk list

1. Single host, single disk: live DB and all backups share one device by design (the helper enforces it). A disk or host loss, or a bad `rm`, loses everything. No offsite copy.
2. Restore never tested on a real snapshot. A backup that cannot be restored is only a hope. `integrity_check` proves the file opens, not that the service starts on it.
3. The backup stalls collection for 36 to 56 minutes per release. 32 releases in 8 days (handoff 2026-11-17) explain about 25 of the 61 uncovered order-book hours; coverage is 68.2 percent against a 90 percent bar.
4. The 60-minute maintenance window is shorter than the worst observed backup (56 min) plus growth; any growth of the DB pushes it over.
5. Backup time and the 180-minute timeout both depend on DB size; research tables inflate the PAPER state backup (split design not done).
6. Backups happen only at releases, so the "recovery point" can be old; there is no time-based schedule. Retention is by bucket, so seven backups can span far more than seven days or far less.
7. Backup excludes `/etc/nusa/*.env`, controller state and unit files: a rebuilt host cannot be restored from `/var/backups/nusa` alone.
8. Sidecar hash is written but not re-verified before use or before pruning older copies.
9. The retention value lives only in a host file: invisible to review, lost on a rebuilt host, and the repo cannot show whether it is set.
10. The first prune of 2026-11-20 data (about 2026-12-04) is irreversible for 86 percent of the rows.
11. Disk: the numbers above are estimates; no current `df` or `du` exists in the repo.

## 4. Recommended changes, ordered by value

| # | Change | Kind |
|---|---|---|
| 1 | Offsite copy: after each verified backup, copy the newest snapshot and its `.sha256` to storage off the host (another machine or object storage), encrypted, with the owner's own credentials. First step: copy the existing newest file once by hand and keep it. No repo script is proposed here because it needs a destination and credentials the repo must never hold. | owner host step |
| 2 | Restore drill on a scratch directory of the host or another machine: take the newest `/var/backups/nusa/daily-*.db`, `sha256sum -c` the sidecar, open it read-only, run `PRAGMA integrity_check`, then start a throwaway runtime copy with `NUSA_MODE=PAPER` and orders OFF against it and read `/health`. Record date, file, size, duration in a handoff. | owner host step (then a repo doc update) |
| 3 | Keep the backup inside the maintenance window as the DB grows: either raise `maintenanceMaxMs` (default 60 min) to cover the measured backup plus margin, or shrink the backup (state DB split, `WO-ARCH-20261027-STATE-DB-SPLIT`, so research tables are not in the release backup). | repo change (controller / split WO), needs its own PR and a controller upgrade |
| 4 | Set `NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS=28` before the 2026-11-23 release (see section 5). | owner host step |
| 5 | Measure before changing more: read-only diagnose of `du -sh /var/lib/nusa /var/backups/nusa`, `df -h`, the SQLite `dbstat` per-table size, and `SELECT count(*)` for `research_orderbook_samples` and `research_orderbook_study_rows`. Replace the estimates here. | owner host step (existing `oracle-host-diagnose` workflow already prints `du` and `df`) |
| 6 | Add `/etc/nusa/*.env` (without printing values) and the controller state to a separate root-only archive, kept next to the offsite copy. | owner host step |
| 7 | Make the sidecar check real: `hasVerifiedSidecar` should compare the stored hash with the file (or verify before the weekly copy), and a time-based minimum age for the oldest kept copy. Needs a reviewed PR and a helper reinstall. | repo change |
| 8 | Show the effective retention in `/health` or the startup log line so a reviewer can see the host value without SSH (the warning already logs only on bad values). | repo change |

## 5. Retention change: exact minimal step

The setting is only an env value on the host, so this PR changes no shipped file (nothing shipped holds it, and no file is invented).

Owner paste, on the host, before the 2026-11-23 release, after `df -h /` and `sudo du -sh /var/lib/nusa /var/backups/nusa` look fine (more than 20 GB free):

```sh
sudo grep -n '^NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS=' /etc/nusa/cloud-runtime.env || \
  echo 'NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS=28' | sudo tee -a /etc/nusa/cloud-runtime.env
sudo grep -n '^NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS=' /etc/nusa/cloud-runtime.env
sudo stat -c '%a %U:%G' /etc/nusa/cloud-runtime.env   # expect 600 and the owner it had before
```

If the first `grep` prints an existing line, edit that line by hand to the wanted number instead (a duplicate key would be ambiguous). Do not print or paste other lines of that file; it holds secrets.

Release step: nothing extra. The next `oracle-paper-release` run (2026-11-23) restarts the runtime, which reads the value at process start. After it, check the unit log for the absence of the warning `NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS=... below ... / above ...`, and that no row count drop appears for data younger than 28 days. To use 45 instead, change the number, but see the maintenance-window finding above first.

## 6. Not verified

- Anything on the host: file sizes, free disk, row counts, the real env file content, backup file list and ages, whether any manual offsite copy exists, whether a restore was ever done by hand.
- The 5.15 million rows figure is not in the repo (GIVEN).
- Backup durations beyond the cited runs; the DB size now.
- Whether `NUSA_RESEARCH_ORDERBOOK_RETENTION_DAYS` is already set on the host.
- The behavior of the controller if a backup outlasts its window (inferred from the 2026-11-17 handoff).
