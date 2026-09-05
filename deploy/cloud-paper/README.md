# NUSA Cloud PAPER production runtime

This deployment layer runs the canonical supervised Cloud PAPER runtime continuously on a Linux Cloud/Server host. It also schedules the canonical public-market Research snapshot producer required by the first-PAPER bootstrap and later closed-learning cycles. It does **not** add a second PAPER engine and does not grant LIVE authority.

## Safety contract

- `NUSA_MODE=PAPER`
- `NUSA_LIVE_MUTATION=PROHIBITED`
- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- AI remains `ZERO_AUTHORITY`
- Upbit access is PUBLIC market-data only; do not provision private exchange credentials.
- The Node HTTP server remains bound to `127.0.0.1`; expose it only through an HTTPS reverse proxy.

## Canonical Oracle host layout

- immutable releases: `/opt/nusa/releases/<exact-protected-main-sha>`
- active pointer: `/opt/nusa/current`
- protected runtime env: `/etc/nusa/cloud-runtime.env` (`0600`)
- durable SQLite state: `/var/lib/nusa/state.sqlite`
- runtime-local HOME/token state: `/var/lib/nusa/.nusa/cloud`
- Cloud PAPER unit: `/etc/systemd/system/nusa-cloud-paper.service`
- Research unit: `/etc/systemd/system/nusa-research.service`
- Research timer: `/etc/systemd/system/nusa-research.timer`

The canonical Oracle unit templates live under `deploy/oracle/`.

## Install / update from an exact protected-main SHA

1. Build the exact protected-main SHA into `/opt/nusa/releases/<sha>` with Node 24+ and pnpm 11.7.0+, then atomically point `/opt/nusa/current` at that immutable release.
2. Create the dedicated unprivileged `nusa` user/group and writable `/var/lib/nusa` state directory.
3. Create `/etc/nusa/cloud-runtime.env`, set `NUSA_SOURCE_COMMIT` to the exact deployed 40-hex protected-main SHA, keep `NUSA_MODE=PAPER`, `NUSA_LIVE_MUTATION=PROHIBITED`, and use a durable `NUSA_CLOUD_STATE_DB_PATH` (never `:memory:`). `chmod 0600` the file.
4. Install the runtime and Research systemd units from the exact current release:

```bash
sudo cp /opt/nusa/current/deploy/oracle/nusa.service /etc/systemd/system/nusa-cloud-paper.service
sudo cp /opt/nusa/current/deploy/oracle/nusa-research.service /etc/systemd/system/nusa-research.service
sudo cp /opt/nusa/current/deploy/oracle/nusa-research.timer /etc/systemd/system/nusa-research.timer
sudo systemctl daemon-reload
sudo systemctl enable --now nusa-cloud-paper.service
sudo systemctl enable --now nusa-research.timer
```

5. Verify the runtime and scheduler:

```bash
systemctl is-active nusa-cloud-paper.service
systemctl is-enabled nusa-research.timer
systemctl is-active nusa-research.timer
systemctl list-timers nusa-research.timer --no-pager
```

The Research timer is `Persistent=true`, runs shortly after boot, and schedules the canonical public-market Research snapshot daily at 09:15 Asia/Seoul with bounded randomized delay. The Research service writes immutable replay snapshots beside the Cloud state DB. The production closed-learning runtime immediately attempts bootstrap/recovery and retries every 30 seconds; only a uniquely `QUALIFIED_FOR_LEAGUE` candidate can become a PAPER challenger binding.

The canonical Research runner requests 1,000 completed UTC daily candles by default
(five public Upbit pages, at most 200 candles each). `NUSA_RESEARCH_CANDLE_COUNT`
may be declared in the existing service environment before a run, from 200 to
2,000; it must not be tuned after inspecting profitability. Each request uses an
exclusive UTC cursor and is included in the dataset manifest. Missing days,
duplicate/overlapping pages, wrong markets and malformed prices fail closed;
requests time out after 15 seconds and are not blindly retried on rate limits.
The existing 120/20 walk-forward plan, cost model, DSR/PBO and qualification
thresholds remain unchanged. More history is not independent forward PAPER
evidence and does not guarantee that any challenger qualifies.

6. If using a public monitoring origin, install the repository's HTTPS reverse proxy configuration so only the runtime loopback listener is exposed.

## Production behavior

`nusa-cloud-paper.service` invokes `/opt/nusa/current/scripts/start-cloud-runtime.js`, which supervises `closedLearningProductionRuntime.js`. The runtime supplies PAPER-only operational defaults, strips private exchange credentials before spawning the child, persists canonical account/execution state, and keeps the Research→League→qualified-challenger→next-PAPER composition inside the same fail-closed authority boundary.

Both Oracle services set `HOME=/var/lib/nusa` while retaining `ProtectHome=true` and `ProtectSystem=strict`, so owner-only runtime state stays inside the already-authorized StateDirectory rather than requiring writable access to `the service account home`.

## Production evidence

Run the read-only verifier from a separate machine/process:

```bash
NUSA_PRODUCTION_BASE_URL=https://paper.example.com \
NUSA_CLOUD_DASHBOARD_TOKEN='...' \
NUSA_SOURCE_COMMIT='<exact-protected-main-sha>' \
NUSA_PRODUCTION_PROOF_DURATION_MS=3600000 \
node scripts/verify-cloud-paper-production.js
```

The verifier never calls a real-money broker path. It checks runtime/scheduler/transport state, fresh heartbeat and market progress, autonomous PAPER order/fill counters, fee evidence, durable restart evidence, projected order/fill ID uniqueness, and immutable LIVE/AI authority boundaries.

A short verifier PASS is **not** equivalent to the final 24-hour completion claim. The final claim requires real elapsed production evidence including autonomous PAPER signal/order/fill/accounting/PnL, restart/replay/reconciliation, closed-learning ingestion and qualified PAPER redeployment when available, with LIVE mutation remaining zero.
